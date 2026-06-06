import type { Readable } from "node:stream";

import type {
  EntityKey,
  NormalizedAsset,
  NormalizedPage,
  NormalizedPortfolio,
  NormalizedPost,
} from "../normalizer/types.js";

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
  /** Byte stream from source URL or local file. Host performs upload. */
  body: Readable | ReadableStream<Uint8Array>;
  contentLength?: number;
}

export interface UploadAssetResult {
  targetId: string;
  publicUrl?: string;
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
  createPost(post: NormalizedPost): Promise<CreatePostResult>;
  createPage(page: NormalizedPage): Promise<CreatePageResult>;
  createPortfolio?(portfolio: NormalizedPortfolio): Promise<{ targetId: string }>;
  uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult>;
  reportProgress?(progress: MigrationProgress): Promise<void>;
  /** Optional lookup for idempotent re-runs. */
  findExisting?(key: EntityKey): Promise<string | undefined>;
}

export interface MigrationRunOptions {
  sink: MigrationSink;
  entities: AsyncIterable<
    import("../normalizer/types.js").NormalizedEntity
  >;
  platform: import("../normalizer/types.js").MigrationPlatform;
  onEntityProcessed?: (key: EntityKey, result: "done" | "failed" | "skipped", error?: string) => void;
}

export interface MigrationRunResult {
  processed: number;
  failed: number;
  skipped: number;
}
