import { shouldProcessEntity } from "../normalizer/idempotency.js";
import { entityKey } from "../normalizer/types.js";
import type { EntityKey, NormalizedEntity } from "../normalizer/types.js";
import type { MigrationRunOptions, MigrationRunResult } from "./types.js";

export async function runMigration(options: MigrationRunOptions): Promise<MigrationRunResult> {
  const { sink, entities, platform, onEntityProcessed } = options;
  const checkpointEntities: import("../normalizer/idempotency.js").TrackedEntity[] = [];

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for await (const entity of entities) {
    const key = entityKey(entity, platform);

    if (!shouldProcessEntity(key, checkpointEntities)) {
      skipped += 1;
      onEntityProcessed?.(key, "skipped");
      continue;
    }

    const existingTargetId = await sink.findExisting?.(key);
    if (existingTargetId) {
      skipped += 1;
      onEntityProcessed?.(key, "skipped");
      continue;
    }

    try {
      await dispatchEntity(sink, entity);
      processed += 1;
      onEntityProcessed?.(key, "done");
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      onEntityProcessed?.(key, "failed", message);
    }
  }

  return { processed, failed, skipped };
}

async function dispatchEntity(
  sink: MigrationRunOptions["sink"],
  entity: NormalizedEntity,
): Promise<void> {
  switch (entity.type) {
    case "post":
      await sink.createPost(entity);
      return;
    case "page":
      await sink.createPage(entity);
      return;
    case "portfolio":
      if (!sink.createPortfolio) {
        throw new Error("Sink does not support portfolios");
      }
      await sink.createPortfolio(entity);
      return;
    case "asset":
      throw new Error(
        "Asset entities require a resolved byte stream; use adapter-specific asset pipeline",
      );
    case "category":
    case "tag":
      // Taxonomy writes are sink-specific extensions in Phase 1.
      return;
    default: {
      const _exhaustive: never = entity;
      throw new Error(`Unhandled entity type: ${(_exhaustive as NormalizedEntity).type}`);
    }
  }
}

export type { EntityKey };
