import * as cheerio from "cheerio";

import type { HtmlToTiptapOptions, TiptapDoc } from "./types.js";
import { prepareHtmlForTiptap, walkHtmlToTiptapDoc } from "./walk.js";

export type { HtmlToTiptapOptions, TiptapDoc, TiptapMark, TiptapNode } from "./types.js";

/** Cheerio HTML walk → Tiptap / ProseMirror `doc` JSON for blog `content_json`. */
export function htmlToTiptap(html: string, options: HtmlToTiptapOptions = {}): TiptapDoc {
  const trimmed = html.trim();
  if (!trimmed) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  const $ = cheerio.load(trimmed, { xml: false });
  prepareHtmlForTiptap($);
  return walkHtmlToTiptapDoc($, options);
}
