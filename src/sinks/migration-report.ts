import { randomUUID } from "node:crypto";

import type { EntityBundle } from "../normalizer/bundle.js";
import { bundleCounts } from "../normalizer/bundle.js";
import type { MigrationPlatform } from "../normalizer/types.js";
import type { ConflictReport } from "./conflicts.js";

export type MigrationRunMode = "dry-run" | "export" | "sink" | "worker";

export interface MigrationReport {
  runId: string;
  platform: MigrationPlatform;
  mode: MigrationRunMode;
  startedAt: string;
  finishedAt: string;
  summary: {
    posts: number;
    pages: number;
    assets: number;
    portfolios: number;
    categories: number;
    tags: number;
    storageBytesEstimated?: number;
  };
  warnings: string[];
  errors: string[];
  conflicts: ConflictReport;
  redirectMap: { fromPath: string; toPath: string; statusCode: number }[];
}

export function buildMigrationReport(input: {
  platform: MigrationPlatform;
  mode: MigrationRunMode;
  bundle: EntityBundle;
  conflicts: ConflictReport;
  redirectMap: { fromPath: string; toPath: string; statusCode: number }[];
  startedAt: Date;
  finishedAt?: Date;
  storageBytesEstimated?: number;
  warnings?: string[];
  errors?: string[];
  runId?: string;
}): MigrationReport {
  const counts = bundleCounts(input.bundle);
  return {
    runId: input.runId ?? randomUUID(),
    platform: input.platform,
    mode: input.mode,
    startedAt: input.startedAt.toISOString(),
    finishedAt: (input.finishedAt ?? new Date()).toISOString(),
    summary: {
      ...counts,
      storageBytesEstimated: input.storageBytesEstimated,
    },
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    conflicts: input.conflicts,
    redirectMap: input.redirectMap,
  };
}
