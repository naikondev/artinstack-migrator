import { sanitizeSlug } from "../../lib/utility.js";
import { ricosToHtml } from "./ricos-to-html.js";
import type { WixCategory, WixPost, WixTag } from "./types.js";

interface WireRecord {
  [key: string]: unknown;
}

interface WirePageUrl {
  base?: string;
  path?: string;
}

function isRecord(value: unknown): value is WireRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function buildWixPageUrl(url: WirePageUrl | undefined): string | undefined {
  if (!url) return undefined;
  const base = asString(url.base);
  const path = asString(url.path);
  if (base && path) {
    return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return base ?? path;
}

function seoField(seoData: unknown, prop: "title" | "description"): string | undefined {
  const tags = asRecord(seoData)?.tags;
  if (!Array.isArray(tags)) return undefined;
  for (const tag of tags) {
    const record = asRecord(tag);
    if (!record) continue;
    const props = asRecord(record.props);
    if (record.type === "title" && prop === "title") {
      return asString(props?.children) ?? asString(record.children);
    }
    if (record.type === "meta" && prop === "description" && props?.name === "description") {
      return asString(props.content);
    }
  }
  return undefined;
}

function postContentHtml(post: WireRecord): string {
  const richHtml = ricosToHtml(post.richContent);
  if (richHtml.trim()) return richHtml;
  const plain = asString(post.contentText);
  if (!plain) return "";
  return `<p>${plain.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br />")}</p>`;
}

export function mapWireCategory(
  wire: unknown,
  exportedAt?: string,
): WixCategory | undefined {
  const record = asRecord(wire);
  if (!record) return undefined;
  const id = asString(record.id);
  const name = asString(record.label) ?? asString(record.title);
  if (!id || !name) return undefined;
  const slug = sanitizeSlug(asString(record.slug) ?? name);
  if (!slug) return undefined;
  void exportedAt;
  return { id, name, slug };
}

export function mapWireTag(wire: unknown): WixTag | undefined {
  const record = asRecord(wire);
  if (!record) return undefined;
  const id = asString(record.id);
  const name = asString(record.label) ?? asString(record.slug);
  if (!id || !name) return undefined;
  const slug = sanitizeSlug(asString(record.slug) ?? name);
  if (!slug) return undefined;
  return { id, name, slug };
}

export function mapWirePost(
  wire: unknown,
  lookup: { categorySlugsById: Map<string, string>; tagSlugsById: Map<string, string> },
): WixPost | undefined {
  const record = asRecord(wire);
  if (!record) return undefined;

  const id = asString(record.id);
  const title = asString(record.title) ?? "Untitled";
  if (!id) return undefined;

  const slug = sanitizeSlug(asString(record.slug) ?? title);
  const url = buildWixPageUrl(asRecord(record.url) as WirePageUrl | undefined);
  const heroImage = asRecord(record.heroImage);
  const featuredImageUrl = asString(heroImage?.url);

  const categorySlugs = asStringArray(record.categoryIds)
    .map((categoryId) => lookup.categorySlugsById.get(categoryId))
    .filter((slugValue): slugValue is string => !!slugValue);

  const tagSlugs = asStringArray(record.tagIds)
    .map((tagId) => lookup.tagSlugsById.get(tagId))
    .filter((slugValue): slugValue is string => !!slugValue);

  for (const hashtag of asStringArray(record.hashtags)) {
    const tagSlug = sanitizeSlug(hashtag);
    if (tagSlug && !tagSlugs.includes(tagSlug)) tagSlugs.push(tagSlug);
  }

  return {
    id,
    title,
    slug,
    url,
    excerpt: asString(record.excerpt),
    contentHtml: postContentHtml(record),
    publishedAt: asString(record.firstPublishedDate) ?? asString(record.lastPublishedDate),
    status: "published",
    categorySlugs,
    tagSlugs,
    featuredImageUrl,
    seoTitle: seoField(record.seoData, "title"),
    seoDescription: seoField(record.seoData, "description"),
  };
}

export function mapWireListPostsResponse(
  wire: unknown,
  lookup: { categorySlugsById: Map<string, string>; tagSlugsById: Map<string, string> },
): WixPost[] {
  const posts = asRecord(wire)?.posts;
  if (!Array.isArray(posts)) return [];
  return posts
    .map((entry) => mapWirePost(entry, lookup))
    .filter((post): post is WixPost => !!post);
}

export function mapWireListCategoriesResponse(wire: unknown): WixCategory[] {
  const categories = asRecord(wire)?.categories;
  if (!Array.isArray(categories)) return [];
  return categories
    .map((entry) => mapWireCategory(entry))
    .filter((category): category is WixCategory => !!category);
}

export function mapWireListTagsResponse(wire: unknown): WixTag[] {
  const tags = asRecord(wire)?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((entry) => mapWireTag(entry))
    .filter((tag): tag is WixTag => !!tag);
}
