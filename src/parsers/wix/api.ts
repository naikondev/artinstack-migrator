import { z } from "zod";

import { sanitizeSlug } from "../../lib/utility.js";
import {
  mapWireListCategoriesResponse,
  mapWireListPostsResponse,
  mapWireListTagsResponse,
} from "./map-wire.js";
import type { WixCategory, WixExport, WixPost, WixTag } from "./types.js";

/** Wix REST API base — raw HTTP only; no `@wix/sdk`. */
export const WIX_API_BASE = "https://www.wixapis.com";

export const wixAuthContextSchema = z.object({
  /** Full Authorization header value (API key or Bearer token). */
  authorization: z.string().min(1),
  siteId: z.string().min(1),
  accountId: z.string().optional(),
  extraHeaders: z.record(z.string()).optional(),
});

export type WixAuthContext = z.infer<typeof wixAuthContextSchema>;

export const wixClientOptionsSchema = z.object({
  auth: wixAuthContextSchema,
  pageSize: z.number().int().min(1).max(100).default(50),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryBaseDelayMs: z.number().int().min(0).default(500),
  maxRetryDelayMs: z.number().int().min(0).default(8000),
  requestIntervalMs: z.number().int().min(0).default(200),
  fetchImpl: z.custom<typeof fetch>().optional(),
  /** Include draft posts when the API key has permission. */
  includeDrafts: z.boolean().default(false),
});

export type WixClientOptions = z.input<typeof wixClientOptionsSchema>;

interface WirePaging {
  count?: number;
  offset?: number;
  total?: number;
  tooManyToCount?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(item.id, item);
  return [...seen.values()];
}

function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(item.slug, item);
  return [...seen.values()];
}

function pagingComplete(items: unknown[], paging: WirePaging | undefined, pageSize: number): boolean {
  if (!Array.isArray(items) || items.length === 0) return true;
  if (items.length < pageSize) return true;
  if (typeof paging?.total === "number" && typeof paging.offset === "number") {
    return paging.offset + items.length >= paging.total;
  }
  return false;
}

/** Fetch blog posts, categories, and tags via injected `fetch` + vault auth headers. */
export class WixCollectionClient {
  readonly auth: WixAuthContext;
  readonly pageSize: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly requestIntervalMs: number;
  readonly fetchImpl: typeof fetch;
  readonly includeDrafts: boolean;

  private lastRequestAt = 0;

  constructor(options: WixClientOptions) {
    const parsed = wixClientOptionsSchema.parse(options);
    this.auth = parsed.auth;
    this.pageSize = parsed.pageSize;
    this.maxRetries = parsed.maxRetries;
    this.retryBaseDelayMs = parsed.retryBaseDelayMs;
    this.maxRetryDelayMs = parsed.maxRetryDelayMs;
    this.requestIntervalMs = parsed.requestIntervalMs;
    this.fetchImpl = parsed.fetchImpl ?? fetch;
    this.includeDrafts = parsed.includeDrafts;
  }

  buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : `${WIX_API_BASE}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchJson<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const response = await this.requestWithRetry(this.buildUrl(path, query));
    return response.json() as Promise<T>;
  }

  async listAllCategories(): Promise<WixCategory[]> {
    const categories: WixCategory[] = [];
    let offset = 0;

    while (true) {
      const wire = await this.fetchJson("/blog/v3/categories", {
        "paging.limit": this.pageSize,
        "paging.offset": offset,
        fieldsets: "URL",
      });
      const batch = mapWireListCategoriesResponse(wire);
      categories.push(...batch);

      const paging = (wire as { pagingMetadata?: WirePaging }).pagingMetadata;
      if (pagingComplete(batch, paging, this.pageSize)) break;
      offset += batch.length;
      if (batch.length === 0) break;
    }

    return dedupeBySlug(categories);
  }

  async listAllTags(): Promise<WixTag[]> {
    const tags: WixTag[] = [];
    let offset = 0;

    while (true) {
      const wire = await this.fetchJson("/blog/v3/tags", {
        "paging.limit": this.pageSize,
        "paging.offset": offset,
      });
      const batch = mapWireListTagsResponse(wire);
      tags.push(...batch);

      const paging = (wire as { pagingMetadata?: WirePaging }).pagingMetadata;
      if (pagingComplete(batch, paging, this.pageSize)) break;
      offset += batch.length;
      if (batch.length === 0) break;
    }

    return dedupeBySlug(tags);
  }

  async listAllPosts(lookup: {
    categorySlugsById: Map<string, string>;
    tagSlugsById: Map<string, string>;
  }): Promise<WixPost[]> {
    const posts: WixPost[] = [];
    let offset = 0;

    while (true) {
      const wire = await this.fetchJson("/blog/v3/posts", {
        "paging.limit": this.pageSize,
        "paging.offset": offset,
        fieldsets: "URL,RICH_CONTENT,SEO",
        sort: "PUBLISHED_DATE_DESC",
      });
      const batch = mapWireListPostsResponse(wire, lookup);
      posts.push(...batch);

      const paging = (wire as { pagingMetadata?: WirePaging }).pagingMetadata;
      if (pagingComplete(batch, paging, this.pageSize)) break;
      offset += batch.length;
      if (batch.length === 0) break;
    }

    if (this.includeDrafts) {
      posts.push(...(await this.listDraftPosts(lookup)));
    }

    return dedupeById(posts);
  }

  private async listDraftPosts(lookup: {
    categorySlugsById: Map<string, string>;
    tagSlugsById: Map<string, string>;
  }): Promise<WixPost[]> {
    const posts: WixPost[] = [];
    let offset = 0;

    while (true) {
      const wire = await this.fetchJson("/blog/v3/draft-posts", {
        "paging.limit": this.pageSize,
        "paging.offset": offset,
        fieldsets: "URL,RICH_CONTENT,SEO",
      });
      const batch = mapWireListPostsResponse(
        { posts: (wire as { draftPosts?: unknown[] }).draftPosts ?? [] },
        lookup,
      ).map((post) => ({ ...post, status: "draft" as const }));
      posts.push(...batch);

      const paging = (wire as { pagingMetadata?: WirePaging }).pagingMetadata;
      if (pagingComplete(batch, paging, this.pageSize)) break;
      offset += batch.length;
      if (batch.length === 0) break;
    }

    return posts;
  }

  async collectExport(): Promise<WixExport> {
    const categories = await this.listAllCategories();
    const tags = await this.listAllTags();

    const categorySlugsById = new Map(categories.map((category) => [category.id, category.slug]));
    const tagSlugsById = new Map(tags.map((tag) => [tag.id, tag.slug]));

    const posts = await this.listAllPosts({ categorySlugsById, tagSlugsById });

    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      site: { siteId: this.auth.siteId },
      posts,
      pages: [],
      categories,
      tags,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.auth.authorization,
      "wix-site-id": this.auth.siteId,
      ...(this.auth.extraHeaders ?? {}),
    };
    if (this.auth.accountId) {
      headers["wix-account-id"] = this.auth.accountId;
    }
    return headers;
  }

  private async requestWithRetry(url: string): Promise<Response> {
    let attempt = 0;
    while (true) {
      await this.throttle();
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Wix HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
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

/** Map a collected wire fixture (already normalized to list-* response shapes) into WixExport. */
export function mergeWixWireFixtures(partials: {
  categories?: unknown;
  tags?: unknown;
  posts?: unknown;
  exportedAt?: string;
  site?: WixExport["site"];
}): WixExport {
  const categories = mapWireListCategoriesResponse(partials.categories ?? { categories: [] });
  const tags = mapWireListTagsResponse(partials.tags ?? { tags: [] });
  const categorySlugsById = new Map(categories.map((category) => [category.id, category.slug]));
  const tagSlugsById = new Map(tags.map((tag) => [tag.id, tag.slug]));
  const posts = mapWireListPostsResponse(partials.posts ?? { posts: [] }, {
    categorySlugsById,
    tagSlugsById,
  });

  return {
    exportVersion: 1,
    exportedAt: partials.exportedAt ?? new Date().toISOString(),
    site: partials.site,
    categories: dedupeBySlug(categories),
    tags: dedupeBySlug(tags),
    posts: dedupeById(posts),
    pages: [],
  };
}

export function isWixExport(value: unknown): value is WixExport {
  if (!value || typeof value !== "object") return false;
  const record = value as WixExport;
  return (
    record.exportVersion === 1 &&
    (Array.isArray(record.posts) || Array.isArray(record.pages))
  );
}

/** Validate exportVersion 1 JSON with posts and/or pages arrays. */
export function assertWixExport(value: unknown): WixExport {
  if (!isWixExport(value)) {
    throw new Error("Invalid Wix export: expected exportVersion 1 with posts[] and/or pages[]");
  }
  if ((value.posts?.length ?? 0) === 0 && (value.pages?.length ?? 0) === 0) {
    throw new Error("Invalid Wix export: no posts or pages");
  }
  for (const post of value.posts ?? []) {
    if (!post.slug) post.slug = sanitizeSlug(post.title);
  }
  for (const page of value.pages ?? []) {
    if (!page.slug) page.slug = sanitizeSlug(page.title);
  }
  return value;
}
