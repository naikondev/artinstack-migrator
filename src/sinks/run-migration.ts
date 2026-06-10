import { Readable } from "node:stream";

import { collectEntities, type EntityBundle } from "../normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../normalizer/portfolio-media.js";
import { shouldProcessEntity } from "../normalizer/idempotency.js";
import { entityKey } from "../normalizer/types.js";
import type {
  EntityKey,
  NormalizedPage,
  NormalizedPost,
} from "../normalizer/types.js";
import { normalizeAssetUrl } from "../lib/content-asset-urls.js";
import { rewriteInlineImages, type RewriteInlineImagesOptions } from "../transformers/rewrite-inline-images.js";
import { buildRedirectMap } from "./conflicts.js";
import type {
  MigrationRunOptions,
  MigrationRunResult,
  MigrationWriteStage,
  UploadAssetResult,
} from "./types.js";

export async function runMigration(options: MigrationRunOptions): Promise<MigrationRunResult> {
  const bundle = await collectEntities(options.entities);
  return runMigrationFromBundle(bundle, options);
}

export async function runMigrationFromBundle(
  bundle: EntityBundle,
  options: MigrationRunOptions,
): Promise<MigrationRunResult> {
  const { sink, platform, onEntityProcessed } = options;
  const checkpointEntities: import("../normalizer/idempotency.js").TrackedEntity[] = [];
  const uploadedAssets = new Map<string, UploadAssetResult>();

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  const track = async (
    stage: MigrationWriteStage,
    key: EntityKey,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (!shouldProcessEntity(key, checkpointEntities)) {
      skipped += 1;
      onEntityProcessed?.(key, "skipped");
      return;
    }

    const existingTargetId = await sink.findExisting?.(key);
    if (existingTargetId) {
      if (stage === "assets" && key.entityType === "asset") {
        uploadedAssets.set(key.sourceId, { targetId: existingTargetId });
      }
      skipped += 1;
      onEntityProcessed?.(key, "skipped");
      return;
    }

    try {
      await sink.reportProgress?.({
        stage,
        progress: processed + failed + skipped,
        message: `${stage}:${key.entityType}:${key.sourceId}`,
      });
      await action();
      processed += 1;
      onEntityProcessed?.(key, "done");
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      onEntityProcessed?.(key, "failed", message);
    }
  };

  for (const category of bundle.categories) {
    const key = entityKey(category, platform);
    await track("taxonomy", key, async () => {
      if (!sink.createCategory) return;
      await sink.createCategory(category);
    });
  }

  for (const tag of bundle.tags) {
    const key = entityKey(tag, platform);
    await track("taxonomy", key, async () => {
      if (!sink.createTag) return;
      await sink.createTag(tag);
    });
  }

  for (const asset of bundle.media) {
    const key = entityKey(asset, platform);
    await track("assets", key, async () => {
      const stream = options.resolveAssetStream ? await options.resolveAssetStream(asset) : null;
      const result = await sink.uploadAsset({
        asset,
        body: stream?.body ?? emptyBody(),
        contentLength: stream?.contentLength,
      });
      uploadedAssets.set(asset.sourceId, result);
    });
  }

  for (const portfolio of bundle.portfolios) {
    const key = entityKey(portfolio, platform);
    await track("portfolios", key, async () => {
      if (!sink.createPortfolio) {
        throw new Error("Sink does not support portfolios");
      }
      await sink.createPortfolio(portfolio);
    });
  }

  for (const post of bundle.posts) {
    const key = entityKey(post, platform);
    await track("content", key, async () => {
      await sink.createPost(
        prepareContentEntity(post, options, uploadedAssets, bundle),
      );
    });
  }

  for (const page of bundle.pages) {
    const key = entityKey(page, platform);
    await track("content", key, async () => {
      await sink.createPage(
        prepareContentEntity(page, options, uploadedAssets, bundle),
      );
    });
  }

  const portfolioLinks = buildPortfolioMediaLinks(bundle);
  for (const link of portfolioLinks) {
    const key: EntityKey = {
      platform,
      entityType: "asset",
      sourceId: `${link.portfolioSourceId}:${link.assetSourceId}`,
    };
    await track("bindings", key, async () => {
      if (!sink.linkPortfolioMedia) return;
      await sink.linkPortfolioMedia(link);
    });
  }

  const redirects = buildRedirectMap(bundle);
  for (const redirect of redirects) {
    const key: EntityKey = {
      platform,
      entityType: "page",
      sourceId: `redirect:${redirect.fromPath}`,
    };
    await track("redirects", key, async () => {
      if (!sink.writeRedirect) return;
      await sink.writeRedirect(redirect);
    });
  }

  return { processed, failed, skipped };
}

function prepareContentEntity<T extends NormalizedPost | NormalizedPage>(
  entity: T,
  options: MigrationRunOptions,
  uploadedAssets: Map<string, UploadAssetResult>,
  bundle: EntityBundle,
): T {
  if (!options.rewriteInlineImages) return entity;

  const rewriteOptions = mergeRewriteOptions(bundle, options.rewriteInlineImages);
  const rewritten = rewriteInlineImages(entity.contentHtml, rewriteOptions, uploadedAssets);

  return {
    ...entity,
    contentHtml: rewritten.html,
  };
}

function mergeRewriteOptions(
  bundle: EntityBundle,
  options: RewriteInlineImagesOptions,
): RewriteInlineImagesOptions {
  const urlToSourceId = new Map<string, string>();
  for (const asset of bundle.media) {
    urlToSourceId.set(asset.sourceUrl, asset.sourceId);
    const normalized = normalizeAssetUrl(asset.sourceUrl);
    if (normalized) urlToSourceId.set(normalized, asset.sourceId);
  }

  return {
    resolveAsset: (src) => {
      const resolved = options.resolveAsset(src);
      if (resolved) return resolved;
      const normalized = normalizeAssetUrl(src);
      const sourceAssetId =
        (normalized ? urlToSourceId.get(normalized) : undefined) ?? urlToSourceId.get(src);
      if (!sourceAssetId) return undefined;
      return { originalSrc: src, sourceAssetId };
    },
    replaceWith: options.replaceWith,
  };
}

function emptyBody(): Readable {
  return Readable.from([]);
}

export type { EntityKey };
