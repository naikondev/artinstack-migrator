import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { XMLParser } from "fast-xml-parser";

import {
  buildContentMediaUrlIndex,
  canonicalizeInlineAssetUrl,
  discoverContentAssetUrls,
  parseMigrationMediaRef,
  resolveFeaturedContentAssetUrl,
  rewriteOriginUrlsInText,
  type OriginUrlRewriteConfig,
} from "../../lib/media-urls.js";
import { stampMigrationMediaRefs } from "../../transformers/rewrite-inline-images.js";
import { linkToPath, sanitizeSlug } from "../../lib/utility.js";
import { flattenWordPressBuilders } from "./builders/flatten.js";
import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedEntity,
  NormalizedPage,
  NormalizedPost,
  NormalizedTag,
  PublishStatus,
  SourceMetadata,
} from "../../normalizer/types.js";

const PLATFORM = "wordpress" as const;

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

function sourceMeta(id: string, link?: string, exportedAt?: string): SourceMetadata {
  return {
    platform: PLATFORM,
    id,
    url: link || undefined,
    path: linkToPath(link),
    exportedAt,
  };
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
  exportedAt?: string,
  originUrlRewrite?: OriginUrlRewriteConfig,
): NormalizedAsset[] {
  const assets: NormalizedAsset[] = [];
  for (const discovered of discoverContentAssetUrls(html)) {
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

  // Resolve attachment-index URLs referenced in content if not already seen
  for (const [id, entry] of attachmentIndex) {
    if (seenUrls.has(entry.sourceUrl)) continue;
    // Only auto-include attachments referenced via wp-content in posts is handled by inline src
    void id;
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

  for (const item of items) {
    const postType = textValue(item.post_type);
    if (postType !== "post" && postType !== "page") continue;

    const id = textValue(item.post_id);
    const link = maybeRewriteUrl(textValue(item.link), options.originUrlRewrite);
    const slug = sanitizeSlug(textValue(item.post_name) || textValue(item.title) || id);
    let contentHtml = preprocessContent(getContentEncoded(item), options);

    if (
      postType === "page" &&
      options.skipWooCommerceStubPages !== false &&
      isWooCommerceStubPage(slug, contentHtml)
    ) {
      continue;
    }

    const inlineAssets = collectInlineAssets(
      contentHtml,
      attachmentIndex,
      seenAssetUrls,
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

    if (postType === "post") {
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
        getPostMeta(item, "_wp_show_on_front") === "1" ||
        getPostMeta(item, "page_on_front") === "1";

      const page: NormalizedPage = {
        type: "page",
        source: sourceMeta(id, link, options.exportedAt),
        sourceId: id,
        title: textValue(item.title) || slug,
        slug,
        contentHtml,
        isHomePage: isHomePage || undefined,
        status: mapPublishStatus(textValue(item.status)),
      };
      yield page;
    }
  }
}

export async function validateWxrFile(filePath: string): Promise<{
  ok: boolean;
  issues: { code: string; message: string }[];
  summary: Record<string, number>;
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
  const summary = {
    posts: items.filter((i) => textValue(i.post_type) === "post").length,
    pages: items.filter((i) => textValue(i.post_type) === "page").length,
    assets: items.filter((i) => textValue(i.post_type) === "attachment").length,
    portfolios: 0,
    categories: 0,
    tags: 0,
  };

  const { categories, tags } = collectTaxonomies(items);
  summary.categories = categories.size;
  summary.tags = tags.size;

  return { ok: issues.length === 0, issues, summary };
}
