export type MigrationPlatform = "wordpress" | "smugmug" | "squarespace" | "wix";

export type EntityType = "post" | "page" | "asset" | "portfolio" | "category" | "tag";

export type PublishStatus = "draft" | "published" | "archived";

export interface SourceMetadata {
  platform: MigrationPlatform;
  id: string;
  url?: string;
  path?: string;
  exportedAt?: string;
}

/** Canonical post DTO — raw HTML; sanitize at host sink. */
export interface NormalizedPost {
  type: "post";
  source: SourceMetadata;
  sourceId: string;
  title: string;
  slug: string;
  excerpt?: string;
  contentHtml: string;
  publishedAt?: string;
  status: PublishStatus;
  categorySlugs?: string[];
  tagSlugs?: string[];
  /** WordPress attachment id before two-pass resolution. */
  sourceFeaturedMediaId?: string;
  featuredAssetSourceId?: string;
  seoTitle?: string;
  seoDescription?: string;
}

/** Canonical page DTO — raw HTML snapshot. */
export interface NormalizedPage {
  type: "page";
  source: SourceMetadata;
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

/** EXIF fields preserved from SmugMug / camera metadata when present. */
export interface NormalizedAssetExif {
  iso?: number;
  aperture?: number;
  shutter?: string;
  focalLength?: number;
}

/** Remote asset to stream into the host sink. */
export interface NormalizedAsset {
  type: "asset";
  source: SourceMetadata;
  sourceId: string;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  caption?: string;
  altText?: string;
  keywords?: string[];
  exif?: NormalizedAssetExif;
  portfolioSourceId?: string;
  sort?: number;
}

/** M2M index: portfolio ↔ asset membership and sort order. */
export interface PortfolioMediaLink {
  portfolioSourceId: string;
  assetSourceId: string;
  sort: number;
}

export interface NormalizedPortfolio {
  type: "portfolio";
  source: SourceMetadata;
  sourceId: string;
  title: string;
  slug: string;
  description?: string;
  parentSourceId?: string;
}

export interface NormalizedCategory {
  type: "category";
  source: SourceMetadata;
  sourceId: string;
  name: string;
  slug: string;
}

export interface NormalizedTag {
  type: "tag";
  source: SourceMetadata;
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
    categories?: number;
    tags?: number;
  };
}

export interface AdapterContext {
  input: unknown;
  cursor?: MigrationCursor;
}

export interface MigrationAdapter {
  platform: MigrationPlatform;
  validateInput(input: unknown): ValidationResult | Promise<ValidationResult>;
  enumerateEntities(ctx: AdapterContext): AsyncIterable<NormalizedEntity>;
}

export interface MigrationCursor {
  lastEntityKey?: EntityKey;
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
    entityType: entity.type,
    sourceId: entity.sourceId,
  };
}
