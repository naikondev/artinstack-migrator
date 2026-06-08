import * as cheerio from "cheerio";

/** Builder-agnostic attribute names that commonly hold image URLs in post_content. */
const ASSET_URL_PARAM_PATTERN =
  /\b(?:src|image|url)\s*=\s*["']([^"']+)["']/gi;

const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i;
const WP_UPLOADS_PATTERN = /\/wp-content\/uploads\//i;

function extractImgTagSrcs(content: string): string[] {
  if (!content.trim()) return [];
  const $ = cheerio.load(content, { xml: false });
  const srcs: string[] = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src")?.trim();
    if (src) srcs.push(src);
  });
  return srcs;
}

/** All `<img src>` values (including those not ingested as vault assets). */
export function discoverRawImgSrcs(content: string): string[] {
  return extractImgTagSrcs(content).filter((src) => !src.startsWith("data:"));
}

/** Normalize protocol-relative and trim; skip data URIs. */
export function normalizeAssetUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

/** Heuristic: URL likely points at a raster/vector image asset, not a page link. */
export function isLikelyImageUrl(url: string): boolean {
  if (!url || url.startsWith("data:")) return false;

  if (url.startsWith("/")) {
    return WP_UPLOADS_PATTERN.test(url) || IMAGE_EXTENSION_PATTERN.test(url);
  }

  if (!/^https?:\/\//i.test(url)) return false;

  if (WP_UPLOADS_PATTERN.test(url)) return true;

  try {
    const pathname = new URL(url).pathname;
    return IMAGE_EXTENSION_PATTERN.test(pathname);
  } catch {
    return IMAGE_EXTENSION_PATTERN.test(url);
  }
}

/**
 * Generic content-discovery pass: collect image URLs from HTML `<img>` tags and
 * common shortcode/builder attributes (`src=`, `image=`, `url=`) without parsing
 * builder-specific structure (Tatsu, Elementor, etc.).
 */
export function discoverContentAssetUrls(content: string): string[] {
  if (!content.trim()) return [];

  const urls = new Set<string>();

  for (const raw of extractImgTagSrcs(content)) {
    const normalized = normalizeAssetUrl(raw);
    if (normalized && isLikelyImageUrl(normalized)) {
      urls.add(normalized);
    }
  }

  for (const match of content.matchAll(ASSET_URL_PARAM_PATTERN)) {
    const normalized = normalizeAssetUrl(match[1] ?? "");
    if (normalized && isLikelyImageUrl(normalized)) {
      urls.add(normalized);
    }
  }

  return [...urls];
}

/** @deprecated Use discoverContentAssetUrls — kept for call-site clarity during transition. */
export function extractInlineImageSrcs(content: string): string[] {
  return discoverContentAssetUrls(content);
}
