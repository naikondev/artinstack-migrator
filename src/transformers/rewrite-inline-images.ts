import * as cheerio from "cheerio";

import { normalizeAssetUrl } from "../lib/content-asset-urls.js";

export interface RewriteInlineImageRef {
  originalSrc: string;
  sourceAssetId?: string;
}

export interface UploadedAssetRef {
  targetId: string;
  publicUrl?: string;
}

export interface RewriteInlineImagesOptions {
  resolveAsset: (src: string) => RewriteInlineImageRef | undefined;
  replaceWith: (ref: RewriteInlineImageRef, uploaded: UploadedAssetRef) => string;
}

export interface RewriteInlineImagesResult {
  html: string;
  referencedSources: string[];
  unresolved: string[];
}

/** Inline CSS `background` / `background-image: url(…)` (quoted or bare). */
const BACKGROUND_IMAGE_URL_PATTERN =
  /background(?:-image)?\s*:[^;]*?url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function tryRewriteUrl(
  src: string,
  options: RewriteInlineImagesOptions,
  uploadedBySourceId: Map<string, UploadedAssetRef>,
  referencedSources: Set<string>,
  unresolved: Set<string>,
): string | undefined {
  const normalized = normalizeAssetUrl(src);
  if (!normalized) return undefined;

  referencedSources.add(normalized);
  const ref = options.resolveAsset(normalized);
  if (!ref?.sourceAssetId) {
    unresolved.add(normalized);
    return undefined;
  }

  const uploaded = uploadedBySourceId.get(ref.sourceAssetId);
  if (!uploaded) {
    unresolved.add(normalized);
    return undefined;
  }

  return options.replaceWith(ref, uploaded);
}

function rewriteBackgroundUrlsInStyle(
  style: string,
  options: RewriteInlineImagesOptions,
  uploadedBySourceId: Map<string, UploadedAssetRef>,
  referencedSources: Set<string>,
  unresolved: Set<string>,
): string {
  return style.replace(BACKGROUND_IMAGE_URL_PATTERN, (full, quote: string, rawUrl: string) => {
    const replaced = tryRewriteUrl(rawUrl.trim(), options, uploadedBySourceId, referencedSources, unresolved);
    if (!replaced) return full;

    const urlCall = quote
      ? `url(${quote}${replaced}${quote})`
      : `url(${replaced})`;
    return full.replace(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/i, urlCall);
  });
}

function rewriteSrcset(
  srcset: string,
  options: RewriteInlineImagesOptions,
  uploadedBySourceId: Map<string, UploadedAssetRef>,
  referencedSources: Set<string>,
  unresolved: Set<string>,
): string {
  return srcset
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return entry;
      const [urlPart, descriptor] = trimmed.split(/\s+/, 2);
      const replaced = tryRewriteUrl(urlPart ?? "", options, uploadedBySourceId, referencedSources, unresolved);
      if (!replaced) return entry;
      return descriptor ? `${replaced} ${descriptor}` : replaced;
    })
    .join(", ");
}

/** Rewrite `<img src>` / `srcset`, `data-bg-image`, and inline CSS backgrounds using uploaded asset targets. */
export function rewriteInlineImages(
  html: string,
  options: RewriteInlineImagesOptions,
  uploadedBySourceId: Map<string, UploadedAssetRef>,
): RewriteInlineImagesResult {
  if (!html.trim()) {
    return { html, referencedSources: [], unresolved: [] };
  }

  const $ = cheerio.load(html, { xml: false });
  const referencedSources = new Set<string>();
  const unresolved = new Set<string>();

  $("img").each((_, element) => {
    const img = $(element);
    const src = img.attr("src")?.trim();
    if (src && !src.startsWith("data:")) {
      const replaced = tryRewriteUrl(src, options, uploadedBySourceId, referencedSources, unresolved);
      if (replaced) img.attr("src", replaced);
    }

    const srcset = img.attr("srcset")?.trim();
    if (srcset) {
      img.attr("srcset", rewriteSrcset(srcset, options, uploadedBySourceId, referencedSources, unresolved));
    }
  });

  $("[data-bg-image]").each((_, element) => {
    const node = $(element);
    const bgImage = node.attr("data-bg-image")?.trim();
    if (!bgImage || bgImage.startsWith("data:")) return;
    const replaced = tryRewriteUrl(bgImage, options, uploadedBySourceId, referencedSources, unresolved);
    if (replaced) node.attr("data-bg-image", replaced);
  });

  $("[style]").each((_, element) => {
    const node = $(element);
    const style = node.attr("style");
    if (!style?.includes("background")) return;
    const rewritten = rewriteBackgroundUrlsInStyle(
      style,
      options,
      uploadedBySourceId,
      referencedSources,
      unresolved,
    );
    if (rewritten !== style) node.attr("style", rewritten);
  });

  return {
    html: $.root().html() ?? html,
    referencedSources: [...referencedSources],
    unresolved: [...unresolved],
  };
}
