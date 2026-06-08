import * as cheerio from "cheerio";

import { cssToStyles } from "../css-to-styles/index.js";
import type { GrapesProjectSnapshot, HtmlToGrapesOptions } from "./types.js";
import { walkHtmlToComponents } from "./walk.js";

export type {
  GrapesComponent,
  GrapesProjectSnapshot,
  GrapesStyleRule,
  HtmlToGrapesOptions,
} from "./types.js";

/** Cheerio HTML walk → Grapes `content` + root `styles`. */
export function htmlToGrapes(html: string, options: HtmlToGrapesOptions = {}): GrapesProjectSnapshot {
  const trimmed = html.trim();
  if (!trimmed) {
    return { content: [], styles: [] };
  }

  const $ = cheerio.load(trimmed, { xml: false });
  const styleBlocks: string[] = [];

  $("style").each((_, element) => {
    styleBlocks.push($(element).html() ?? "");
    $(element).remove();
  });

  const contentCss = styleBlocks.join("\n").trim();
  const styles = cssToStyles(contentCss);
  const content = walkHtmlToComponents($, options);
  const contentHtml = serializeContentHtml($);

  return {
    content,
    styles,
    ...(contentHtml ? { contentHtml } : {}),
    ...(contentCss ? { contentCss } : {}),
  };
}

function serializeContentHtml($: cheerio.CheerioAPI): string | undefined {
  const body = $("body");
  if (body.length) {
    const html = body.html()?.trim();
    return html || undefined;
  }

  const rootHtml = $.root().html()?.trim();
  return rootHtml || undefined;
}
