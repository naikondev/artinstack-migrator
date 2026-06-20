import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import type { HtmlToTiptapOptions, TiptapDoc, TiptapMark, TiptapNode } from "./types.js";
import {
  isPreservedVideoIframe,
  isVideoWidgetElement,
  videoEmbedNodeFromIframe,
  videoEmbedNodeFromWidget,
} from "./video-embed.js";

type CheerioSelection = Cheerio<AnyNode>;

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const UNWRAP_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figure",
  "footer",
  "header",
  "main",
  "nav",
  "section",
  "span",
]);

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
  "ins",
  "mark",
  "q",
  "s",
  "small",
  "strong",
  "sub",
  "sup",
  "u",
  "wbr",
]);

const LAYOUT_ATTR = "data-layout";

function tagNameOf($el: CheerioSelection): string | undefined {
  const raw = $el.prop("tagName");
  return typeof raw === "string" ? raw.toLowerCase() : undefined;
}

function headingLevel(tagName: string): number {
  const level = Number.parseInt(tagName.slice(1), 10);
  return Number.isFinite(level) ? level : 1;
}

function isLayoutMarker($el: CheerioSelection, options: HtmlToTiptapOptions): boolean {
  if (options.unwrapLayoutMarkers === false) return false;
  return $el.attr(LAYOUT_ATTR) !== undefined;
}

function hasOnlyInlineContent($: CheerioAPI, $el: CheerioSelection): boolean {
  let inlineOnly = true;

  $el.contents().each((_, node) => {
    if (!inlineOnly) return;
    const $child = $(node);
    if ($child.get(0)?.type === "text") return;
    const childTag = tagNameOf($child);
    if (!childTag || childTag === "br" || childTag === "img") return;
    if (!INLINE_TAGS.has(childTag)) {
      inlineOnly = false;
      return;
    }
    if (!hasOnlyInlineContent($, $child)) {
      inlineOnly = false;
    }
  });

  return inlineOnly;
}

function hasBlockChild($: CheerioAPI, $el: CheerioSelection): boolean {
  let hasBlock = false;
  $el.contents().each((_, node) => {
    if (hasBlock) return;
    const $child = $(node);
    if ($child.get(0)?.type === "text") return;
    const childTag = tagNameOf($child);
    if (!childTag) return;
    if (
      HEADING_TAGS.has(childTag) ||
      childTag === "p" ||
      childTag === "ul" ||
      childTag === "ol" ||
      childTag === "blockquote" ||
      childTag === "pre" ||
      childTag === "hr" ||
      childTag === "img" ||
      childTag === "iframe" ||
      childTag === "table" ||
      isLayoutMarker($child, { unwrapLayoutMarkers: true }) ||
      (UNWRAP_TAGS.has(childTag) && hasBlockChild($, $child))
    ) {
      hasBlock = true;
    }
  });
  return hasBlock;
}

function textNode(text: string, marks: TiptapMark[] = []): TiptapNode {
  const node: TiptapNode = { type: "text", text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function paragraph(content: TiptapNode[]): TiptapNode {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function appendMarks(existing: TiptapMark[], added: TiptapMark): TiptapMark[] {
  if (existing.some((mark) => mark.type === added.type)) return existing;
  return [...existing, added];
}

function marksForTag(tagName: string, $el: CheerioSelection): TiptapMark[] {
  switch (tagName) {
    case "strong":
    case "b":
      return [{ type: "bold" }];
    case "em":
    case "i":
      return [{ type: "italic" }];
    case "s":
    case "del":
    case "strike":
      return [{ type: "strike" }];
    case "u":
      return [{ type: "underline" }];
    case "code":
      return [{ type: "code" }];
    case "a": {
      const href = $el.attr("href");
      if (!href) return [];
      const attrs: Record<string, string> = { href };
      const target = $el.attr("target");
      if (target) attrs.target = target;
      const rel = $el.attr("rel");
      if (rel) attrs.rel = rel;
      return [{ type: "link", attrs }];
    }
    default:
      return [];
  }
}

function imageNode($el: CheerioSelection): TiptapNode | null {
  const src = $el.attr("src");
  if (!src) return null;
  const attrs: Record<string, unknown> = { src };
  const alt = $el.attr("alt");
  if (alt !== undefined) attrs.alt = alt;
  const title = $el.attr("title");
  if (title) attrs.title = title;
  return { type: "image", attrs };
}

function parseInlineContent(
  $: CheerioAPI,
  $el: CheerioSelection,
  marks: TiptapMark[] = [],
): TiptapNode[] {
  const rootTag = tagNameOf($el);
  if (rootTag && INLINE_TAGS.has(rootTag) && rootTag !== "br") {
    marks = marksForTag(rootTag, $el).reduce((acc, mark) => appendMarks(acc, mark), marks);
  }

  const nodes: TiptapNode[] = [];

  $el.contents().each((_, node) => {
    if (node.type === "text") {
      const text = String(node.data ?? "");
      if (text) nodes.push(textNode(text, marks));
      return;
    }

    if (node.type !== "tag") return;

    const $child = $(node);
    const tagName = tagNameOf($child);
    if (!tagName || SKIP_TAGS.has(tagName)) return;

    if (tagName === "br") {
      nodes.push({ type: "hardBreak" });
      return;
    }

    if (tagName === "img") {
      return;
    }

    const childMarks = marksForTag(tagName, $child);
    const combinedMarks = childMarks.reduce((acc, mark) => appendMarks(acc, mark), [...marks]);
    nodes.push(...parseInlineContent($, $child, combinedMarks));
  });

  return nodes;
}

/** Parse a block container that holds inline content (p, heading, etc.). Splits on nested block/img. */
function parseMixedBlockContent(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToTiptapOptions,
): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  let inlineBuffer: TiptapNode[] = [];

  function flushInline(): void {
    if (inlineBuffer.length === 0) return;
    blocks.push(paragraph(inlineBuffer));
    inlineBuffer = [];
  }

  $el.contents().each((_, node) => {
    if (node.type === "text") {
      const text = String(node.data ?? "");
      if (text) inlineBuffer.push(textNode(text));
      return;
    }

    if (node.type !== "tag") return;

    const $child = $(node);
    const tagName = tagNameOf($child);
    if (!tagName || SKIP_TAGS.has(tagName)) return;

    if (tagName === "br") {
      inlineBuffer.push({ type: "hardBreak" });
      return;
    }

    if (tagName === "img") {
      flushInline();
      const image = imageNode($child);
      if (image) blocks.push(image);
      return;
    }

    if (tagName === "iframe" && isPreservedVideoIframe($child, tagName)) {
      flushInline();
      const embed = videoEmbedNodeFromIframe($child);
      if (embed) blocks.push(embed);
      return;
    }

    if (INLINE_TAGS.has(tagName)) {
      inlineBuffer.push(...parseInlineContent($, $child));
      return;
    }

    flushInline();
    blocks.push(...walkBlockNodes($, $child, options));
  });

  flushInline();
  return blocks;
}

function walkListItem($: CheerioAPI, $el: CheerioSelection, options: HtmlToTiptapOptions): TiptapNode {
  const blocks = walkBlockNodes($, $el, options);
  if (blocks.length === 0) {
    return { type: "listItem", content: [{ type: "paragraph" }] };
  }

  const normalized: TiptapNode[] = [];
  for (const block of blocks) {
    if (
      block.type === "paragraph" ||
      block.type === "image" ||
      block.type === "embed" ||
      block.type === "blockquote" ||
      block.type === "bulletList" ||
      block.type === "orderedList"
    ) {
      normalized.push(block);
      continue;
    }
    normalized.push(paragraph(block.content ?? []));
  }

  return { type: "listItem", content: normalized };
}

function walkBlockNode(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToTiptapOptions,
): TiptapNode[] {
  const node = $el.get(0);
  if (!node) return [];

  if (node.type === "text") {
    const text = String(node.data ?? "").trim();
    return text ? [paragraph([textNode(text)])] : [];
  }

  if (node.type !== "tag") return [];

  const tagName = tagNameOf($el);
  if (!tagName || SKIP_TAGS.has(tagName)) return [];

  if (isLayoutMarker($el, options)) {
    return walkBlockNodes($, $el, options);
  }

  if (isVideoWidgetElement($el)) {
    const embed = videoEmbedNodeFromWidget($el);
    return embed ? [embed] : [];
  }

  if (isPreservedVideoIframe($el, tagName)) {
    const embed = videoEmbedNodeFromIframe($el);
    return embed ? [embed] : [];
  }

  if (UNWRAP_TAGS.has(tagName)) {
    if (hasBlockChild($, $el)) {
      return walkBlockNodes($, $el, options);
    }
    if (hasOnlyInlineContent($, $el)) {
      const inline = parseInlineContent($, $el);
      return inline.length > 0 ? [paragraph(inline)] : [];
    }
    return walkBlockNodes($, $el, options);
  }

  if (HEADING_TAGS.has(tagName)) {
    const content = parseInlineContent($, $el);
    if (content.length === 0) return [];
    return [{ type: "heading", attrs: { level: headingLevel(tagName) }, content }];
  }

  if (tagName === "p") {
    return parseMixedBlockContent($, $el, options);
  }

  if (tagName === "ul") {
    const items: TiptapNode[] = [];
    $el.children("li").each((_, li) => {
      items.push(walkListItem($, $(li), options));
    });
    return items.length > 0 ? [{ type: "bulletList", content: items }] : [];
  }

  if (tagName === "ol") {
    const items: TiptapNode[] = [];
    $el.children("li").each((_, li) => {
      items.push(walkListItem($, $(li), options));
    });
    return items.length > 0 ? [{ type: "orderedList", content: items }] : [];
  }

  if (tagName === "li") {
    return [walkListItem($, $el, options)];
  }

  if (tagName === "blockquote") {
    const blocks = walkBlockNodes($, $el, options);
    if (blocks.length === 0) return [];
    return [{ type: "blockquote", content: blocks }];
  }

  if (tagName === "pre") {
    const code = $el.find("code").first();
    const text = (code.length ? code.text() : $el.text()).replace(/\n$/, "");
    if (!text) return [];
    return [{ type: "codeBlock", content: [textNode(text)] }];
  }

  if (tagName === "hr") {
    return [{ type: "horizontalRule" }];
  }

  if (tagName === "img") {
    const image = imageNode($el);
    return image ? [image] : [];
  }

  if (tagName === "table") {
    const rows: string[] = [];
    $el.find("tr").each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .find("th, td")
        .each((__, cell) => {
          const text = $(cell).text().trim();
          if (text) cells.push(text);
        });
      if (cells.length > 0) rows.push(cells.join(" | "));
    });
    return rows.map((row) => paragraph([textNode(row)]));
  }

  return walkBlockNodes($, $el, options);
}

function walkBlockNodes(
  $: CheerioAPI,
  $el: CheerioSelection,
  options: HtmlToTiptapOptions,
): TiptapNode[] {
  const blocks: TiptapNode[] = [];

  $el.contents().each((_, node) => {
    blocks.push(...walkBlockNode($, $(node), options));
  });

  return blocks;
}

function normalizeDocContent(content: TiptapNode[]): TiptapNode[] {
  const normalized: TiptapNode[] = [];

  for (const block of content) {
    if (block.type === "paragraph" && (!block.content || block.content.length === 0)) {
      continue;
    }
    normalized.push(block);
  }

  return normalized;
}

export function walkHtmlToTiptapDoc(
  $: CheerioAPI,
  options: HtmlToTiptapOptions = {},
): TiptapDoc {
  const resolved: HtmlToTiptapOptions = {
    unwrapLayoutMarkers: options.unwrapLayoutMarkers ?? true,
  };

  let content: TiptapNode[] = [];
  const body = $("body");

  if (body.length) {
    content = walkBlockNodes($, body, resolved);
  } else {
    const children = $.root().children();
    if (children.length) {
      content = walkBlockNodes($, children, resolved);
    } else {
      content = walkBlockNodes($, $.root(), resolved);
    }
  }

  content = normalizeDocContent(content);
  if (content.length === 0) {
    content = [{ type: "paragraph" }];
  }

  return { type: "doc", content };
}

/** Strip layout/style noise before walking (mutates loaded DOM). */
export function prepareHtmlForTiptap($: CheerioAPI): void {
  $("style, script, noscript, template").remove();
}

export function isElementNode(node: AnyNode): node is Element {
  return node.type === "tag";
}
