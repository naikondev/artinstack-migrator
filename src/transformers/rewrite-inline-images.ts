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
      const normalized = normalizeAssetUrl(urlPart ?? "");
      if (!normalized) return entry;
      referencedSources.add(normalized);
      const ref = options.resolveAsset(normalized);
      if (!ref?.sourceAssetId) {
        unresolved.add(normalized);
        return entry;
      }
      const uploaded = uploadedBySourceId.get(ref.sourceAssetId);
      if (!uploaded) {
        unresolved.add(normalized);
        return entry;
      }
      const replaced = options.replaceWith(ref, uploaded);
      return descriptor ? `${replaced} ${descriptor}` : replaced;
    })
    .join(", ");
}

/** Rewrite `<img src>` / `srcset` using uploaded asset targets supplied by the host sink. */
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
      const normalized = normalizeAssetUrl(src);
      if (normalized) {
        referencedSources.add(normalized);
        const ref = options.resolveAsset(normalized);
        if (!ref?.sourceAssetId) {
          unresolved.add(normalized);
        } else {
          const uploaded = uploadedBySourceId.get(ref.sourceAssetId);
          if (!uploaded) {
            unresolved.add(normalized);
          } else {
            img.attr("src", options.replaceWith(ref, uploaded));
          }
        }
      }
    }

    const srcset = img.attr("srcset")?.trim();
    if (srcset) {
      img.attr("srcset", rewriteSrcset(srcset, options, uploadedBySourceId, referencedSources, unresolved));
    }
  });

  return {
    html: $.root().html() ?? html,
    referencedSources: [...referencedSources],
    unresolved: [...unresolved],
  };
}
