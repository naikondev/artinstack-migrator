import type { Readable } from "node:stream";

import type {
  EntityKey,
  NormalizedAsset,
  NormalizedCategory,
  NormalizedPage,
  NormalizedPortfolio,
  NormalizedPost,
  NormalizedTag,
  PortfolioMediaLink,
} from "../normalizer/types.js";
import type { RewriteInlineImagesOptions } from "../transformers/rewrite-inline-images.js";

export interface CreatePostResult {
  targetId: string;
  publicPath: string;
}

export interface CreatePageResult {
  targetId: string;
  publicPath: string;
}

export interface UploadAssetInput {
  asset: NormalizedAsset;
  /** Byte stream from source URL or local file. Optional for metadata-only sinks. */
  body?: Readable | ReadableStream<Uint8Array>;
  contentLength?: number;
}

export interface UploadAssetResult {
  targetId: string;
  publicUrl?: string;
}

export interface MigrationRedirect {
  fromPath: string;
  toPath: string;
  statusCode: number;
}

export interface MigrationProgress {
  stage: string;
  progress: number;
  message?: string;
}

/**
 * Host-implemented write surface (e.g. ArtInStack PlatformMigrationSink).
 * This package defines the interface only — no Directus or platform imports.
 */
export interface MigrationSink {
  createCategory?(category: NormalizedCategory): Promise<{ targetId: string }>;
  createTag?(tag: NormalizedTag): Promise<{ targetId: string }>;
  uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult>;
  createPortfolio?(portfolio: NormalizedPortfolio): Promise<{ targetId: string }>;
  createPost(post: NormalizedPost): Promise<CreatePostResult>;
  createPage(page: NormalizedPage): Promise<CreatePageResult>;
  linkPortfolioMedia?(link: PortfolioMediaLink): Promise<void>;
  writeRedirect?(redirect: MigrationRedirect): Promise<void>;
  reportProgress?(progress: MigrationProgress): Promise<void>;
  /** Optional lookup for idempotent re-runs. */
  findExisting?(key: EntityKey): Promise<string | undefined>;
}

export interface ResolvedAssetStream {
  body: Readable | ReadableStream<Uint8Array>;
  contentLength?: number;
}

export interface MigrationRunOptions {
  sink: MigrationSink;
  entities: AsyncIterable<import("../normalizer/types.js").NormalizedEntity>;
  platform: import("../normalizer/types.js").MigrationPlatform;
  /** Fetch source bytes before uploadAsset; omit for metadata-only sinks. */
  resolveAssetStream?: (asset: NormalizedAsset) => Promise<ResolvedAssetStream | null>;
  /** Rewrite post/page HTML after assets are uploaded. */
  rewriteInlineImages?: RewriteInlineImagesOptions;
  onEntityProcessed?: (key: EntityKey, result: "done" | "failed" | "skipped", error?: string) => void;
}

export interface MigrationRunResult {
  processed: number;
  failed: number;
  skipped: number;
}

export const MIGRATION_WRITE_STAGES = [
  "taxonomy",
  "assets",
  "portfolios",
  "content",
  "bindings",
  "redirects",
] as const;

export type MigrationWriteStage = (typeof MIGRATION_WRITE_STAGES)[number];
