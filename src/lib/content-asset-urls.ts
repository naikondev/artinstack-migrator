import * as cheerio from "cheerio";

const IMAGE_EXTENSIONS = "jpe?g|png|gif|webp|avif|svg";
/** Image file extension in a path or URL (allows trailing `?query` / `#hash`). */
const IMAGE_EXTENSION_PATTERN = new RegExp(String.raw`\.(?:${IMAGE_EXTENSIONS})\b`, "i");

/** Captured value must contain an image extension — skips `url="…/about"`, `<iframe src="…youtube…">`, etc. */
const QUOTED_IMAGE_PATH = String.raw`[^"']+\.(?:${IMAGE_EXTENSIONS})(?:\?[^"'#]*)?(?:#.*)?`;

const SHORTCODE_IMAGE_PARAM_PATTERN = new RegExp(
  String.raw`\b(?:image|bg_image|background_image|url)\s*=\s*["'](${QUOTED_IMAGE_PATH})["']`,
  "gi",
);

/** Bare `src="…jpg"` outside `<img>` (shortcode fragments); `<img src>` handled by cheerio. */
const BARE_SRC_PARAM_PATTERN = new RegExp(
  String.raw`\bsrc\s*=\s*["'](${QUOTED_IMAGE_PATH})["']`,
  "gi",
);

const DATA_BG_IMAGE_PATTERN = /\bdata-bg-image\s*=\s*["']([^"']+)["']/gi;

/** Inline CSS `background` / `background-image: url(…)` (quoted or bare). */
const BACKGROUND_IMAGE_URL_PATTERN =
  /background(?:-image)?\s*:[^;]*?url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

const HERO_URL_PARAM_PATTERN = new RegExp(
  String.raw`\b(?:bg_image|background_image)\s*=\s*["'](${QUOTED_IMAGE_PATH})["']`,
  "gi",
);

const INLINE_IMAGE_PARAM_PATTERN = new RegExp(
  String.raw`\bimage\s*=\s*["'](${QUOTED_IMAGE_PATH})["']`,
  "gi",
);

const IMG_TAG_SRC_PATTERN = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

interface FeaturedAssetCandidate {
  url: string;
  index: number;
  tier: 0 | 1;
}

function ingestLikelyImageUrl(urls: Set<string>, raw: string | undefined): void {
  const normalized = normalizeAssetUrl(raw ?? "");
  if (normalized && isLikelyImageUrl(normalized)) {
    urls.add(normalized);
  }
}

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

function hasImageExtension(value: string): boolean {
  const withoutHash = value.split("#", 1)[0] ?? value;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  return IMAGE_EXTENSION_PATTERN.test(withoutQuery);
}

function extractDataBgImageUrls(content: string): string[] {
  const urls: string[] = [];
  for (const match of content.matchAll(DATA_BG_IMAGE_PATTERN)) {
    const raw = match[1]?.trim();
    if (raw) urls.push(raw);
  }
  return urls;
}

function extractCssBackgroundImageUrls(content: string): string[] {
  const urls: string[] = [];
  for (const match of content.matchAll(BACKGROUND_IMAGE_URL_PATTERN)) {
    const raw = match[2]?.trim();
    if (raw) urls.push(raw);
  }
  return urls;
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
    return hasImageExtension(url);
  }

  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const { pathname } = new URL(url);
    if (hasImageExtension(pathname)) return true;
  } catch {
    // fall through — malformed absolute URL
  }

  return hasImageExtension(url);
}

function pushFeaturedCandidate(
  candidates: FeaturedAssetCandidate[],
  raw: string | undefined,
  index: number,
  tier: 0 | 1,
): void {
  const normalized = normalizeAssetUrl(raw ?? "");
  if (!normalized || !isLikelyImageUrl(normalized)) return;
  candidates.push({ url: normalized, index, tier });
}

function collectFeaturedAssetCandidates(content: string): FeaturedAssetCandidate[] {
  const candidates: FeaturedAssetCandidate[] = [];

  for (const match of content.matchAll(DATA_BG_IMAGE_PATTERN)) {
    pushFeaturedCandidate(candidates, match[1], match.index ?? 0, 0);
  }
  for (const match of content.matchAll(BACKGROUND_IMAGE_URL_PATTERN)) {
    pushFeaturedCandidate(candidates, match[2], match.index ?? 0, 0);
  }
  for (const match of content.matchAll(HERO_URL_PARAM_PATTERN)) {
    pushFeaturedCandidate(candidates, match[1], match.index ?? 0, 0);
  }
  for (const match of content.matchAll(IMG_TAG_SRC_PATTERN)) {
    pushFeaturedCandidate(candidates, match[1], match.index ?? 0, 1);
  }
  for (const match of content.matchAll(INLINE_IMAGE_PARAM_PATTERN)) {
    pushFeaturedCandidate(candidates, match[1], match.index ?? 0, 1);
  }

  return candidates;
}

/**
 * Ordered featured-image candidates when `_thumbnail_id` is missing — heroes
 * (`data-bg-image`, CSS backgrounds, `bg_image=`) before inline assets; within
 * each tier, first in document order wins. Filename tokens (`_w`, `_2048`, …)
 * are not interpreted as quality signals.
 */
export function discoverFeaturedAssetCandidateUrls(content: string): string[] {
  if (!content.trim()) return [];

  const ranked = [...collectFeaturedAssetCandidates(content)].sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    return left.index - right.index;
  });

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    urls.push(candidate.url);
  }
  return urls;
}

/** Best featured-image URL from post/page HTML when attachment id is unavailable. */
export function resolveFeaturedContentAssetUrl(content: string): string | undefined {
  return discoverFeaturedAssetCandidateUrls(content)[0];
}

/**
 * Generic content-discovery pass: collect image URLs from HTML `<img>` tags,
 * section hero markers (`data-bg-image`), inline CSS backgrounds, and common
 * shortcode/builder attributes (`src=`, `image=`, `bg_image=`, …) without
 * parsing builder-specific structure (Tatsu, Elementor, etc.).
 */
export function discoverContentAssetUrls(content: string): string[] {
  if (!content.trim()) return [];

  const urls = new Set<string>();

  for (const raw of extractImgTagSrcs(content)) {
    ingestLikelyImageUrl(urls, raw);
  }

  for (const match of content.matchAll(SHORTCODE_IMAGE_PARAM_PATTERN)) {
    ingestLikelyImageUrl(urls, match[1]);
  }

  for (const match of content.matchAll(BARE_SRC_PARAM_PATTERN)) {
    ingestLikelyImageUrl(urls, match[1]);
  }

  for (const raw of extractDataBgImageUrls(content)) {
    ingestLikelyImageUrl(urls, raw);
  }

  for (const raw of extractCssBackgroundImageUrls(content)) {
    ingestLikelyImageUrl(urls, raw);
  }

  return [...urls];
}

/** @deprecated Use discoverContentAssetUrls — kept for call-site clarity during transition. */
export function extractInlineImageSrcs(content: string): string[] {
  return discoverContentAssetUrls(content);
}
