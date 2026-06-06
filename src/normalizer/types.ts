export type MigrationPlatform = "wordpress" | "smugmug" | "squarespace";

export type EntityType = "post" | "page" | "asset" | "portfolio" | "category" | "tag";

export type PublishStatus = "draft" | "published" | "archived";

/** Canonical post DTO — not a Directus shape. */
export interface NormalizedPost {
  type: "post";
  sourceId: string;
  title: string;
  slug: string;
  excerpt?: string;
  contentHtml: string;
  publishedAt?: string;
  status: PublishStatus;
  categorySlugs?: string[];
  tagSlugs?: string[];
  featuredAssetSourceId?: string;
  seoTitle?: string;
  seoDescription?: string;
}

/** Canonical page DTO — Grapes `content` is Phase 2+. */
export interface NormalizedPage {
  type: "page";
  sourceId: string;
  title: string;
  slug: string;
  contentHtml: string;
  contentCss?: string;
  isHomePage?: boolean;
  status: PublishStatus;
  seoTitle?: string;
  seoDescription?: string;
}

/** Remote asset to stream into the host sink. */
export interface NormalizedAsset {
  type: "asset";
  sourceId: string;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  caption?: string;
  altText?: string;
  portfolioSourceId?: string;
  sort?: number;
}

export interface NormalizedPortfolio {
  type: "portfolio";
  sourceId: string;
  title: string;
  slug: string;
  description?: string;
  parentSourceId?: string;
}

export interface NormalizedCategory {
  type: "category";
  sourceId: string;
  name: string;
  slug: string;
}

export interface NormalizedTag {
  type: "tag";
  sourceId: string;
  name: string;
  slug: string;
}

export type NormalizedEntity =
  | NormalizedPost
  | NormalizedPage
  | NormalizedAsset
  | NormalizedPortfolio
  | NormalizedCategory
  | NormalizedTag;

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  summary?: {
    posts?: number;
    pages?: number;
    assets?: number;
    portfolios?: number;
  };
}

export interface AdapterContext {
  /** Opaque credentials or file paths supplied by the host / CLI. */
  input: unknown;
  /** Resume cursor from a prior run (portable JSON). */
  cursor?: MigrationCursor;
}

export interface MigrationAdapter {
  platform: MigrationPlatform;
  validateInput(input: unknown): ValidationResult | Promise<ValidationResult>;
  enumerateEntities(ctx: AdapterContext): AsyncIterable<NormalizedEntity>;
}

export interface MigrationCursor {
  /** Last processed entity key for resume. */
  lastEntityKey?: EntityKey;
  /** Adapter-specific opaque state. */
  state?: Record<string, unknown>;
}

export interface EntityKey {
  platform: MigrationPlatform;
  entityType: EntityType;
  sourceId: string;
}

export function entityKey(entity: NormalizedEntity, platform: MigrationPlatform): EntityKey {
  return {
    platform,
    entityType: entity.type === "asset" ? "asset" : entity.type,
    sourceId: entity.sourceId,
  };
}
