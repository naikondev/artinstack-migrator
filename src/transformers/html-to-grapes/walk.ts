import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import type { GrapesComponent, HtmlToGrapesOptions } from "./types.js";

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
): string {
  if (options.componentMap && classes) {
    for (const className of classes) {
      const mapped = options.componentMap[className];
      if (mapped) return mapped;
    }
  }
  return DEFAULT_TYPES[tagName] ?? "default";
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
        type: "text",
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
