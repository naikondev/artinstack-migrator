import { collectEntities, type EntityBundle } from "../normalizer/bundle.js";
import type { MigrationAdapter, MigrationPlatform } from "../normalizer/types.js";
import {
  analyzeConflicts,
  buildRedirectMap,
  detectRedirectLoops,
  hasBlockingConflicts,
  hasWarnings,
  type ConflictReport,
} from "./conflicts.js";
import { buildMigrationReport, type MigrationReport } from "./migration-report.js";
import { estimateStorage, staleUrlsFromEstimate } from "./storage-estimate.js";

export interface DryRunOptions {
  adapter: MigrationAdapter;
  input: unknown;
  platform: MigrationPlatform;
  offlineStorageEstimate?: boolean;
  fetchFn?: typeof fetch;
}

export interface DryRunResult {
  bundle: EntityBundle;
  conflicts: ConflictReport;
  report: MigrationReport;
  exitCode: 0 | 1 | 2;
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunResult> {
  const startedAt = new Date();
  const bundle = await collectEntities(
    options.adapter.enumerateEntities({ input: options.input }),
  );

  const estimate = await estimateStorage({
    assets: bundle.media,
    offline: options.offlineStorageEstimate,
    fetchFn: options.fetchFn,
  });

  const redirectMap = buildRedirectMap(bundle);
  const redirectLoops = detectRedirectLoops(redirectMap);
  const staleAssetUrls = staleUrlsFromEstimate(estimate);

  const conflicts = analyzeConflicts(bundle, { staleAssetUrls, redirectLoops });

  const warnings: string[] = [];
  if (staleAssetUrls.length > 0) {
    warnings.push(`${staleAssetUrls.length} asset URL(s) unreachable; used 4 MB fallback each`);
  }
  if (conflicts.duplicatePostSlugs.length > 0) {
    warnings.push(
      `${conflicts.duplicatePostSlugs.length} duplicate post slug group(s); host may auto-suffix`,
    );
  }

  const report = buildMigrationReport({
    platform: options.platform,
    mode: "dry-run",
    bundle,
    conflicts,
    redirectMap,
    startedAt,
    storageBytesEstimated: estimate.totalBytes,
    warnings,
  });

  let exitCode: 0 | 1 | 2 = 0;
  if (hasBlockingConflicts(conflicts)) exitCode = 1;
  else if (hasWarnings(conflicts) || warnings.length > 0) exitCode = 2;

  return { bundle, conflicts, report, exitCode };
}
