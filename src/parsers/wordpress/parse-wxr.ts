import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { XMLParser } from "fast-xml-parser";

import {
  buildContentMediaUrlIndex,
  canonicalizeInlineAssetUrl,
  discoverContentAssets,
  parseMigrationMediaRef,
  resolveFeaturedContentAssetUrl,
  rewriteOriginUrlsInText,
  type OriginUrlRewriteConfig,
} from "../../lib/media-urls.js";
import { stampMigrationMediaRefs } from "../../transformers/rewrite-inline-images.js";
import { linkToPath, sanitizeSlug } from "../../lib/utility.js";
import { flattenWordPressBuilders, parseSliderMetaValue, parseSliderShortcodeMarkup } from "./builders/flatten.js";
import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedEntity,
  NormalizedPage,
  NormalizedPost,
  NormalizedTag,
  PageHeroSliderHint,
  PageLayoutHints,
  PublishStatus,
  SourceMetadata,
  WxrImportSummary,
} from "../../normalizer/types.js";

const PLATFORM = "wordpress" as const;

/** OSS-18 — theme/plugin CPT slugs emitted as `NormalizedPage` (default: Oshine `portfolio`). */
export const DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS = ["portfolio"] as const;

const WOOCOMMERCE_STUB_PAGE_SLUGS = new Set(["cart", "checkout", "my-account"]);
const WOOCOMMERCE_STUB_SHORTCODE = /^\[woocommerce_(?:cart|checkout|my_account)\]\s*$/i;

function isWooCommerceStubPage(slug: string, contentHtml: string): boolean {
  if (WOOCOMMERCE_STUB_PAGE_SLUGS.has(slug)) return true;
  const trimmed = contentHtml.trim();
  if (!trimmed) return false;
  return WOOCOMMERCE_STUB_SHORTCODE.test(trimmed);
}

export interface WxrParseOptions {
  filePath: string;
  exportedAt?: string;
  /** Swap legacy gateway/staging domains before parse, fetch, or asset discovery. */
  originUrlRewrite?: OriginUrlRewriteConfig;
  /** Pre-DTO builder flattening (Bucket 1 + Bucket 2). Default: true. */
  flattenBuilders?: boolean;
  /** Omit WooCommerce cart/checkout/my-account stub pages. Default: true. */
  skipWooCommerceStubPages?: boolean;
  /**
   * After asset discovery, stamp resolved upload URLs as OSS-14 migration media refs
   * in emitted `contentHtml`. Default: true.
   */
  stampMigrationMediaRefs?: boolean;
  /**
   * WordPress CPT slugs to emit as `NormalizedPage` (OSS-18).
   * Default: `portfolio`. Extend with `jetpack-portfolio`, `project`, etc.
   */
  portfolioCptSlugs?: readonly string[];
}

interface WxrItem {
  title?: string;
  link?: string;
  encoded?: string;
  post_id?: string | number;
  post_date?: string;
  post_name?: string;
  status?: string;
  post_type?: string;
  attachment_url?: string;
  postmeta?: WxrPostMeta | WxrPostMeta[];
  category?: WxrCategory | WxrCategory[];
}

interface WxrPostMeta {
  meta_key?: string;
  meta_value?: string | number;
}

interface WxrCategory {
  "@_domain"?: string;
  "@_nicename"?: string;
  "#text"?: string;
}

interface AttachmentIndexEntry {
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  title?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "#text" in value) {
    return String((value as { "#text": unknown })["#text"] ?? "");
  }
  return String(value);
}

function mapPublishStatus(wpStatus: string | undefined): PublishStatus {
  switch ((wpStatus ?? "").toLowerCase()) {
    case "publish":
      return "published";
    case "draft":
    case "pending":
      return "draft";
    default:
      return "archived";
  }
}

function getContentEncoded(item: WxrItem): string {
  const content = (item as { content?: { encoded?: string } | string }).content;
  if (content !== undefined) {
    if (typeof content === "string") return content;
    return textValue(content.encoded);
  }
  return textValue(item.encoded);
}

function sourceMeta(
  id: string,
  link?: string,
  exportedAt?: string,
  postType?: string,
): SourceMetadata {
  return {
    platform: PLATFORM,
    id,
    url: link || undefined,
    path: linkToPath(link),
    exportedAt,
    ...(postType ? { postType } : {}),
  };
}

function resolvePortfolioCptSlugs(options: WxrParseOptions): Set<string> {
  const slugs = options.portfolioCptSlugs ?? DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS;
  return new Set(slugs.map((slug) => slug.toLowerCase()));
}

function portfolioCptSourceId(postId: string): string {
  return `portfolio:${postId}`;
}

function isPortfolioCptPostType(postType: string, portfolioCptSlugs: Set<string>): boolean {
  return portfolioCptSlugs.has(postType.toLowerCase());
}

function countWxrPortfolioCptItems(
  items: WxrItem[],
  portfolioCptSlugs: Set<string> = new Set(DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS),
): number {
  return items.filter((item) => isPortfolioCptPostType(textValue(item.post_type), portfolioCptSlugs))
    .length;
}

/** OSS-19 — dry-run accounting for WXR rows omitted by `parse-wxr`. */
export type { WxrImportSummary } from "../../normalizer/types.js";

function isImportableWxrPostType(postType: string, portfolioCptSlugs: Set<string>): boolean {
  const normalized = postType.toLowerCase();
  return (
    normalized === "post" ||
    normalized === "page" ||
    normalized === "attachment" ||
    isPortfolioCptPostType(normalized, portfolioCptSlugs)
  );
}

function contentForWooStubCheck(item: WxrItem, options: WxrParseOptions): string {
  let html = getContentEncoded(item);
  if (options.originUrlRewrite) {
    html = rewriteOriginUrlsInText(html, options.originUrlRewrite);
  }
  if (options.flattenBuilders !== false) {
    html = flattenWordPressBuilders(html).html;
  }
  return html;
}

/** Count importable vs skipped WXR items without emitting DTOs. */
export function summarizeWxrImport(items: WxrItem[], options: WxrParseOptions): WxrImportSummary {
  const portfolioCptSlugs = resolvePortfolioCptSlugs(options);
  let importableItemCount = 0;
  let skippedWooCommerceStubPages = 0;
  const skippedPostTypes: Record<string, number> = {};

  for (const item of items) {
    const postType = textValue(item.post_type) || "unknown";
    const normalizedType = postType.toLowerCase();

    if (isImportableWxrPostType(normalizedType, portfolioCptSlugs)) {
      if (
        normalizedType === "page" &&
        options.skipWooCommerceStubPages !== false &&
        isWooCommerceStubPage(
          sanitizeSlug(textValue(item.post_name) || textValue(item.title) || textValue(item.post_id)),
          contentForWooStubCheck(item, options),
        )
      ) {
        skippedWooCommerceStubPages++;
        continue;
      }
      importableItemCount++;
      continue;
    }

    skippedPostTypes[normalizedType] = (skippedPostTypes[normalizedType] ?? 0) + 1;
  }

  const skippedUnsupported = Object.values(skippedPostTypes).reduce((sum, count) => sum + count, 0);

  return {
    importableItemCount,
    unsupportedOnly: importableItemCount === 0 && skippedUnsupported > 0,
    skippedPostTypes,
    ...(skippedWooCommerceStubPages > 0
      ? { skippedWooCommerceStubPages }
      : {}),
  };
}

export async function summarizeWxrImportFromFile(
  filePath: string,
  options: WxrParseOptions = { filePath },
): Promise<WxrImportSummary> {
  const xml = await readFile(filePath, "utf8");
  return summarizeWxrImport(parseItems(xml), options);
}

function getExcerpt(item: WxrItem): string {
  const excerpt = (item as { excerpt?: { encoded?: string } | string }).excerpt;
  if (!excerpt) return "";
  if (typeof excerpt === "string") return excerpt;
  return textValue(excerpt.encoded);
}

function getPostMeta(item: WxrItem, key: string): string | undefined {
  for (const meta of asArray(item.postmeta)) {
    if (textValue(meta.meta_key) === key) {
      return textValue(meta.meta_value);
    }
  }
  return undefined;
}

/** Common WordPress slugs for the site portfolio listing page (not CPT singles). */
const PORTFOLIO_LISTING_PAGE_SLUGS = new Set([
  "portfolio",
  "work",
  "works",
  "gallery",
  "projects",
  "our-work",
]);

function inferPortfolioListingPage(
  item: WxrItem,
  options: {
    postType: string;
    isPortfolioCpt: boolean;
    slug: string;
    contentHtml: string;
  },
): boolean {
  if (options.isPortfolioCpt || options.postType !== "page") return false;

  const template = (getPostMeta(item, "_wp_page_template") ?? "").trim().toLowerCase();
  if (template.includes("portfolio") && template !== "default") return true;

  const hasPortfolioListingWidget = /data-wp-widget=["']portfolio["']/i.test(options.contentHtml);
  return (
    hasPortfolioListingWidget && PORTFOLIO_LISTING_PAGE_SLUGS.has(options.slug.toLowerCase())
  );
}

function toHeroSliderHint(
  parsed: { plugin: PageHeroSliderHint["plugin"]; alias: string; slidertitle?: string },
  source: PageHeroSliderHint["source"],
): PageHeroSliderHint {
  return {
    plugin: parsed.plugin,
    alias: parsed.alias,
    slidertitle: parsed.slidertitle,
    source,
  };
}

function findSliderInTatsuTree(node: unknown): PageHeroSliderHint | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSliderInTatsuTree(child);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== "object") return undefined;

  const obj = node as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "";
  if (name === "tatsu_rev_slider") {
    const atts = obj.atts as Record<string, unknown> | undefined;
    const alias =
      typeof atts?.rev_slider_alias === "string" ? atts.rev_slider_alias.trim() : "";
    if (alias) {
      return toHeroSliderHint({ plugin: "revslider", alias }, "tatsu-json");
    }
  }
  if (name === "masterslider" || name === "tatsu_masterslider") {
    const atts = obj.atts as Record<string, unknown> | undefined;
    const alias = typeof atts?.alias === "string" ? atts.alias.trim() : "";
    if (alias) {
      return toHeroSliderHint({ plugin: "masterslider", alias }, "tatsu-json");
    }
  }

  if (obj.inner) return findSliderInTatsuTree(obj.inner);
  return undefined;
}

/** RevSlider / MasterSlider hero slot from post meta — not flattened into contentHtml (OSS-27). */
function inferHeroSliderLayoutHint(item: WxrItem): PageLayoutHints | undefined {
  const shortcodeMeta = getPostMeta(item, "be_themes_hero_section_slider_shortcode");
  if (shortcodeMeta) {
    const parsed = parseSliderShortcodeMarkup(shortcodeMeta);
    if (parsed) {
      return { heroSlider: toHeroSliderHint(parsed, "meta-shortcode") };
    }
  }

  const sliderMeta = getPostMeta(item, "_slider");
  if (sliderMeta) {
    const parsed = parseSliderMetaValue(sliderMeta);
    if (parsed) {
      return { heroSlider: toHeroSliderHint(parsed, "meta-slider-field") };
    }
  }

  const heroSection = (getPostMeta(item, "be_themes_hero_section") ?? "").trim().toLowerCase();
  if (heroSection === "slider") {
    const tatsuContent = getPostMeta(item, "_tatsu_page_content");
    if (tatsuContent) {
      try {
        const heroSlider = findSliderInTatsuTree(JSON.parse(tatsuContent));
        if (heroSlider) return { heroSlider };
      } catch {
        // Non-JSON Tatsu meta — skip
      }
    }
  }

  return undefined;
}

function parseItems(xml: string): WxrItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    trimValues: false,
    parseTagValue: false,
  });

  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: WxrItem | WxrItem[] } };
  };

  return asArray(doc.rss?.channel?.item);
}

function buildAttachmentIndex(
  items: WxrItem[],
  originUrlRewrite?: OriginUrlRewriteConfig,
): Map<string, AttachmentIndexEntry> {
  const index = new Map<string, AttachmentIndexEntry>();

  for (const item of items) {
    if (textValue(item.post_type) !== "attachment") continue;
    const id = textValue(item.post_id);
    const rawUrl = textValue(item.attachment_url) || textValue(item.link);
    if (!id || !rawUrl) continue;
    const canonical = canonicalizeInlineAssetUrl(rawUrl, originUrlRewrite);
    if (!canonical) continue;
    const url = canonical.canonicalUrl;

    const filename = basename(new URL(url, "http://local.invalid").pathname) || `attachment-${id}`;
    index.set(id, {
      sourceUrl: url,
      filename,
      mimeType: getPostMeta(item, "_wp_attached_file") ? undefined : guessMime(filename),
      title: textValue(item.title),
    });
  }

  return index;
}

function guessMime(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  return ext ? map[ext] : undefined;
}

function collectTaxonomies(items: WxrItem[]): {
  categories: Map<string, NormalizedCategory>;
  tags: Map<string, NormalizedTag>;
} {
  const categories = new Map<string, NormalizedCategory>();
  const tags = new Map<string, NormalizedTag>();

  for (const item of items) {
    const postType = textValue(item.post_type);
    if (postType !== "post" && postType !== "page") continue;

    for (const cat of asArray(item.category)) {
      const domain = cat["@_domain"] ?? "";
      const nicename = sanitizeSlug(cat["@_nicename"] ?? textValue(cat["#text"]));
      const name = textValue(cat["#text"]) || nicename;
      if (!nicename) continue;

      if (domain === "category") {
        if (!categories.has(nicename)) {
          categories.set(nicename, {
            type: "category",
            source: sourceMeta(`cat:${nicename}`),
            sourceId: `cat:${nicename}`,
            name,
            slug: nicename,
          });
        }
      } else if (domain === "post_tag") {
        if (!tags.has(nicename)) {
          tags.set(nicename, {
            type: "tag",
            source: sourceMeta(`tag:${nicename}`),
            sourceId: `tag:${nicename}`,
            name,
            slug: nicename,
          });
        }
      }
    }
  }

  return { categories, tags };
}

function collectInlineAssets(
  html: string,
  attachmentIndex: Map<string, AttachmentIndexEntry>,
  seenUrls: Set<string>,
  seenAttachmentIds: Set<string>,
  exportedAt?: string,
  originUrlRewrite?: OriginUrlRewriteConfig,
): NormalizedAsset[] {
  const assets: NormalizedAsset[] = [];
  const discovery = discoverContentAssets(html);

  for (const discovered of discovery.urls) {
    const canonical = canonicalizeInlineAssetUrl(discovered, originUrlRewrite);
    if (!canonical) continue;
    if (seenUrls.has(canonical.canonicalUrl)) continue;
    seenUrls.add(canonical.canonicalUrl);

    let filename: string;
    try {
      filename =
        basename(new URL(canonical.canonicalUrl, "http://local.invalid").pathname) || "inline-asset";
    } catch {
      filename = "inline-asset";
    }

    assets.push({
      type: "asset",
      source: sourceMeta(canonical.sourceId, canonical.canonicalUrl, exportedAt),
      sourceId: canonical.sourceId,
      sourceUrl: canonical.canonicalUrl,
      filename,
      mimeType: guessMime(filename),
    });
  }

  for (const attachmentId of discovery.unresolvedAttachmentIds) {
    if (seenAttachmentIds.has(attachmentId)) continue;
    seenAttachmentIds.add(attachmentId);

    const entry = attachmentIndex.get(attachmentId);
    if (!entry) continue;

    if (seenUrls.has(entry.sourceUrl)) continue;
    seenUrls.add(entry.sourceUrl);

    assets.push({
      type: "asset",
      source: sourceMeta(attachmentId, entry.sourceUrl, exportedAt),
      sourceId: attachmentId,
      sourceUrl: entry.sourceUrl,
      filename: entry.filename,
      mimeType: entry.mimeType ?? guessMime(entry.filename),
      caption: entry.title,
    });
  }

  return assets;
}

function preprocessContent(rawHtml: string, options: WxrParseOptions): string {
  let html = rawHtml;
  if (options.originUrlRewrite) {
    html = rewriteOriginUrlsInText(html, options.originUrlRewrite);
  }
  if (options.flattenBuilders !== false) {
    html = flattenWordPressBuilders(html).html;
  }
  return html;
}

function resolveFeaturedAssetSourceId(
  thumbnailId: string | undefined,
  attachmentIndex: Map<string, AttachmentIndexEntry>,
  contentHtml: string,
  originUrlRewrite?: OriginUrlRewriteConfig,
): string | undefined {
  if (thumbnailId && attachmentIndex.has(thumbnailId)) {
    return thumbnailId;
  }
  const featuredUrl = resolveFeaturedContentAssetUrl(contentHtml);
  if (!featuredUrl) return undefined;

  const fromRef = parseMigrationMediaRef(featuredUrl);
  if (fromRef) return fromRef;

  return canonicalizeInlineAssetUrl(featuredUrl, originUrlRewrite)?.sourceId;
}

function maybeRewriteUrl(url: string | undefined, config?: OriginUrlRewriteConfig): string | undefined {
  if (!url) return undefined;
  if (!config) return url;
  return rewriteOriginUrlsInText(url, config);
}

export async function* enumerateWxrEntities(
  options: WxrParseOptions,
): AsyncGenerator<NormalizedEntity> {
  const xml = await readFile(options.filePath, "utf8");
  const items = parseItems(xml);
  const attachmentIndex = buildAttachmentIndex(items, options.originUrlRewrite);
  const { categories, tags } = collectTaxonomies(items);
  const seenAssetUrls = new Set<string>();
  const emittedAttachmentIds = new Set<string>();

  for (const category of categories.values()) {
    yield category;
  }
  for (const tag of tags.values()) {
    yield tag;
  }

  // Emit attachment assets
  for (const [id, entry] of attachmentIndex) {
    emittedAttachmentIds.add(id);
    seenAssetUrls.add(entry.sourceUrl);
    yield {
      type: "asset",
      source: sourceMeta(id, entry.sourceUrl, options.exportedAt),
      sourceId: id,
      sourceUrl: entry.sourceUrl,
      filename: entry.filename,
      mimeType: entry.mimeType,
      caption: entry.title,
    } satisfies NormalizedAsset;
  }

  const portfolioCptSlugs = resolvePortfolioCptSlugs(options);

  for (const item of items) {
    const postType = textValue(item.post_type);
    const isPost = postType === "post";
    const isPage = postType === "page";
    const isPortfolioCpt = isPortfolioCptPostType(postType, portfolioCptSlugs);
    if (!isPost && !isPage && !isPortfolioCpt) continue;

    const id = textValue(item.post_id);
    const link = maybeRewriteUrl(textValue(item.link), options.originUrlRewrite);
    const slug = sanitizeSlug(textValue(item.post_name) || textValue(item.title) || id);
    let contentHtml = preprocessContent(getContentEncoded(item), options);

    if (
      isPage &&
      options.skipWooCommerceStubPages !== false &&
      isWooCommerceStubPage(slug, contentHtml)
    ) {
      continue;
    }

    const inlineAssets = collectInlineAssets(
      contentHtml,
      attachmentIndex,
      seenAssetUrls,
      emittedAttachmentIds,
      options.exportedAt,
      options.originUrlRewrite,
    );
    for (const asset of inlineAssets) {
      yield asset;
    }

    if (options.stampMigrationMediaRefs !== false) {
      const urlIndex = buildContentMediaUrlIndex(
        [
          ...[...attachmentIndex.entries()].map(([sourceId, entry]) => ({
            sourceId,
            sourceUrl: entry.sourceUrl,
          })),
          ...inlineAssets.map((asset) => ({
            sourceId: asset.sourceId,
            sourceUrl: asset.sourceUrl,
          })),
        ],
        options.originUrlRewrite,
      );
      contentHtml = stampMigrationMediaRefs(contentHtml, {
        urlToSourceId: urlIndex,
        originUrlRewrite: options.originUrlRewrite,
      }).html;
    }

    const categorySlugs: string[] = [];
    const tagSlugs: string[] = [];
    for (const cat of asArray(item.category)) {
      const domain = cat["@_domain"] ?? "";
      const nicename = sanitizeSlug(cat["@_nicename"] ?? textValue(cat["#text"]));
      if (!nicename) continue;
      if (domain === "category") categorySlugs.push(nicename);
      if (domain === "post_tag") tagSlugs.push(nicename);
    }

    if (isPost) {
      const thumbnailId = getPostMeta(item, "_thumbnail_id");
      const featuredAssetSourceId = resolveFeaturedAssetSourceId(
        thumbnailId,
        attachmentIndex,
        contentHtml,
        options.originUrlRewrite,
      );

      const post: NormalizedPost = {
        type: "post",
        source: sourceMeta(id, link, options.exportedAt),
        sourceId: id,
        title: textValue(item.title) || slug,
        slug,
        excerpt: getExcerpt(item) || undefined,
        contentHtml,
        publishedAt: textValue(item.post_date) || undefined,
        status: mapPublishStatus(textValue(item.status)),
        categorySlugs: categorySlugs.length ? categorySlugs : undefined,
        tagSlugs: tagSlugs.length ? tagSlugs : undefined,
        sourceFeaturedMediaId: thumbnailId,
        featuredAssetSourceId,
      };
      yield post;
    } else {
      const isHomePage =
        !isPortfolioCpt &&
        (getPostMeta(item, "_wp_show_on_front") === "1" ||
          getPostMeta(item, "page_on_front") === "1");

      const isPortfolioPage =
        !isPortfolioCpt &&
        inferPortfolioListingPage(item, {
          postType,
          isPortfolioCpt,
          slug,
          contentHtml,
        });

      const layoutHints = inferHeroSliderLayoutHint(item);

      const pageSourceId = isPortfolioCpt ? portfolioCptSourceId(id) : id;

      const page: NormalizedPage = {
        type: "page",
        source: sourceMeta(pageSourceId, link, options.exportedAt, isPortfolioCpt ? postType : undefined),
        sourceId: pageSourceId,
        title: textValue(item.title) || slug,
        slug,
        contentHtml,
        isHomePage: isHomePage || undefined,
        isPortfolioPage: isPortfolioPage || undefined,
        layoutHints: layoutHints ?? undefined,
        status: mapPublishStatus(textValue(item.status)),
      };
      yield page;
    }
  }
}

export async function validateWxrFile(
  filePath: string,
  options: WxrParseOptions = { filePath },
): Promise<{
  ok: boolean;
  issues: { code: string; message: string }[];
  summary: Record<string, number>;
  importSummary: WxrImportSummary;
}> {
  const issues: { code: string; message: string }[] = [];
  let xml: string;
  try {
    xml = await readFile(filePath, "utf8");
  } catch {
    return {
      ok: false,
      issues: [{ code: "file_not_found", message: `Cannot read file: ${filePath}` }],
      summary: {},
      importSummary: {
        importableItemCount: 0,
        unsupportedOnly: false,
        skippedPostTypes: {},
      },
    };
  }

  const looksLikeWxr =
    xml.includes("<rss") &&
    (xml.includes("wp:wxr_version") ||
      xml.includes("xmlns:wp=") ||
      xml.includes("WordPress eXtended RSS"));
  if (!looksLikeWxr) {
    issues.push({ code: "invalid_wxr", message: "File does not appear to be WordPress WXR" });
  }

  const items = parseItems(xml);
  const importSummary = summarizeWxrImport(items, { ...options, filePath });
  const summary = {
    posts: items.filter((i) => textValue(i.post_type) === "post").length,
    pages: items.filter((i) => textValue(i.post_type) === "page").length,
    assets: items.filter((i) => textValue(i.post_type) === "attachment").length,
    portfolioCpt: countWxrPortfolioCptItems(items),
    categories: 0,
    tags: 0,
    importableItemCount: importSummary.importableItemCount,
  };

  const { categories, tags } = collectTaxonomies(items);
  summary.categories = categories.size;
  summary.tags = tags.size;

  return { ok: issues.length === 0, issues, summary, importSummary };
}
