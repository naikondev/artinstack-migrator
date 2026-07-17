import * as cheerio from "cheerio";
import { z } from "zod";

import { sanitizeSlug } from "../../lib/utility.js";
import type {
  SquarespaceBlock,
  SquarespaceCategory,
  SquarespaceExport,
  SquarespaceGalleryCollection,
  SquarespaceGalleryItem,
  SquarespacePage,
  SquarespacePost,
  SquarespaceTag,
} from "./types.js";

export const SQUARESPACE_JSON_FORMAT = "json-pretty" as const;
export const SQUARESPACE_JSON_FORMAT_COMPACT = "json" as const;

export type SquarespaceJsonFormat =
  | typeof SQUARESPACE_JSON_FORMAT
  | typeof SQUARESPACE_JSON_FORMAT_COMPACT;

export const squarespaceClientOptionsSchema = z.object({
  format: z.enum(["json", "json-pretty"]).default("json-pretty"),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryBaseDelayMs: z.number().int().min(0).default(500),
  maxRetryDelayMs: z.number().int().min(0).default(8000),
  requestIntervalMs: z.number().int().min(0).default(200),
  /**
   * When json-pretty yields an empty classic layout (common on 7.1 section pages),
   * fetch the rendered HTML once and parse `.sqs-block` content from `#sections`.
   */
  htmlFallback: z.boolean().default(true),
  fetchImpl: z.custom<typeof fetch>().optional(),
});

export type SquarespaceClientOptions = z.input<typeof squarespaceClientOptionsSchema>;

export interface SquarespaceCollectTarget {
  /** Page or collection URL on the live Squarespace site (without format query). */
  url: string;
  /** `collection` paginates `items[]`; `page` fetches a single static page/item. */
  kind?: "auto" | "page" | "collection";
  isHomePage?: boolean;
}

interface WireRecord {
  [key: string]: unknown;
}

interface WirePagination {
  nextPage?: boolean;
  nextPageUrl?: string;
}

function isRecord(value: unknown): value is WireRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append Squarespace `?format=json-pretty` (or `json`) to a site URL. */
export function buildJsonPrettyUrl(
  pageUrl: string,
  format: SquarespaceJsonFormat = SQUARESPACE_JSON_FORMAT,
): string {
  const url = new URL(pageUrl);
  url.searchParams.set("format", format);
  return url.toString();
}

function mapWorkflowState(state: unknown): SquarespacePage["status"] {
  if (state === 1 || state === "1") return "published";
  if (state === 2 || state === "2") return "draft";
  return "published";
}

function mapPublishOn(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function readSeo(seoData: unknown, field: "title" | "description"): string | undefined {
  const record = asRecord(seoData);
  if (!record) return undefined;
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Infer block type from Squarespace LayoutEngine / Fluid Engine class names. */
export function inferBlockTypeFromClassName(className: string): string {
  const match = className.match(/\bsqs-block-([a-z0-9-]+)\b/i);
  if (!match?.[1]) return "html";
  const raw = match[1].toLowerCase();
  if (raw === "horizontalrule") return "line";
  return raw.replace(/-block$/g, "");
}

/** True when json-pretty `mainContent` is an empty classic LayoutEngine shell. */
export function isEmptyClassicMainContent(html: string | undefined): boolean {
  if (!html?.trim()) return true;
  const $ = cheerio.load(html, { xml: false });
  if ($(".sqs-block").length > 0) return false;
  if ($(".sqs-layout.empty").length > 0) return true;
  // Tiny shells with no blocks are not usable page bodies.
  return html.replace(/\s+/g, " ").trim().length < 280;
}

/** True when an export page has no blocks and no usable contentHtml. */
export function pageContentIsEmpty(page: Pick<SquarespacePage, "blocks" | "contentHtml">): boolean {
  if ((page.blocks?.length ?? 0) > 0) return false;
  return isEmptyClassicMainContent(page.contentHtml);
}

/**
 * Pull the primary page body from a rendered Squarespace HTML document.
 * Prefers 7.1 `#sections` / `article.sections`, then `main`.
 */
export function extractPageBodyHtml(html: string): string {
  if (!html.trim()) return "";
  const $ = cheerio.load(html, { xml: false });
  const sections = $("#sections").first();
  if (sections.length) return sections.html() ?? "";
  const article = $("article.sections").first();
  if (article.length) return article.html() ?? "";
  const main = $("main#page, main[role='main'], main").first();
  if (main.length) return main.html() ?? "";
  return "";
}

/** Map rendered page HTML into export `blocks` / `contentHtml`. */
export function extractPageContentFromHtml(
  html: string,
): Pick<SquarespacePage, "blocks" | "contentHtml"> {
  const body = extractPageBodyHtml(html);
  if (!body.trim()) return { contentHtml: "" };

  const parsedBlocks = extractBlocksFromBodyHtml(body);
  if (parsedBlocks.length > 0) {
    return { blocks: parsedBlocks };
  }
  return { contentHtml: body };
}

/** Parse rendered `body` HTML into block entries when wire JSON has no structured blocks. */
export function extractBlocksFromBodyHtml(html: string): SquarespaceBlock[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html, { xml: false });
  const blocks: SquarespaceBlock[] = [];

  $(".sqs-block").each((_, element) => {
    const el = $(element);
    const className = el.attr("class") ?? "";
    const type = inferBlockTypeFromClassName(className);
    const id = el.attr("id")?.replace(/^block-/, "");
    const content = el.find(".sqs-block-content").first();
    const innerHtml = (content.length ? content.html() : el.html()) ?? "";

    if (type === "image") {
      const img = content.find("img").first();
      const imageUrl = img.attr("data-src") ?? img.attr("src") ?? undefined;
      blocks.push({
        id,
        type,
        imageUrl,
        altText: img.attr("alt") ?? undefined,
        caption: content.find("figcaption").text() || undefined,
        html: innerHtml || undefined,
      });
      return;
    }

    if (type === "gallery") {
      const items: SquarespaceGalleryItem[] = [];
      content.find("img").each((idx, imgEl) => {
        const img = $(imgEl);
        const imageUrl = img.attr("data-src") ?? img.attr("src");
        if (!imageUrl) return;
        items.push({
          id: img.attr("data-image-id") ?? `gallery-${idx}`,
          imageUrl,
          altText: img.attr("alt") ?? undefined,
        });
      });
      blocks.push({ id, type, items, html: innerHtml || undefined });
      return;
    }

    if (type === "button") {
      const anchor = content.find("a").first();
      blocks.push({
        id,
        type,
        url: anchor.attr("href") ?? undefined,
        label: anchor.text() || undefined,
        html: innerHtml || undefined,
      });
      return;
    }

    if (type === "video" || type === "embed") {
      const iframe = content.find("iframe").first();
      blocks.push({
        id,
        type: type === "embed" ? "embed" : "video",
        embedHtml: iframe.length ? $.html(iframe) : innerHtml || undefined,
        html: innerHtml || undefined,
      });
      return;
    }

    blocks.push({
      id,
      type,
      html: innerHtml || undefined,
      value: type === "markdown" || type === "quote" ? content.text() : undefined,
    });
  });

  return blocks;
}

function mapWireBlocks(value: unknown): SquarespaceBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks: SquarespaceBlock[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const type = String(record.type ?? record.blockType ?? "html");
    blocks.push({
      id: record.id ? String(record.id) : undefined,
      type,
      html: typeof record.html === "string" ? record.html : undefined,
      value: typeof record.value === "string" ? record.value : undefined,
      imageUrl:
        typeof record.imageUrl === "string"
          ? record.imageUrl
          : typeof record.assetUrl === "string"
            ? record.assetUrl
            : undefined,
      altText: typeof record.altText === "string" ? record.altText : undefined,
      caption: typeof record.caption === "string" ? record.caption : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      label: typeof record.label === "string" ? record.label : undefined,
      embedHtml: typeof record.embedHtml === "string" ? record.embedHtml : undefined,
      items: Array.isArray(record.items)
        ? record.items
            .map((item) => asRecord(item))
            .filter((item): item is WireRecord => !!item)
            .map((item) => ({
              id: item.id ? String(item.id) : undefined,
              imageUrl: String(item.imageUrl ?? item.assetUrl ?? ""),
              altText: typeof item.altText === "string" ? item.altText : undefined,
              caption: typeof item.caption === "string" ? item.caption : undefined,
            }))
            .filter((item) => item.imageUrl.length > 0)
        : undefined,
    });
  }
  return blocks.length > 0 ? blocks : undefined;
}

function mapStructuredBlocksFromItem(item: WireRecord): SquarespaceBlock[] | undefined {
  const direct = mapWireBlocks(item.blocks);
  if (direct?.length) return direct;

  const sections = item.sections;
  if (!Array.isArray(sections)) return undefined;

  const flattened: SquarespaceBlock[] = [];
  for (const section of sections) {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) continue;
    const rows = sectionRecord.rows;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const rowRecord = asRecord(row);
      if (!rowRecord) continue;
      const columns = rowRecord.columns;
      if (!Array.isArray(columns)) continue;
      for (const column of columns) {
        const columnRecord = asRecord(column);
        if (!columnRecord) continue;
        const blocks = mapWireBlocks(columnRecord.blocks);
        if (blocks) flattened.push(...blocks);
      }
    }
  }
  return flattened.length > 0 ? flattened : undefined;
}

function mapWireItemContent(item: WireRecord): Pick<SquarespacePage, "blocks" | "contentHtml"> {
  const structured = mapStructuredBlocksFromItem(item);
  if (structured?.length) {
    return { blocks: structured };
  }

  const body = typeof item.body === "string" ? item.body : undefined;
  if (!body) return { contentHtml: "" };

  const parsedBlocks = extractBlocksFromBodyHtml(body);
  if (parsedBlocks.length > 0) {
    return { blocks: parsedBlocks };
  }
  return { contentHtml: body };
}

function isBlogCollection(collection: WireRecord | undefined): boolean {
  if (!collection) return false;
  const ordering = String(collection.ordering ?? "").toLowerCase();
  if (ordering === "chronological" || ordering === "calendar") return true;
  const typeName = String(collection.typeName ?? collection.typeLabel ?? "").toLowerCase();
  return typeName.includes("blog");
}

/** Gallery / portfolio collection pages — items are media, not blog posts. */
export function isGalleryCollection(collection: WireRecord | undefined): boolean {
  if (!collection) return false;
  if (isBlogCollection(collection)) return false;
  const typeName = String(collection.typeName ?? "").toLowerCase();
  const typeLabel = String(collection.typeLabel ?? "").toLowerCase();
  return (
    typeName.includes("gallery") ||
    typeLabel.includes("gallery") ||
    typeName === "portfolio" ||
    typeLabel === "portfolio"
  );
}

function isStaticPageItem(item: WireRecord, collection: WireRecord | undefined): boolean {
  const recordTypeLabel = String(item.recordTypeLabel ?? "").toLowerCase();
  if (recordTypeLabel.includes("page")) return true;
  const collectionType = String(collection?.typeName ?? collection?.typeLabel ?? "").toLowerCase();
  return collectionType === "page" || collectionType.includes("page-collection");
}

function stripSimpleHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Map one json-pretty gallery-collection item → export gallery item. */
export function mapWireGalleryItem(item: WireRecord): SquarespaceGalleryItem | undefined {
  const resolved =
    typeof item.assetUrl === "string" && item.assetUrl.trim()
      ? item.assetUrl.trim()
      : typeof item.imageUrl === "string" && item.imageUrl.trim()
        ? item.imageUrl.trim()
        : "";
  if (!resolved.startsWith("http")) return undefined;

  const rawCaption =
    typeof item.body === "string"
      ? stripSimpleHtml(item.body)
      : typeof item.excerpt === "string"
        ? item.excerpt.trim()
        : typeof item.caption === "string"
          ? item.caption.trim()
          : undefined;

  return {
    id: String(item.id ?? item.systemDataId ?? item.urlId ?? ""),
    imageUrl: resolved,
    altText:
      typeof item.altText === "string"
        ? item.altText
        : typeof item.title === "string"
          ? item.title
          : undefined,
    caption: rawCaption || undefined,
  };
}

function mapWireGalleryCollection(
  collection: WireRecord,
  items: WireRecord[],
  context?: { fetchedUrl?: string },
): SquarespaceGalleryCollection {
  const id = String(collection.id ?? collection.urlId ?? collection.fullUrl ?? "gallery");
  const title = String(collection.title ?? collection.navigationTitle ?? "Gallery");
  const slug = sanitizeSlug(String(collection.urlId ?? collection.title ?? id));
  const galleryItems = items
    .map((item) => mapWireGalleryItem(item))
    .filter((item): item is SquarespaceGalleryItem => !!item);

  return {
    id,
    title,
    slug,
    url: resolveAbsoluteUrl(
      typeof collection.fullUrl === "string" ? collection.fullUrl : undefined,
      context?.fetchedUrl,
    ),
    description:
      typeof collection.description === "string"
        ? stripSimpleHtml(collection.description)
        : undefined,
    items: galleryItems,
  };
}

function mapWireItemToPost(item: WireRecord, options?: { fallbackUrl?: string }): SquarespacePost {
  const content = mapWireItemContent(item);
  return {
    id: String(item.id ?? item.systemDataId ?? item.urlId ?? ""),
    title: String(item.title ?? "Untitled"),
    slug: sanitizeSlug(String(item.urlId ?? item.title ?? item.id ?? "post")),
    url: resolveAbsoluteUrl(
      typeof item.fullUrl === "string" ? item.fullUrl : undefined,
      options?.fallbackUrl,
    ),
    excerpt: typeof item.excerpt === "string" ? item.excerpt : undefined,
    publishedAt: mapPublishOn(item.publishOn ?? item.addedOn),
    status: mapWorkflowState(item.workflowState),
    categorySlugs: asStringArray(item.categories).map((slug) => sanitizeSlug(slug)),
    tagSlugs: asStringArray(item.tags).map((slug) => sanitizeSlug(slug)),
    featuredImageUrl: typeof item.assetUrl === "string" ? item.assetUrl : undefined,
    seoTitle: readSeo(item.seoData, "title"),
    seoDescription: readSeo(item.seoData, "description"),
    ...content,
  };
}

function resolveAbsoluteUrl(
  raw: string | undefined,
  fallback?: string,
): string | undefined {
  const candidate = raw?.trim() || fallback?.trim();
  if (!candidate) return undefined;
  try {
    if (fallback) return new URL(candidate, fallback).toString();
    return new URL(candidate).toString();
  } catch {
    return candidate.startsWith("http") ? candidate : undefined;
  }
}

function mapWireItemToPage(
  item: WireRecord,
  options?: { isHomePage?: boolean; fallbackUrl?: string },
): SquarespacePage {
  const content = mapWireItemContent(item);
  return {
    id: String(item.id ?? item.urlId ?? ""),
    title: String(item.title ?? "Untitled"),
    slug: sanitizeSlug(String(item.urlId ?? item.title ?? item.id ?? "page")),
    url: resolveAbsoluteUrl(
      typeof item.fullUrl === "string" ? item.fullUrl : undefined,
      options?.fallbackUrl,
    ),
    status: mapWorkflowState(item.workflowState),
    isHomePage: options?.isHomePage,
    seoTitle: readSeo(item.seoData, "title"),
    seoDescription: readSeo(item.seoData, "description"),
    ...content,
  };
}

function mapWireCategories(collection: WireRecord | undefined): SquarespaceCategory[] {
  if (!collection) return [];
  return asStringArray(collection.categories).map((name) => ({
    id: `cat-${sanitizeSlug(name)}`,
    name,
    slug: sanitizeSlug(name),
  }));
}

function mapWireTags(items: WireRecord[]): SquarespaceTag[] {
  const seen = new Map<string, SquarespaceTag>();
  for (const item of items) {
    for (const tag of asStringArray(item.tags)) {
      const slug = sanitizeSlug(tag);
      if (!seen.has(slug)) {
        seen.set(slug, { id: `tag-${slug}`, name: tag, slug });
      }
    }
  }
  return [...seen.values()];
}

function siteFromWire(wire: WireRecord): SquarespaceExport["site"] {
  const website = asRecord(wire.website);
  if (!website) return undefined;
  const url =
    typeof website.authenticUrl === "string"
      ? website.authenticUrl
      : typeof website.baseUrl === "string"
        ? website.baseUrl
        : undefined;
  const title = typeof website.siteTitle === "string" ? website.siteTitle : undefined;
  if (!url && !title) return undefined;
  return { url, title };
}

/** Map one Squarespace `?format=json-pretty` response into export partials. */
export function mapJsonPrettyWire(
  wire: unknown,
  context?: { fetchedUrl?: string; isHomePage?: boolean },
): Partial<SquarespaceExport> {
  if (!isRecord(wire)) {
    throw new Error("Invalid Squarespace json-pretty response");
  }

  const collection = asRecord(wire.collection);
  const partial: Partial<SquarespaceExport> = {
    site: siteFromWire(wire),
    pages: [],
    posts: [],
    galleries: [],
    categories: mapWireCategories(collection),
    tags: [],
  };

  if (Array.isArray(wire.items)) {
    const itemRecords = wire.items
      .map((entry) => asRecord(entry))
      .filter((entry): entry is WireRecord => !!entry);

    if (collection && isGalleryCollection(collection)) {
      partial.galleries = [mapWireGalleryCollection(collection, itemRecords, context)];
      return partial;
    }

    partial.tags = mapWireTags(itemRecords);

    for (const item of itemRecords) {
      if (isStaticPageItem(item, collection)) {
        partial.pages!.push(
          mapWireItemToPage(item, { fallbackUrl: context?.fetchedUrl, isHomePage: context?.isHomePage }),
        );
      } else {
        partial.posts!.push(mapWireItemToPost(item, { fallbackUrl: context?.fetchedUrl }));
      }
    }
    return partial;
  }

  const item = asRecord(wire.item);
  if (item) {
    if (isStaticPageItem(item, collection)) {
      partial.pages!.push(
        mapWireItemToPage(item, { fallbackUrl: context?.fetchedUrl, isHomePage: context?.isHomePage }),
      );
    } else {
      partial.posts!.push(mapWireItemToPost(item, { fallbackUrl: context?.fetchedUrl }));
      partial.tags = mapWireTags([item]);
    }
    return partial;
  }

  if (collection && isGalleryCollection(collection)) {
    partial.galleries = [mapWireGalleryCollection(collection, [], context)];
    return partial;
  }

  if (collection && isBlogCollection(collection) === false) {
    const mainContent =
      typeof wire.mainContent === "string" ? wire.mainContent : undefined;
    const body =
      mainContent && !isEmptyClassicMainContent(mainContent)
        ? mainContent
        : typeof collection.description === "string"
          ? collection.description
          : undefined;
    partial.pages!.push(
      mapWireItemToPage(
        {
          id: collection.id ?? collection.urlId ?? collection.fullUrl,
          title: collection.title ?? collection.navigationTitle,
          urlId: collection.urlId,
          fullUrl: resolveAbsoluteUrl(
            typeof collection.fullUrl === "string" ? collection.fullUrl : undefined,
            context?.fetchedUrl,
          ),
          body,
          workflowState: collection.draft ? 2 : 1,
          seoData: collection.seoData,
        },
        { fallbackUrl: context?.fetchedUrl, isHomePage: context?.isHomePage },
      ),
    );
  }

  return partial;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(item.id, item);
  }
  return [...seen.values()];
}

function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(item.slug, item);
  }
  return [...seen.values()];
}

/** Merge multiple mapped partial exports into one canonical `SquarespaceExport`. */
export function mergeSquarespaceExportPartials(
  partials: Partial<SquarespaceExport>[],
): SquarespaceExport {
  const merged: SquarespaceExport = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    pages: [],
    posts: [],
    galleries: [],
    categories: [],
    tags: [],
  };

  for (const partial of partials) {
    if (partial.site) merged.site = { ...merged.site, ...partial.site };
    merged.pages.push(...(partial.pages ?? []));
    merged.posts!.push(...(partial.posts ?? []));
    merged.galleries!.push(...(partial.galleries ?? []));
    merged.categories!.push(...(partial.categories ?? []));
    merged.tags!.push(...(partial.tags ?? []));
  }

  merged.pages = dedupeById(merged.pages);
  merged.posts = dedupeById(merged.posts ?? []);
  merged.galleries = dedupeById(merged.galleries ?? []);
  merged.categories = dedupeBySlug(merged.categories ?? []);
  merged.tags = dedupeBySlug(merged.tags ?? []);
  return merged;
}

function paginationFromWire(wire: unknown): WirePagination | undefined {
  return asRecord(wire)?.pagination as WirePagination | undefined;
}

function inferTargetKind(target: SquarespaceCollectTarget): "page" | "collection" {
  if (target.kind && target.kind !== "auto") return target.kind;
  try {
    const pathname = new URL(target.url).pathname;
    if (pathname === "/" || pathname.endsWith("/")) return "collection";
  } catch {
    return "page";
  }
  return "page";
}

/** Fetch json-pretty pages/collections and assemble a canonical export document. */
export class SquarespaceCollectionClient {
  readonly format: SquarespaceJsonFormat;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly requestIntervalMs: number;
  readonly htmlFallback: boolean;
  readonly fetchImpl: typeof fetch;

  private lastRequestAt = 0;

  constructor(options: SquarespaceClientOptions = {}) {
    const parsed = squarespaceClientOptionsSchema.parse(options);
    this.format = parsed.format;
    this.maxRetries = parsed.maxRetries;
    this.retryBaseDelayMs = parsed.retryBaseDelayMs;
    this.maxRetryDelayMs = parsed.maxRetryDelayMs;
    this.requestIntervalMs = parsed.requestIntervalMs;
    this.htmlFallback = parsed.htmlFallback;
    this.fetchImpl = parsed.fetchImpl ?? fetch;
  }

  buildJsonPrettyUrl(pageUrl: string): string {
    return buildJsonPrettyUrl(pageUrl, this.format);
  }

  async fetchWire(url: string): Promise<unknown> {
    const response = await this.requestWithRetry(this.buildJsonPrettyUrl(url), {
      accept: "application/json, text/html, */*",
    });
    return response.json() as Promise<unknown>;
  }

  async fetchHtml(url: string): Promise<string> {
    const response = await this.requestWithRetry(url, {
      accept: "text/html,application/xhtml+xml",
    });
    return response.text();
  }

  async collectExport(targets: SquarespaceCollectTarget[]): Promise<SquarespaceExport> {
    if (targets.length === 0) {
      throw new Error("Squarespace collector requires at least one target URL");
    }

    const partials: Partial<SquarespaceExport>[] = [];
    for (const target of targets) {
      const kind = inferTargetKind(target);
      if (kind === "collection") {
        partials.push(...(await this.collectCollectionPages(target)));
      } else {
        const wire = await this.fetchWire(target.url);
        partials.push(
          mapJsonPrettyWire(wire, { fetchedUrl: target.url, isHomePage: target.isHomePage }),
        );
      }
    }

    const merged = mergeSquarespaceExportPartials(partials);
    if (this.htmlFallback) {
      await this.enrichEmptyPagesFromHtml(merged);
    }
    return merged;
  }

  private async enrichEmptyPagesFromHtml(doc: SquarespaceExport): Promise<void> {
    for (const page of doc.pages) {
      if (!pageContentIsEmpty(page)) continue;
      const pageUrl = page.url?.trim();
      if (!pageUrl) continue;
      try {
        const html = await this.fetchHtml(pageUrl);
        const content = extractPageContentFromHtml(html);
        if (content.blocks?.length) {
          page.blocks = content.blocks;
          delete page.contentHtml;
        } else if (content.contentHtml?.trim()) {
          page.contentHtml = content.contentHtml;
          delete page.blocks;
        }
      } catch {
        // Leave empty page; host scan can surface the gap.
      }
    }
  }

  private async collectCollectionPages(
    target: SquarespaceCollectTarget,
  ): Promise<Partial<SquarespaceExport>[]> {
    const partials: Partial<SquarespaceExport>[] = [];
    let nextUrl: string | undefined = target.url;

    while (nextUrl) {
      const wire = await this.fetchWire(nextUrl);
      partials.push(
        mapJsonPrettyWire(wire, { fetchedUrl: nextUrl, isHomePage: target.isHomePage }),
      );

      const pagination = paginationFromWire(wire);
      if (!pagination?.nextPage || !pagination.nextPageUrl) break;
      const base = new URL(target.url);
      nextUrl = new URL(pagination.nextPageUrl, `${base.origin}/`).toString();
    }

    return partials;
  }

  private async requestWithRetry(
    url: string,
    options?: { accept?: string },
  ): Promise<Response> {
    let attempt = 0;
    const accept = options?.accept ?? "application/json, text/html, */*";
    while (true) {
      await this.throttle();
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: accept },
      });

      if (response.ok) {
        return response;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Squarespace HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }

      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs * 2 ** attempt);
      await sleep(delay);
      attempt += 1;
    }
  }

  private async throttle(): Promise<void> {
    if (this.requestIntervalMs <= 0) return;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.requestIntervalMs) {
      await sleep(this.requestIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}
