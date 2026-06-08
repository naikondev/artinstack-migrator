import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { XMLParser } from "fast-xml-parser";

import { discoverContentAssetUrls } from "../../lib/content-asset-urls.js";
import { linkToPath, sanitizeSlug } from "../../lib/utility.js";
import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedEntity,
  NormalizedPage,
  NormalizedPost,
  NormalizedTag,
  PublishStatus,
  SourceMetadata,
  ValidationIssue,
} from "../../normalizer/types.js";
import { assertWixExport, WixCollectionClient, type WixClientOptions } from "./api.js";
import { WixPageSnapshotCollector, loadUrlListFile, type WixSnapshotClientOptions } from "./snapshot.js";
import type { WixExport, WixFeedFormat, WixPage, WixPost, WixSnapshotGap, WixSnapshotTarget } from "./types.js";

export interface WixParseOptions {
  filePath?: string;
  urlsFile?: string;
  data?: WixExport;
  client?: WixCollectionClient;
  clientOptions?: WixClientOptions;
  snapshotTargets?: WixSnapshotTarget[];
  snapshotOptions?: WixSnapshotClientOptions;
  exportedAt?: string;
}

const PLATFORM = "wix" as const;

interface FeedCategory {
  "@_domain"?: string;
  "@_term"?: string;
  "#text"?: string;
}

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  description?: unknown;
  category?: FeedCategory | FeedCategory[] | string | string[];
  content?: { encoded?: unknown } | string;
  encoded?: unknown;
}

interface AtomLink {
  "@_href"?: string;
  "@_rel"?: string;
}

interface AtomEntry {
  title?: unknown;
  link?: AtomLink | AtomLink[] | string;
  id?: unknown;
  published?: unknown;
  updated?: unknown;
  summary?: unknown;
  content?: { "@_type"?: string; "#text"?: unknown } | string;
  category?: FeedCategory | FeedCategory[] | string | string[];
}

export interface WixFeedSummary {
  posts: number;
  categories: number;
  tags: number;
  assets: number;
  format: WixFeedFormat;
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

function sourceMeta(id: string, url?: string, exportedAt?: string): SourceMetadata {
  return {
    platform: PLATFORM,
    id,
    url: url || undefined,
    path: linkToPath(url),
    exportedAt,
  };
}

function guessMime(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
  };
  return ext ? map[ext] : undefined;
}

function parseXmlDocument(xml: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    trimValues: false,
    parseTagValue: false,
  });
  return parser.parse(xml);
}

export function detectWixFeedFormat(xml: string): WixFeedFormat {
  const trimmed = xml.trim();
  if (trimmed.includes("<feed") || trimmed.startsWith("<feed")) return "atom";
  return "rss";
}

function getItemContentHtml(item: RssItem | AtomEntry): string {
  const content = (item as RssItem).content ?? (item as AtomEntry).content;
  if (content !== undefined) {
    if (typeof content === "string") return content;
    const block = content as { encoded?: unknown; "#text"?: unknown };
    if (block["#text"] !== undefined) return textValue(block["#text"]);
    if (block.encoded !== undefined) return textValue(block.encoded);
  }

  const rssItem = item as RssItem;
  if (rssItem.encoded !== undefined) return textValue(rssItem.encoded);

  return textValue(rssItem.description ?? (item as AtomEntry).summary);
}

function slugFromLink(link: string, title: string, fallbackId: string): string {
  try {
    const pathname = new URL(link).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last) return sanitizeSlug(last);
  } catch {
    // fall through
  }
  return sanitizeSlug(title || fallbackId);
}

function itemLink(item: RssItem | AtomEntry): string {
  const rssLink = textValue((item as RssItem).link);
  if (rssLink) return rssLink;

  for (const link of asArray((item as AtomEntry).link)) {
    if (typeof link === "string" && link) return link;
    if (typeof link === "object" && link !== null) {
      const rel = link["@_rel"];
      const href = link["@_href"];
      if (href && (!rel || rel === "alternate")) return href;
    }
  }
  return "";
}

function itemSourceId(item: RssItem | AtomEntry, link: string, slug: string): string {
  const guid = textValue((item as RssItem).guid);
  if (guid) return guid;
  const atomId = textValue((item as AtomEntry).id);
  if (atomId) return atomId;
  if (link) return link;
  return slug;
}

function itemPublishedAt(item: RssItem | AtomEntry): string | undefined {
  const pubDate =
    textValue((item as RssItem).pubDate) ||
    textValue((item as AtomEntry).published) ||
    textValue((item as AtomEntry).updated) ||
    textValue((item as RssItem).published);
  return pubDate || undefined;
}

function normalizeCategoryLabel(category: FeedCategory | string): { domain?: string; label: string } {
  if (typeof category === "string") {
    return { label: category.trim() };
  }
  return {
    domain: category["@_domain"]?.toLowerCase(),
    label: textValue(category["#text"] ?? category["@_term"]).trim(),
  };
}

function collectTaxonomiesFromItems(
  items: Array<RssItem | AtomEntry>,
): { categories: Map<string, NormalizedCategory>; tags: Map<string, NormalizedTag> } {
  const categories = new Map<string, NormalizedCategory>();
  const tags = new Map<string, NormalizedTag>();

  for (const item of items) {
    for (const rawCategory of asArray(item.category)) {
      const { domain, label } = normalizeCategoryLabel(rawCategory);
      if (!label) continue;

      const slug = sanitizeSlug(label);
      if (!slug) continue;

      if (domain === "tag" || domain === "post_tag") {
        if (tags.has(slug)) continue;
        tags.set(slug, {
          type: "tag",
          source: sourceMeta(`tag:${slug}`),
          sourceId: `tag:${slug}`,
          name: label,
          slug,
        });
        continue;
      }

      if (categories.has(slug)) continue;
      categories.set(slug, {
        type: "category",
        source: sourceMeta(`cat:${slug}`),
        sourceId: `cat:${slug}`,
        name: label,
        slug,
      });
    }
  }

  return { categories, tags };
}

function collectCategorySlugs(item: RssItem | AtomEntry): string[] {
  const slugs: string[] = [];
  for (const rawCategory of asArray(item.category)) {
    const { domain, label } = normalizeCategoryLabel(rawCategory);
    if (!label || domain === "tag" || domain === "post_tag") continue;
    const slug = sanitizeSlug(label);
    if (slug) slugs.push(slug);
  }
  return slugs;
}

function collectTagSlugs(item: RssItem | AtomEntry): string[] {
  const slugs: string[] = [];
  for (const rawCategory of asArray(item.category)) {
    const { domain, label } = normalizeCategoryLabel(rawCategory);
    if (!label || (domain !== "tag" && domain !== "post_tag")) continue;
    const slug = sanitizeSlug(label);
    if (slug) slugs.push(slug);
  }
  return slugs;
}

function* collectInlineAssets(
  html: string,
  seenUrls: Set<string>,
  exportedAt?: string,
): Generator<NormalizedAsset> {
  for (const src of discoverContentAssetUrls(html)) {
    if (seenUrls.has(src)) continue;
    seenUrls.add(src);

    let filename: string;
    try {
      filename = basename(new URL(src, "http://local.invalid").pathname) || "inline-asset";
    } catch {
      filename = "inline-asset";
    }

    yield {
      type: "asset",
      source: sourceMeta(`url:${src}`, src, exportedAt),
      sourceId: `url:${src}`,
      sourceUrl: src,
      filename,
      mimeType: guessMime(filename),
    };
  }
}

function mapPublishStatus(status: string | undefined): PublishStatus {
  switch ((status ?? "published").toLowerCase()) {
    case "published":
      return "published";
    case "draft":
      return "draft";
    default:
      return "archived";
  }
}

function* emitExportPost(
  post: WixPost,
  exportedAt: string | undefined,
  seenAssetUrls: Set<string>,
): Generator<NormalizedEntity> {
  yield* collectInlineAssets(post.contentHtml, seenAssetUrls, exportedAt);

  let featuredAssetSourceId: string | undefined;
  if (post.featuredImageUrl) {
    featuredAssetSourceId = `featured:${post.id}`;
    if (!seenAssetUrls.has(post.featuredImageUrl)) {
      seenAssetUrls.add(post.featuredImageUrl);
      const filename = basename(new URL(post.featuredImageUrl).pathname) || `${post.id}-featured.jpg`;
      yield {
        type: "asset",
        source: sourceMeta(featuredAssetSourceId, post.featuredImageUrl, exportedAt),
        sourceId: featuredAssetSourceId,
        sourceUrl: post.featuredImageUrl,
        filename,
        mimeType: guessMime(filename),
      };
    }
  }

  yield {
    type: "post",
    source: sourceMeta(post.id, post.url, exportedAt),
    sourceId: post.id,
    title: post.title,
    slug: sanitizeSlug(post.slug),
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    publishedAt: post.publishedAt,
    status: mapPublishStatus(post.status),
    categorySlugs: post.categorySlugs,
    tagSlugs: post.tagSlugs,
    featuredAssetSourceId,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
  } satisfies NormalizedPost;
}

function* emitExportPage(
  page: WixPage,
  exportedAt: string | undefined,
  seenAssetUrls: Set<string>,
): Generator<NormalizedEntity> {
  yield* collectInlineAssets(page.contentHtml, seenAssetUrls, exportedAt);

  yield {
    type: "page",
    source: sourceMeta(page.id, page.url, exportedAt),
    sourceId: page.id,
    title: page.title,
    slug: sanitizeSlug(page.slug),
    contentHtml: page.contentHtml,
    isHomePage: page.isHomePage,
    status: mapPublishStatus(page.status),
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
  } satisfies NormalizedPage;
}

export async function* enumerateWixExportEntities(
  doc: WixExport,
  snapshotGaps?: WixSnapshotGap[],
): AsyncGenerator<NormalizedEntity> {
  const exportedAt = doc.exportedAt;
  const seenAssetUrls = new Set<string>();

  for (const category of doc.categories ?? []) {
    yield {
      type: "category",
      source: sourceMeta(category.id, undefined, exportedAt),
      sourceId: category.id,
      name: category.name,
      slug: sanitizeSlug(category.slug),
    } satisfies NormalizedCategory;
  }

  for (const tag of doc.tags ?? []) {
    yield {
      type: "tag",
      source: sourceMeta(tag.id, undefined, exportedAt),
      sourceId: tag.id,
      name: tag.name,
      slug: sanitizeSlug(tag.slug),
    } satisfies NormalizedTag;
  }

  for (const page of doc.pages ?? []) {
    yield* emitExportPage(page, exportedAt, seenAssetUrls);
  }

  for (const post of doc.posts ?? []) {
    yield* emitExportPost(post, exportedAt, seenAssetUrls);
  }

  void snapshotGaps;
}

export function summarizeWixExport(doc: WixExport): {
  posts: number;
  pages: number;
  categories: number;
  tags: number;
  assets: number;
} {
  const seenAssetUrls = new Set<string>();
  let assets = 0;

  const countHtml = (html: string, featured?: string) => {
    if (featured && !seenAssetUrls.has(featured)) {
      seenAssetUrls.add(featured);
      assets += 1;
    }
    for (const src of discoverContentAssetUrls(html)) {
      if (seenAssetUrls.has(src)) continue;
      seenAssetUrls.add(src);
      assets += 1;
    }
  };

  for (const post of doc.posts ?? []) {
    countHtml(post.contentHtml, post.featuredImageUrl);
  }
  for (const page of doc.pages ?? []) {
    countHtml(page.contentHtml);
  }

  return {
    posts: doc.posts?.length ?? 0,
    pages: doc.pages?.length ?? 0,
    categories: doc.categories?.length ?? 0,
    tags: doc.tags?.length ?? 0,
    assets,
  };
}

function parseFeedItems(xml: string): { format: WixFeedFormat; items: Array<RssItem | AtomEntry> } {
  const format = detectWixFeedFormat(xml);
  const doc = parseXmlDocument(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
    feed?: { entry?: AtomEntry | AtomEntry[] };
  };

  if (format === "atom") {
    return { format, items: asArray(doc.feed?.entry) };
  }

  return { format, items: asArray(doc.rss?.channel?.item) };
}

export async function loadWixFeed(filePath: string): Promise<{ format: WixFeedFormat; items: Array<RssItem | AtomEntry> }> {
  const xml = await readFile(filePath, "utf8");
  const parsed = parseFeedItems(xml);
  if (parsed.items.length === 0) {
    throw new Error("Invalid Wix feed: no entries found in RSS or Atom document");
  }
  return parsed;
}

export async function loadWixExport(options: WixParseOptions): Promise<WixExport> {
  if (options.data) return assertWixExport(options.data);

  if (options.client) {
    const doc = await options.client.collectExport();
    return assertWixExport(doc);
  }

  if (options.clientOptions) {
    const client = new WixCollectionClient(options.clientOptions);
    const doc = await client.collectExport();
    return assertWixExport(doc);
  }

  if (options.filePath) {
    const ext = extname(options.filePath).toLowerCase();
    if (ext === ".json") {
      const raw: unknown = JSON.parse(await readFile(options.filePath, "utf8"));
      return assertWixExport(raw);
    }
  }

  throw new Error("Wix parser requires filePath (.json), data, client, or clientOptions");
}

async function resolveSnapshotTargets(options: WixParseOptions): Promise<WixSnapshotTarget[]> {
  if (options.snapshotTargets?.length) return options.snapshotTargets;
  const listPath = options.urlsFile ?? (
    options.filePath && extname(options.filePath).toLowerCase() === ".txt" ? options.filePath : undefined
  );
  if (listPath) {
    const urls = await loadUrlListFile(listPath);
    return urls.map((url, index) => ({
      url,
      isHomePage: index === 0 && new URL(url).pathname === "/",
    }));
  }
  return [];
}

async function attachSnapshotPages(
  doc: WixExport,
  options: WixParseOptions,
): Promise<{ doc: WixExport; gaps: WixSnapshotGap[] }> {
  const targets = await resolveSnapshotTargets(options);
  if (targets.length === 0) return { doc, gaps: [] };

  const collector = new WixPageSnapshotCollector(options.snapshotOptions);
  const { pages, gaps } = await collector.collectPages(targets);
  return {
    doc: {
      ...doc,
      pages: [...(doc.pages ?? []), ...pages],
    },
    gaps,
  };
}

export async function* enumerateWixEntities(options: WixParseOptions): AsyncGenerator<NormalizedEntity> {
  if (options.filePath && [".xml", ".rss", ".atom"].includes(extname(options.filePath).toLowerCase())) {
    yield* enumerateWixFeedEntities(options);
    const snapshotTargets = await resolveSnapshotTargets(options);
    if (snapshotTargets.length > 0) {
      const { doc, gaps } = await attachSnapshotPages(
        { exportVersion: 1, pages: [], posts: [] },
        { ...options, snapshotTargets },
      );
      yield* enumerateWixExportEntities(doc, gaps);
    }
    return;
  }

  if (options.filePath && extname(options.filePath).toLowerCase() === ".txt" && !options.data && !options.client) {
    const { doc, gaps } = await attachSnapshotPages(
      { exportVersion: 1, pages: [], posts: [] },
      options,
    );
    yield* enumerateWixExportEntities(doc, gaps);
    return;
  }

  const snapshotTargets = await resolveSnapshotTargets(options);
  if (
    snapshotTargets.length > 0 &&
    !options.filePath &&
    !options.data &&
    !options.client &&
    !options.clientOptions
  ) {
    const { doc, gaps } = await attachSnapshotPages(
      { exportVersion: 1, pages: [], posts: [] },
      { ...options, snapshotTargets },
    );
    yield* enumerateWixExportEntities(doc, gaps);
    return;
  }

  const doc = await loadWixExport(options);
  const { doc: withSnapshots, gaps } = await attachSnapshotPages(doc, options);
  yield* enumerateWixExportEntities(withSnapshots, gaps);
}

async function* enumerateWixFeedEntities(options: WixParseOptions): AsyncGenerator<NormalizedEntity> {
  if (!options.filePath) {
    throw new Error("Wix feed parser requires filePath");
  }
  const { format, items } = await loadWixFeed(options.filePath);
  const { categories, tags } = collectTaxonomiesFromItems(items);
  const seenAssetUrls = new Set<string>();

  for (const category of categories.values()) {
    yield category;
  }
  for (const tag of tags.values()) {
    yield tag;
  }

  for (const item of items) {
    const title = textValue(item.title) || "Untitled";
    const link = itemLink(item);
    const sourceId = itemSourceId(item, link, sanitizeSlug(title));
    const slug = slugFromLink(link, title, sourceId);
    const contentHtml = getItemContentHtml(item);

    for (const asset of collectInlineAssets(contentHtml, seenAssetUrls, options.exportedAt)) {
      yield asset;
    }

    const post: NormalizedPost = {
      type: "post",
      source: sourceMeta(sourceId, link || undefined, options.exportedAt),
      sourceId,
      title,
      slug,
      excerpt: textValue((item as RssItem).description) || undefined,
      contentHtml,
      publishedAt: itemPublishedAt(item),
      status: "published" satisfies PublishStatus,
      categorySlugs: collectCategorySlugs(item),
      tagSlugs: collectTagSlugs(item),
    };

    yield post;
  }

  void format;
}

export async function summarizeWixFeed(filePath: string): Promise<WixFeedSummary> {
  const { format, items } = await loadWixFeed(filePath);
  let posts = 0;
  let assets = 0;
  const { categories, tags } = collectTaxonomiesFromItems(items);
  const seenAssetUrls = new Set<string>();

  for (const item of items) {
    posts += 1;
    const contentHtml = getItemContentHtml(item);
    for (const src of discoverContentAssetUrls(contentHtml)) {
      if (seenAssetUrls.has(src)) continue;
      seenAssetUrls.add(src);
      assets += 1;
    }
  }

  return {
    format,
    posts,
    categories: categories.size,
    tags: tags.size,
    assets,
  };
}

export async function validateWixExportFile(filePath: string): Promise<{
  ok: boolean;
  issues: ValidationIssue[];
  summary: Omit<WixFeedSummary, "format"> & { format?: WixFeedFormat };
}> {
  try {
    const summary = await summarizeWixFeed(filePath);
    return {
      ok: true,
      issues: [],
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid_wix_feed",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      summary: { posts: 0, categories: 0, tags: 0, assets: 0 },
    };
  }
}

export function isWixFeedXml(xml: string): boolean {
  const trimmed = xml.trim();
  return trimmed.includes("<rss") || trimmed.includes("<feed");
}
