import { readFile } from "node:fs/promises";
import { basename } from "node:path";

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
} from "../../normalizer/types.js";
import {
  SquarespaceCollectionClient,
  type SquarespaceClientOptions,
  type SquarespaceCollectTarget,
} from "./collect.js";
import type {
  SquarespaceBlock,
  SquarespaceExport,
  SquarespaceGalleryItem,
  SquarespacePage,
  SquarespacePost,
} from "./types.js";

const PLATFORM = "squarespace" as const;
const UNSUPPORTED_ATTR = "data-artinstack-unsupported-block";
const BLOCK_ID_ATTR = "data-artinstack-block-id";

/** Block types flattened to HTML without a conflict flag. */
const SUPPORTED_BLOCK_TYPES = new Set([
  "html",
  "text",
  "markdown",
  "image",
  "gallery",
  "quote",
  "button",
  "video",
  "code",
  "spacer",
  "line",
  "horizontalrule",
  "hr",
]);

/** Known Squarespace block types that cannot be migrated as static HTML snapshots. */
const UNSUPPORTED_BLOCK_TYPES = new Set([
  "product",
  "products",
  "form",
  "newsletter",
  "donation",
  "calendar",
  "chart",
  "map",
  "music",
  "social",
  "summary",
  "archive",
  "acuity",
  "member-area",
  "digital-product",
  "folder",
  "index",
  "tock",
  "opentable",
  "soundcloud",
  "foursquare",
]);

export interface SquarespaceParseOptions {
  filePath?: string;
  data?: SquarespaceExport;
  /** Pre-constructed json-pretty collector (live crawl). */
  client?: SquarespaceCollectionClient;
  /** Shorthand targets when constructing a client inline. */
  collectTargets?: SquarespaceCollectTarget[];
  clientOptions?: SquarespaceClientOptions;
}

export interface FlattenBlocksResult {
  contentHtml: string;
  assetUrls: string[];
}

function sourceMeta(id: string, url?: string, exportedAt?: string): SourceMetadata {
  return {
    platform: PLATFORM,
    id,
    url,
    path: linkToPath(url),
    exportedAt,
  };
}

function mapPublishStatus(status: string | undefined): PublishStatus {
  switch ((status ?? "published").toLowerCase()) {
    case "published":
      return "published";
    case "draft":
    case "scheduled":
      return "draft";
    default:
      return "archived";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function blockShell(type: string, inner: string, blockId?: string): string {
  const idAttr = blockId ? ` id="sqs-block-${blockId}"` : "";
  return `<div class="sqs-block sqs-block-${type}"${idAttr}>${inner}</div>`;
}

function unsupportedPlaceholder(type: string, blockId?: string): string {
  const idPart = blockId ? ` ${BLOCK_ID_ATTR}="${escapeHtml(blockId)}"` : "";
  return `<div class="sqs-block sqs-block-unsupported" ${UNSUPPORTED_ATTR}="${escapeHtml(type)}"${idPart} aria-hidden="true"></div>`;
}

function flattenGalleryItem(item: SquarespaceGalleryItem): string {
  const alt = item.altText ? ` alt="${escapeHtml(item.altText)}"` : "";
  const caption = item.caption ? `<figcaption>${item.caption}</figcaption>` : "";
  return `<figure><img src="${escapeHtml(item.imageUrl)}"${alt} />${caption}</figure>`;
}

export function flattenSquarespaceBlock(block: SquarespaceBlock): FlattenBlocksResult {
  const type = block.type.toLowerCase();
  const blockId = block.id;
  const assetUrls: string[] = [];

  if (UNSUPPORTED_BLOCK_TYPES.has(type)) {
    return {
      contentHtml: unsupportedPlaceholder(type, blockId),
      assetUrls,
    };
  }

  if (!SUPPORTED_BLOCK_TYPES.has(type)) {
    return {
      contentHtml: unsupportedPlaceholder(type || "unknown", blockId),
      assetUrls,
    };
  }

  switch (type) {
    case "html":
    case "text":
      return {
        contentHtml: blockShell(type, block.html ?? block.value ?? "", blockId),
        assetUrls,
      };

    case "markdown":
      return {
        contentHtml: blockShell(
          type,
          block.html ?? `<div class="sqs-markdown">${escapeHtml(block.value ?? "")}</div>`,
          blockId,
        ),
        assetUrls,
      };

    case "image": {
      const url = block.imageUrl ?? "";
      if (url) assetUrls.push(url);
      const alt = block.altText ? ` alt="${escapeHtml(block.altText)}"` : "";
      const caption = block.caption ? `<figcaption>${block.caption}</figcaption>` : "";
      const inner = url
        ? `<figure><img src="${escapeHtml(url)}"${alt} />${caption}</figure>`
        : "";
      return { contentHtml: blockShell(type, inner, blockId), assetUrls };
    }

    case "gallery": {
      const figures = (block.items ?? [])
        .map((item) => {
          assetUrls.push(item.imageUrl);
          return flattenGalleryItem(item);
        })
        .join("");
      return {
        contentHtml: blockShell(type, `<div class="sqs-gallery">${figures}</div>`, blockId),
        assetUrls,
      };
    }

    case "quote": {
      const inner = block.html ?? `<blockquote>${escapeHtml(block.value ?? "")}</blockquote>`;
      return { contentHtml: blockShell(type, inner, blockId), assetUrls };
    }

    case "button": {
      const href = block.url ?? "#";
      const label = escapeHtml(block.label ?? block.value ?? "Learn more");
      return {
        contentHtml: blockShell(
          type,
          `<p><a class="sqs-block-button" href="${escapeHtml(href)}">${label}</a></p>`,
          blockId,
        ),
        assetUrls,
      };
    }

    case "video": {
      const inner =
        block.embedHtml ??
        block.html ??
        (block.url ? `<p><a href="${escapeHtml(block.url)}">Video</a></p>` : "");
      return { contentHtml: blockShell(type, inner, blockId), assetUrls };
    }

    case "code": {
      const inner =
        block.html ??
        `<pre><code>${escapeHtml(block.value ?? "")}</code></pre>`;
      return { contentHtml: blockShell(type, inner, blockId), assetUrls };
    }

    case "spacer":
      return {
        contentHtml: blockShell(type, `<div class="sqs-spacer" aria-hidden="true"></div>`, blockId),
        assetUrls,
      };

    case "line":
    case "horizontalrule":
    case "hr":
      return { contentHtml: blockShell("line", "<hr />", blockId), assetUrls };

    default:
      return {
        contentHtml: unsupportedPlaceholder(type, blockId),
        assetUrls,
      };
  }
}

export function flattenSquarespaceBlocks(blocks: SquarespaceBlock[]): FlattenBlocksResult {
  const parts: string[] = [];
  const assetUrls: string[] = [];
  for (const block of blocks) {
    const flattened = flattenSquarespaceBlock(block);
    parts.push(flattened.contentHtml);
    assetUrls.push(...flattened.assetUrls);
  }
  return {
    contentHtml: parts.join("\n"),
    assetUrls,
  };
}

function resolveContentHtml(
  entity: SquarespacePage | SquarespacePost,
): FlattenBlocksResult {
  if (entity.blocks?.length) {
    return flattenSquarespaceBlocks(entity.blocks);
  }
  const html = entity.contentHtml ?? "";
  return {
    contentHtml: html,
    assetUrls: [...discoverContentAssetUrls(html)],
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
    svg: "image/svg+xml",
  };
  return ext ? map[ext] : undefined;
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    return basename(new URL(url).pathname) || fallback;
  } catch {
    return basename(url.split("?")[0] ?? "") || fallback;
  }
}

function assetFromUrl(
  url: string,
  exportedAt: string | undefined,
  index: number,
): NormalizedAsset {
  const filename = filenameFromUrl(url, `asset-${index}.jpg`);
  const sourceId = `asset-${sanitizeSlug(filename)}-${index}`;
  return {
    type: "asset",
    source: sourceMeta(sourceId, url, exportedAt),
    sourceId,
    sourceUrl: url,
    filename,
    mimeType: guessMime(filename),
  };
}

export function isSquarespaceExport(value: unknown): value is SquarespaceExport {
  if (!value || typeof value !== "object") return false;
  const record = value as SquarespaceExport;
  const version = record.exportVersion;
  return (version === 1 || version === "1") && Array.isArray(record.pages);
}

export async function loadSquarespaceExport(
  options: SquarespaceParseOptions,
): Promise<SquarespaceExport> {
  if (options.data) return options.data;
  if (options.client) {
    if (!options.collectTargets?.length) {
      throw new Error("Squarespace client.collectExport requires collectTargets");
    }
    return options.client.collectExport(options.collectTargets);
  }
  if (options.collectTargets?.length) {
    const client = new SquarespaceCollectionClient(options.clientOptions);
    return client.collectExport(options.collectTargets);
  }
  if (!options.filePath) {
    throw new Error("Squarespace parser requires filePath, data, client, or collectTargets");
  }
  const raw: unknown = JSON.parse(await readFile(options.filePath, "utf8"));
  if (isSquarespaceExport(raw)) return raw;
  throw new Error("Invalid Squarespace export: expected exportVersion 1 with pages[]");
}

function* emitAssetsFromContent(
  contentHtml: string,
  explicitUrls: string[],
  exportedAt?: string,
): Generator<NormalizedAsset> {
  const seen = new Set<string>();
  const urls = [...explicitUrls, ...discoverContentAssetUrls(contentHtml)];
  let index = 0;
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    yield assetFromUrl(url, exportedAt, index);
    index += 1;
  }
}

async function* emitPage(page: SquarespacePage, exportedAt?: string): AsyncGenerator<NormalizedEntity> {
  const { contentHtml, assetUrls } = resolveContentHtml(page);
  yield {
    type: "page",
    source: sourceMeta(page.id, page.url, exportedAt),
    sourceId: page.id,
    title: page.title,
    slug: sanitizeSlug(page.slug),
    contentHtml,
    contentCss: page.contentCss,
    isHomePage: page.isHomePage,
    status: mapPublishStatus(page.status),
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
  } satisfies NormalizedPage;

  yield* emitAssetsFromContent(contentHtml, assetUrls, exportedAt);
}

async function* emitPost(post: SquarespacePost, exportedAt?: string): AsyncGenerator<NormalizedEntity> {
  const { contentHtml, assetUrls } = resolveContentHtml(post);

  let featuredAssetSourceId: string | undefined;
  if (post.featuredImageUrl) {
    featuredAssetSourceId = `featured-${post.id}`;
  }

  yield {
    type: "post",
    source: sourceMeta(post.id, post.url, exportedAt),
    sourceId: post.id,
    title: post.title,
    slug: sanitizeSlug(post.slug),
    excerpt: post.excerpt,
    contentHtml,
    publishedAt: post.publishedAt,
    status: mapPublishStatus(post.status),
    categorySlugs: post.categorySlugs,
    tagSlugs: post.tagSlugs,
    featuredAssetSourceId,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
  } satisfies NormalizedPost;

  if (post.featuredImageUrl) {
    const filename = filenameFromUrl(post.featuredImageUrl, `${post.id}-featured.jpg`);
    yield {
      type: "asset",
      source: sourceMeta(featuredAssetSourceId!, post.featuredImageUrl, exportedAt),
      sourceId: featuredAssetSourceId!,
      sourceUrl: post.featuredImageUrl,
      filename,
      mimeType: guessMime(filename),
    } satisfies NormalizedAsset;
  }

  yield* emitAssetsFromContent(contentHtml, assetUrls, exportedAt);
}

/** Parse Squarespace JSON export → normalizer DTOs (static HTML snapshots). */
export async function* enumerateSquarespaceEntities(
  options: SquarespaceParseOptions,
): AsyncGenerator<NormalizedEntity> {
  const doc = await loadSquarespaceExport(options);
  const exportedAt = doc.exportedAt;

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

  for (const page of doc.pages) {
    yield* emitPage(page, exportedAt);
  }

  for (const post of doc.posts ?? []) {
    yield* emitPost(post, exportedAt);
  }
}

export function summarizeSquarespaceExport(doc: SquarespaceExport): {
  pages: number;
  posts: number;
  categories: number;
  tags: number;
} {
  return {
    pages: doc.pages.length,
    posts: doc.posts?.length ?? 0,
    categories: doc.categories?.length ?? 0,
    tags: doc.tags?.length ?? 0,
  };
}

export async function validateSquarespaceExportFile(filePath: string): Promise<{
  ok: boolean;
  issues: { code: string; message: string }[];
  summary: Record<string, number>;
}> {
  const issues: { code: string; message: string }[] = [];
  let doc: SquarespaceExport;
  try {
    doc = await loadSquarespaceExport({ filePath });
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid_export",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      summary: {},
    };
  }

  if (doc.pages.length === 0 && (doc.posts?.length ?? 0) === 0) {
    issues.push({ code: "empty_export", message: "No pages or posts in export" });
  }

  const summary = summarizeSquarespaceExport(doc);
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      pages: summary.pages,
      posts: summary.posts,
      categories: summary.categories,
      tags: summary.tags,
      portfolios: 0,
      assets: 0,
    },
  };
}

/** @internal Scan flattened HTML for unsupported block markers (used by conflict analysis). */
export function findUnsupportedBlockMarkers(html: string): { blockType: string; blockId?: string }[] {
  const markers: { blockType: string; blockId?: string }[] = [];
  const pattern =
    /data-artinstack-unsupported-block="([^"]+)"(?:\s+data-artinstack-block-id="([^"]*)")?/g;
  for (const match of html.matchAll(pattern)) {
    markers.push({
      blockType: match[1] ?? "unknown",
      blockId: match[2] || undefined,
    });
  }
  return markers;
}

export { SUPPORTED_BLOCK_TYPES, UNSUPPORTED_BLOCK_TYPES, UNSUPPORTED_ATTR, BLOCK_ID_ATTR };
