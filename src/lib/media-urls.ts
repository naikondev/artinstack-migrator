import * as cheerio from "cheerio";

// --- Origin URL rewrite (gateway → public origin before parse/discovery) ---

export interface OriginUrlRewriteRule {
  /** Literal substring or regex matched against the full text block. */
  match: string | RegExp;
  replace: string;
}

export interface OriginUrlRewriteConfig {
  rules: OriginUrlRewriteRule[];
}

/** Swap legacy gateway/staging host fragments before parse, fetch, or asset discovery. */
export function rewriteOriginUrlsInText(text: string, config: OriginUrlRewriteConfig): string {
  if (!text || config.rules.length === 0) return text;

  let result = text;
  for (const rule of config.rules) {
    if (typeof rule.match === "string") {
      if (!rule.match) continue;
      result = result.split(rule.match).join(rule.replace);
      continue;
    }
    result = result.replace(rule.match, rule.replace);
  }
  return result;
}

/** Build a rule that rewrites API-gateway `/prod/wp-content/` paths to a public origin. */
export function createWpContentGatewayRewrite(gatewayBase: string, publicOrigin: string): OriginUrlRewriteConfig {
  const normalizedGateway = gatewayBase.replace(/\/$/, "");
  const normalizedPublic = publicOrigin.replace(/\/$/, "");
  return {
    rules: [
      {
        match: `${normalizedGateway}/wp-content/`,
        replace: `${normalizedPublic}/wp-content/`,
      },
    ],
  };
}

// --- Content asset URL discovery & normalization ---

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

const DATA_WP_ATTACHMENT_ID_PATTERN = /\bdata-wp-attachment-id\s*=\s*["'](\d+)["']/gi;

/** Builder / core gallery shortcodes with explicit `ids=` lists (pre- or post-flatten). */
const SHORTCODE_GALLERY_IDS_PATTERN =
  /\[(?:gallery|oshine_gallery|vc_gallery|nggallery)\b[^\]]*\bids\s*=\s*["']([^"']+)["']/gi;

export interface ContentAssetDiscovery {
  /** Network-resolvable image paths (`<img>`, backgrounds, shortcode `image=` attrs, …). */
  urls: string[];
  /**
   * WordPress attachment post ids referenced in content without an inline URL in this
   * file context (`data-wp-attachment-id`, `[gallery ids=…]`, `[oshine_gallery ids=…]`, …).
   */
  unresolvedAttachmentIds: string[];
}

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

function parseAttachmentIdList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));
}

function extractAttachmentIdsFromContent(content: string): string[] {
  const ids = new Set<string>();

  for (const match of content.matchAll(DATA_WP_ATTACHMENT_ID_PATTERN)) {
    const id = match[1]?.trim();
    if (id) ids.add(id);
  }

  for (const match of content.matchAll(SHORTCODE_GALLERY_IDS_PATTERN)) {
    for (const id of parseAttachmentIdList(match[1])) {
      ids.add(id);
    }
  }

  return [...ids];
}

/**
 * Generic content-discovery pass: collect resolvable image URLs and attachment ids
 * that still need an index / REST / crawl resolution step.
 */
export function discoverContentAssets(content: string): ContentAssetDiscovery {
  if (!content.trim()) {
    return { urls: [], unresolvedAttachmentIds: [] };
  }

  const urls = new Set<string>();

  for (const raw of extractImgTagSrcs(content)) {
    if (isMigrationMediaRef(raw)) {
      const sourceId = parseMigrationMediaRef(raw);
      if (sourceId?.startsWith("url:")) {
        ingestLikelyImageUrl(urls, sourceId.slice("url:".length));
      }
      continue;
    }
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

  return {
    urls: [...urls],
    unresolvedAttachmentIds: extractAttachmentIdsFromContent(content),
  };
}

/**
 * Generic content-discovery pass: collect image URLs from HTML `<img>` tags,
 * section hero markers (`data-bg-image`), inline CSS backgrounds, and common
 * shortcode/builder attributes (`src=`, `image=`, `bg_image=`, …) without
 * parsing builder-specific structure (Tatsu, Elementor, etc.).
 */
export function discoverContentAssetUrls(content: string): string[] {
  return discoverContentAssets(content).urls;
}

/** @deprecated Use discoverContentAssetUrls — kept for call-site clarity during transition. */
export function extractInlineImageSrcs(content: string): string[] {
  return discoverContentAssetUrls(content);
}

// --- Migration media refs (`artinstack-migration://asset/{sourceId}`) ---

/** Pseudo-URL scheme for portable migration asset pointers (not WordPress shortcodes). */
export const MIGRATION_MEDIA_REF_SCHEME = "artinstack-migration://asset/";

/** Build `artinstack-migration://asset/{sourceId}` (percent-encodes the normalizer source id). */
export function formatMigrationMediaRef(sourceAssetId: string): string {
  return `${MIGRATION_MEDIA_REF_SCHEME}${encodeURIComponent(sourceAssetId)}`;
}

export function isMigrationMediaRef(value: string): boolean {
  return value.trim().startsWith(MIGRATION_MEDIA_REF_SCHEME);
}

/** Parse a migration media ref back to the normalizer `sourceId`, or `undefined` if not a ref. */
export function parseMigrationMediaRef(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith(MIGRATION_MEDIA_REF_SCHEME)) return undefined;
  const encoded = trimmed.slice(MIGRATION_MEDIA_REF_SCHEME.length);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Default `replaceWith` for `rewriteInlineImages` / `stampMigrationMediaRefs` (OSS-14). */
export function createMigrationMediaRefReplaceWith(): (
  ref: { sourceAssetId?: string },
) => string {
  return (ref) => {
    if (!ref.sourceAssetId) return "";
    return formatMigrationMediaRef(ref.sourceAssetId);
  };
}

// --- Canonical inline keys & lookup index (OSS-15) ---

export interface CanonicalInlineAssetUrl {
  /** Canonical absolute URL stored on `NormalizedAsset.sourceUrl`. */
  canonicalUrl: string;
  /** Normalizer id: `url:{canonicalUrl}`. */
  sourceId: string;
}

/**
 * OSS-15: one canonical key for inline `url:` assets — apply origin rewrite then
 * `normalizeAssetUrl` so discovery, refs, and vault entities share the same id.
 */
export function canonicalizeInlineAssetUrl(
  raw: string,
  originUrlRewrite?: OriginUrlRewriteConfig,
): CanonicalInlineAssetUrl | undefined {
  let value = raw.trim();
  if (!value || value.startsWith("data:")) return undefined;

  if (originUrlRewrite) {
    value = rewriteOriginUrlsInText(value, originUrlRewrite);
  }

  const canonicalUrl = normalizeAssetUrl(value);
  if (!canonicalUrl) return undefined;

  return {
    canonicalUrl,
    sourceId: `url:${canonicalUrl}`,
  };
}

function urlPathname(url: string): string | undefined {
  try {
    return new URL(url, "http://migration.local").pathname;
  } catch {
    return undefined;
  }
}

/**
 * Map normalized upload URLs (and pathnames) → normalizer `sourceId`.
 * Attachment ids are WXR `post_id` strings; inline discoveries use `url:{src}`.
 */
export function buildMigrationMediaUrlIndex(
  entries: Iterable<{ sourceUrl: string; sourceId: string }>,
): Map<string, string> {
  const index = new Map<string, string>();

  for (const entry of entries) {
    index.set(entry.sourceUrl, entry.sourceId);
    const normalized = normalizeAssetUrl(entry.sourceUrl);
    if (normalized) index.set(normalized, entry.sourceId);
    const pathname = urlPathname(entry.sourceUrl);
    if (pathname) index.set(pathname, entry.sourceId);
  }

  return index;
}

export function resolveMigrationMediaSourceId(
  src: string,
  urlIndex: Map<string, string>,
  originUrlRewrite?: OriginUrlRewriteConfig,
): string | undefined {
  const canonical = canonicalizeInlineAssetUrl(src, originUrlRewrite);
  const normalized = canonical?.canonicalUrl ?? normalizeAssetUrl(src);
  if (!normalized) return undefined;

  return (
    urlIndex.get(normalized) ??
    urlIndex.get(src) ??
    (urlPathname(normalized) ? urlIndex.get(urlPathname(normalized)!) : undefined)
  );
}

/** Merge attachment + inline asset rows into one stamp/lookup index (OSS-15). */
export function buildContentMediaUrlIndex(
  entries: Iterable<{ sourceUrl: string; sourceId: string }>,
  originUrlRewrite?: OriginUrlRewriteConfig,
): Map<string, string> {
  const canonicalEntries: { sourceUrl: string; sourceId: string }[] = [];
  for (const entry of entries) {
    const canonical = canonicalizeInlineAssetUrl(entry.sourceUrl, originUrlRewrite);
    canonicalEntries.push({
      sourceUrl: canonical?.canonicalUrl ?? entry.sourceUrl,
      sourceId: entry.sourceId,
    });
  }
  return buildMigrationMediaUrlIndex(canonicalEntries);
}
