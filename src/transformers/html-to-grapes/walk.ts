import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import type { GrapesComponent, HtmlToGrapesOptions, LayoutKind } from "./types.js";

type CheerioSelection = Cheerio<AnyNode>;

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "del",
  "em",
  "i",
  "img",
  "ins",
  "mark",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "wbr",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TEXT_CONTAINER_TAGS = new Set([
  "blockquote",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "p",
  "pre",
  "td",
  "th",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);

const DEFAULT_TYPES: Record<string, string> = {
  a: "link",
  img: "image",
};

const LAYOUT_DATA_ATTR = "data-layout";
const WP_WIDGET_ATTR = "data-wp-widget";
const DEFAULT_WP_WIDGET_TYPE = "wp-widget";
const EMBED_IFRAME_TYPE = "embed";

const EMBED_IFRAME_SRC =
  /google\.com\/maps\/embed|youtube\.com\/embed|youtube-nocookie\.com\/embed|player\.vimeo\.com\/video/i;

const DEFAULT_LAYOUT_TYPE_MAP: Record<LayoutKind, string> = {
  section: "section",
  row: "row",
  column: "column",
};

function parseLayoutKind(attributes: Record<string, string> | undefined): LayoutKind | undefined {
  const value = attributes?.[LAYOUT_DATA_ATTR];
  if (value === "section" || value === "row" || value === "column") return value;
  return undefined;
}

function resolveLayoutComponentType(kind: LayoutKind, options: HtmlToGrapesOptions): string {
  return options.layoutTypeMap?.[kind] ?? DEFAULT_LAYOUT_TYPE_MAP[kind];
}

function resolveWidgetComponentType(options: HtmlToGrapesOptions): string {
  return options.widgetComponentType ?? DEFAULT_WP_WIDGET_TYPE;
}

function isWpWidgetMarker(attributes: Record<string, string> | undefined): boolean {
  return Boolean(attributes?.[WP_WIDGET_ATTR]);
}

function isPreservedEmbedIframe(
  tagName: string | undefined,
  attributes: Record<string, string> | undefined,
): boolean {
  if (tagName !== "iframe") return false;
  const src = attributes?.src ?? "";
  return EMBED_IFRAME_SRC.test(src);
}

/** Block-level `<a href="…"><img …></a>` (e.g. affiliation logos) → void image, not inline HTML text. */
function isBlockLinkedImageAnchor($: CheerioAPI, $el: CheerioSelection): boolean {
  if (tagNameOf($el) !== "a") return false;
  const href = $el.attr("href")?.trim();
  if (!href || href === "#") return false;

  let tagChildCount = 0;
  let onlyImg = false;
  $el.contents().each((_, node) => {
    if (node.type === "text") {
      if (String("data" in node ? node.data : "").trim()) {
        tagChildCount = -1;
      }
      return;
    }
    if (node.type !== "tag") return;
    tagChildCount += 1;
    onlyImg = tagNameOf($(node)) === "img";
  });

  return tagChildCount === 1 && onlyImg;
}

function walkLinkedImageAnchor(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToGrapesOptions,
): GrapesComponent {
  const href = $el.attr("href")!.trim();
  const $img = $el.children().first();
  const meta = pickElementMeta($img);
  const attributes = { ...(meta.attributes ?? {}), href };

  return applyElementMeta(
    {
      type: resolveComponentType("img", meta.classes, options),
      tagName: "img",
      void: true,
    },
    {
      attributes,
      classes: meta.classes,
    },
  );
}

function layoutAttributesForComponent(
  attributes: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!attributes) return undefined;
  const { [LAYOUT_DATA_ATTR]: _layout, ...rest } = attributes;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function tagNameOf($el: CheerioSelection): string | undefined {
  const raw = $el.prop("tagName");
  return typeof raw === "string" ? raw.toLowerCase() : undefined;
}

function applyElementMeta(
  component: GrapesComponent,
  meta: Pick<GrapesComponent, "attributes" | "classes">,
): GrapesComponent {
  if (meta.attributes) component.attributes = meta.attributes;
  if (meta.classes) component.classes = meta.classes;
  return component;
}

function pickElementMeta($el: CheerioSelection): Pick<GrapesComponent, "attributes" | "classes"> {
  const attributes: Record<string, string> = {};
  const classes: string[] = [];

  if (typeof $el.attr() === "object") {
    for (const [key, value] of Object.entries($el.attr() ?? {})) {
      if (key === "class") {
        classes.push(...value.split(/\s+/).filter(Boolean));
        continue;
      }
      attributes[key] = value;
    }
  }

  return {
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    classes: classes.length > 0 ? classes : undefined,
  };
}

function resolveComponentType(
  tagName: string,
  classes: string[] | undefined,
  options: HtmlToGrapesOptions,
  fallback = "default",
): string {
  if (options.componentMap && classes) {
    for (const className of classes) {
      const mapped = options.componentMap[className];
      if (mapped) return mapped;
    }
  }
  const tagMapped = options.tagMap?.[tagName];
  if (tagMapped) return tagMapped;
  return DEFAULT_TYPES[tagName] ?? fallback;
}

function hasOnlyInlineContent($: CheerioAPI, $el: CheerioSelection): boolean {
  let inlineOnly = true;

  $el.contents().each((_, node) => {
    if (!inlineOnly) return;
    const $child = $(node);
    if ($child.get(0)?.type === "text") return;
    const childTag = tagNameOf($child);
    if (!childTag || !INLINE_TAGS.has(childTag)) {
      inlineOnly = false;
      return;
    }
    if (!hasOnlyInlineContent($, $child)) {
      inlineOnly = false;
    }
  });

  return inlineOnly;
}

function walkChildren(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToGrapesOptions,
): GrapesComponent[] {
  const components: GrapesComponent[] = [];

  $el.contents().each((_, node) => {
    const walked = walkNode($, $(node), options);
    if (!walked) return;
    if (Array.isArray(walked)) {
      components.push(...walked);
    } else {
      components.push(walked);
    }
  });

  return components;
}

function walkNode(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToGrapesOptions,
): GrapesComponent | GrapesComponent[] | null {
  const node = $el.get(0);
  if (!node) return null;

  if (node.type === "text") {
    const text = "data" in node ? String(node.data ?? "") : "";
    if (!text.trim()) return null;
    return { type: "textnode", content: text };
  }

  if (node.type !== "tag") return null;

  const tagName = tagNameOf($el);
  if (!tagName || SKIP_TAGS.has(tagName)) return null;

  const meta = pickElementMeta($el);

  const layoutKind = parseLayoutKind(meta.attributes);
  if (layoutKind) {
    const components = walkChildren($, $el, options);
    const component = applyElementMeta(
      {
        type: resolveLayoutComponentType(layoutKind, options),
        tagName,
      },
      {
        attributes: layoutAttributesForComponent(meta.attributes),
        classes: meta.classes,
      },
    );
    if (components.length > 0) {
      component.components = components;
    }
    return component;
  }

  // OSS-13 — atomic widget blocks (do not merge into preceding text / inline walks).
  if (isWpWidgetMarker(meta.attributes)) {
    return applyElementMeta(
      {
        type: resolveWidgetComponentType(options),
        tagName,
      },
      meta,
    );
  }

  if (isPreservedEmbedIframe(tagName, meta.attributes)) {
    return applyElementMeta(
      {
        type: EMBED_IFRAME_TYPE,
        tagName,
        void: true,
      },
      meta,
    );
  }

  if (tagName === "a" && isBlockLinkedImageAnchor($, $el)) {
    return walkLinkedImageAnchor($, $el, options);
  }

  if (VOID_TAGS.has(tagName)) {
    return applyElementMeta(
      {
        type: resolveComponentType(tagName, meta.classes, options),
        tagName,
        void: true,
      },
      meta,
    );
  }

  if (TEXT_CONTAINER_TAGS.has(tagName) && hasOnlyInlineContent($, $el)) {
    return applyElementMeta(
      {
        type: resolveComponentType(tagName, meta.classes, options, "text"),
        tagName,
        content: $el.html() ?? "",
      },
      meta,
    );
  }

  if (INLINE_TAGS.has(tagName)) {
    return applyElementMeta(
      {
        type: "text",
        content: $.html($el) ?? "",
      },
      meta,
    );
  }

  const components = walkChildren($, $el, options);
  const component = applyElementMeta(
    {
      type: resolveComponentType(tagName, meta.classes, options),
      tagName,
    },
    meta,
  );

  if (components.length > 0) {
    component.components = components;
  }

  return component;
}

function appendWalked(
  content: GrapesComponent[],
  walked: GrapesComponent | GrapesComponent[] | null,
): void {
  if (!walked) return;
  if (Array.isArray(walked)) {
    content.push(...walked);
    return;
  }
  content.push(walked);
}

function walkNodes(
  $: CheerioAPI,
  $nodes: CheerioSelection,
  content: GrapesComponent[],
  options: HtmlToGrapesOptions,
): void {
  $nodes.each((_, node) => {
    appendWalked(content, walkNode($, $(node), options));
  });
}

export function walkHtmlToComponents(
  $: CheerioAPI,
  options: HtmlToGrapesOptions = {},
): GrapesComponent[] {
  const content: GrapesComponent[] = [];
  const body = $("body");

  if (body.length) {
    walkNodes($, body.contents(), content, options);
    return content;
  }

  const children = $.root().children();
  if (children.length) {
    walkNodes($, children, content, options);
  } else {
    walkNodes($, $.root().contents(), content, options);
  }

  return content;
}
