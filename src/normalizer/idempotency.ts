import type { EntityKey, MigrationCursor } from "./types.js";

/** Portable entity state for resume / idempotency (not Directus field names). */
export type EntityState = "pending" | "done" | "failed" | "skipped";

export interface TrackedEntity extends EntityKey {
  state: EntityState;
  targetId?: string;
  errorMessage?: string;
}

export interface MigrationCheckpoint {
  jobId: string;
  cursor: MigrationCursor;
  entities: TrackedEntity[];
  updatedAt: string;
}

export function isTerminalState(state: EntityState): boolean {
  return state === "done" || state === "skipped";
}

export function shouldProcessEntity(
  key: EntityKey,
  entities: TrackedEntity[],
): boolean {
  const existing = entities.find(
    (e) =>
      e.platform === key.platform &&
      e.entityType === key.entityType &&
      e.sourceId === key.sourceId,
  );
  return !existing || !isTerminalState(existing.state);
}
