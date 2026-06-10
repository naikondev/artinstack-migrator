import * as cheerio from "cheerio";

import { normalizeAssetUrl } from "../lib/content-asset-urls.js";
import {
  createMigrationMediaRefReplaceWith,
  isMigrationMediaRef,
} from "../lib/migration-media-ref.js";
import {
  buildMigrationMediaUrlIndex,
  resolveMigrationMediaSourceId,
} from "../lib/migration-media-url-index.js";

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
  /**
   * Replace a resolved source id with a migration ref or CDN URL.
   * When omitted, defaults to OSS-14 `artinstack-migration://asset/…` refs.
   */
  replaceWith?: (ref: RewriteInlineImageRef, uploaded?: UploadedAssetRef) => string;
  /**
   * When true, skip URLs that cannot be matched to an uploaded vault target.
   * Default: false when using migration refs; true when a custom `replaceWith` is supplied.
   */
  requireUploaded?: boolean;
}

export interface RewriteInlineImagesResult {
  html: string;
  referencedSources: string[];
  unresolved: string[];
}

/** Inline CSS `background` / `background-image: url(…)` (quoted or bare). */
const BACKGROUND_IMAGE_URL_PATTERN =
  /background(?:-image)?\s*:[^;]*?url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function resolveRewriteOptions(
  options: RewriteInlineImagesOptions,
): Required<Pick<RewriteInlineImagesOptions, "replaceWith" | "requireUploaded">> {
  const replaceWith = options.replaceWith ?? createMigrationMediaRefReplaceWith();
  const requireUploaded = options.requireUploaded ?? Boolean(options.replaceWith);
  return { replaceWith, requireUploaded };
}

function tryRewriteUrl(
  src: string,
  options: RewriteInlineImagesOptions,
  uploadedBySourceId: Map<string, UploadedAssetRef>,
  referencedSources: Set<string>,
  unresolved: Set<string>,
): string | undefined {
  const normalized = normalizeAssetUrl(src);
  if (!normalized) return undefined;

  if (isMigrationMediaRef(normalized)) {
    referencedSources.add(normalized);
    return normalized;
  }

  referencedSources.add(normalized);
  const ref = options.resolveAsset(normalized);
  if (!ref?.sourceAssetId) {
    unresolved.add(normalized);
    return undefined;
  }

  const { replaceWith, requireUploaded } = resolveRewriteOptions(options);
  const uploaded = uploadedBySourceId.get(ref.sourceAssetId);
  if (requireUploaded && !uploaded) {
    unresolved.add(normalized);
    return undefined;
  }

  return replaceWith(ref, uploaded);
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

export interface StampMigrationMediaRefsOptions {
  /** Pre-built url/pathname → sourceId map (from attachments + inline assets). */
  urlToSourceId: Map<string, string>;
  replaceWith?: RewriteInlineImagesOptions["replaceWith"];
  requireUploaded?: boolean;
}

/**
 * OSS-14 — replace resolved `wp-content/uploads` URLs with `artinstack-migration://asset/…`
 * refs. Does not invent refs for unknown URLs (left unchanged + listed in `unresolved`).
 */
export function stampMigrationMediaRefs(
  html: string,
  options: StampMigrationMediaRefsOptions,
): RewriteInlineImagesResult {
  return rewriteInlineImages(
    html,
    {
      resolveAsset: (src) => {
        const sourceAssetId = resolveMigrationMediaSourceId(src, options.urlToSourceId);
        if (!sourceAssetId) return undefined;
        return { originalSrc: src, sourceAssetId };
      },
      replaceWith: options.replaceWith,
      requireUploaded: options.requireUploaded ?? false,
    },
    new Map(),
  );
}

/** Build a url index from attachment rows and/or normalized assets. */
export { buildMigrationMediaUrlIndex };
