import { z } from "zod";

import type { ValidationIssue, ValidationResult } from "./types.js";

const migrationPlatformSchema = z.enum(["wordpress", "smugmug", "squarespace"]);
const publishStatusSchema = z.enum(["draft", "published", "archived"]);

export const sourceMetadataSchema = z.object({
  platform: migrationPlatformSchema,
  id: z.string().min(1),
  url: z.string().optional(),
  path: z.string().optional(),
  exportedAt: z.string().optional(),
});

export const normalizedPostSchema = z.object({
  type: z.literal("post"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  excerpt: z.string().optional(),
  contentHtml: z.string(),
  publishedAt: z.string().optional(),
  status: publishStatusSchema,
  categorySlugs: z.array(z.string().min(1)).optional(),
  tagSlugs: z.array(z.string().min(1)).optional(),
  sourceFeaturedMediaId: z.string().optional(),
  featuredAssetSourceId: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export const normalizedPageSchema = z.object({
  type: z.literal("page"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  contentHtml: z.string(),
  contentCss: z.string().optional(),
  isHomePage: z.boolean().optional(),
  status: publishStatusSchema,
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export const normalizedAssetExifSchema = z.object({
  iso: z.number().optional(),
  aperture: z.number().optional(),
  shutter: z.string().optional(),
  focalLength: z.number().optional(),
});

export const normalizedAssetSchema = z.object({
  type: z.literal("asset"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  sourceUrl: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  caption: z.string().optional(),
  altText: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  exif: normalizedAssetExifSchema.optional(),
  portfolioSourceId: z.string().optional(),
  sort: z.number().optional(),
});

export const normalizedPortfolioSchema = z.object({
  type: z.literal("portfolio"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  parentSourceId: z.string().optional(),
});

export const normalizedCategorySchema = z.object({
  type: z.literal("category"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const normalizedTagSchema = z.object({
  type: z.literal("tag"),
  source: sourceMetadataSchema,
  sourceId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const normalizedEntitySchema = z.discriminatedUnion("type", [
  normalizedPostSchema,
  normalizedPageSchema,
  normalizedAssetSchema,
  normalizedPortfolioSchema,
  normalizedCategorySchema,
  normalizedTagSchema,
]);

function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.length > 0 ? issue.path.join(".") : undefined,
  }));
}

function parseToValidationResult(schema: z.ZodTypeAny, value: unknown): ValidationResult {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, issues: [] };
  }
  return { ok: false, issues: zodIssuesToValidationIssues(result.error.issues) };
}

/** Opt-in structural check for a normalized post DTO (no cross-entity FK validation). */
export function validateNormalizedPost(post: unknown): ValidationResult {
  return parseToValidationResult(normalizedPostSchema, post);
}

/** Opt-in structural check for a normalized page DTO (no cross-entity FK validation). */
export function validateNormalizedPage(page: unknown): ValidationResult {
  return parseToValidationResult(normalizedPageSchema, page);
}

/** Opt-in structural check for a normalized asset DTO. */
export function validateNormalizedAsset(asset: unknown): ValidationResult {
  return parseToValidationResult(normalizedAssetSchema, asset);
}

/** Opt-in structural check for a normalized portfolio DTO. */
export function validateNormalizedPortfolio(portfolio: unknown): ValidationResult {
  return parseToValidationResult(normalizedPortfolioSchema, portfolio);
}

/** Opt-in structural check for a normalized category DTO. */
export function validateNormalizedCategory(category: unknown): ValidationResult {
  return parseToValidationResult(normalizedCategorySchema, category);
}

/** Opt-in structural check for a normalized tag DTO. */
export function validateNormalizedTag(tag: unknown): ValidationResult {
  return parseToValidationResult(normalizedTagSchema, tag);
}

/** Opt-in structural check for any normalized entity discriminated by `type`. */
export function validateNormalizedEntity(entity: unknown): ValidationResult {
  return parseToValidationResult(normalizedEntitySchema, entity);
}
