import * as cheerio from "cheerio";

import { isMigrationMediaRef, parseMigrationMediaRef } from "../lib/migration-media-ref.js";

export interface ExpandMigrationMediaRefsResult {
  html: string;
  unresolved: string[];
}

/** Inline CSS `background` / `background-image: url(…)` (quoted or bare). */
const BACKGROUND_IMAGE_URL_PATTERN =
  /background(?:-image)?\s*:[^;]*?url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function tryExpandRef(
  value: string,
  resolvePublicUrl: (sourceId: string) => string | undefined,
  unresolved: Set<string>,
): string | undefined {
  if (!isMigrationMediaRef(value)) return undefined;
  const sourceId = parseMigrationMediaRef(value);
  if (!sourceId) {
    unresolved.add(value);
    return undefined;
  }
  const publicUrl = resolvePublicUrl(sourceId);
  if (!publicUrl) {
    unresolved.add(value);
    return undefined;
  }
  return publicUrl;
}

function expandBackgroundUrlsInStyle(
  style: string,
  resolvePublicUrl: (sourceId: string) => string | undefined,
  unresolved: Set<string>,
): string {
  return style.replace(BACKGROUND_IMAGE_URL_PATTERN, (full, quote: string, rawUrl: string) => {
    const expanded = tryExpandRef(rawUrl.trim(), resolvePublicUrl, unresolved);
    if (!expanded) return full;

    const urlCall = quote ? `url(${quote}${expanded}${quote})` : `url(${expanded})`;
    return full.replace(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/i, urlCall);
  });
}

function expandSrcset(
  srcset: string,
  resolvePublicUrl: (sourceId: string) => string | undefined,
  unresolved: Set<string>,
): string {
  return srcset
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return entry;
      const [urlPart, descriptor] = trimmed.split(/\s+/, 2);
      const expanded = tryExpandRef(urlPart ?? "", resolvePublicUrl, unresolved);
      if (!expanded) return entry;
      return descriptor ? `${expanded} ${descriptor}` : expanded;
    })
    .join(", ");
}

/**
 * Expand OSS-14 `artinstack-migration://asset/…` refs to host CDN URLs.
 * Lookup (`migration_entities` → `publicUrl`) is host-supplied via `resolvePublicUrl`.
 */
export function expandMigrationMediaRefs(
  html: string,
  resolvePublicUrl: (sourceId: string) => string | undefined,
): ExpandMigrationMediaRefsResult {
  if (!html.trim()) {
    return { html, unresolved: [] };
  }

  const $ = cheerio.load(html, { xml: false });
  const unresolved = new Set<string>();

  $("img").each((_, element) => {
    const img = $(element);
    const src = img.attr("src")?.trim();
    if (src) {
      const expanded = tryExpandRef(src, resolvePublicUrl, unresolved);
      if (expanded) img.attr("src", expanded);
    }

    const srcset = img.attr("srcset")?.trim();
    if (srcset) {
      img.attr("srcset", expandSrcset(srcset, resolvePublicUrl, unresolved));
    }
  });

  $("[data-bg-image]").each((_, element) => {
    const node = $(element);
    const bgImage = node.attr("data-bg-image")?.trim();
    if (!bgImage) return;
    const expanded = tryExpandRef(bgImage, resolvePublicUrl, unresolved);
    if (expanded) node.attr("data-bg-image", expanded);
  });

  $("[style]").each((_, element) => {
    const node = $(element);
    const style = node.attr("style");
    if (!style?.includes("background")) return;
    const rewritten = expandBackgroundUrlsInStyle(style, resolvePublicUrl, unresolved);
    if (rewritten !== style) node.attr("style", rewritten);
  });

  return {
    html: $.root().html() ?? html,
    unresolved: [...unresolved],
  };
}
