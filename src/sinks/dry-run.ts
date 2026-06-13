import { collectEntities, type EntityBundle } from "../normalizer/bundle.js";
import type { MigrationAdapter, MigrationPlatform, WxrImportSummary } from "../normalizer/types.js";
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

export async function resolveAdapterImportSummary(
  adapter: MigrationAdapter,
  input: unknown,
): Promise<WxrImportSummary | undefined> {
  if (!adapter.getImportSummary) return undefined;
  return adapter.getImportSummary(input);
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunResult> {
  const startedAt = new Date();
  const wxrImportSummary = await resolveAdapterImportSummary(options.adapter, options.input);
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

  const conflicts = analyzeConflicts(bundle, {
    staleAssetUrls,
    redirectLoops,
    wxrImportSummary,
  });

  const warnings: string[] = [];
  if (staleAssetUrls.length > 0) {
    warnings.push(`${staleAssetUrls.length} asset URL(s) unreachable; used 4 MB fallback each`);
  }
  if (wxrImportSummary?.unsupportedOnly) {
    warnings.push(
      "Export contains no importable content; see conflicts.skippedPostTypes for omitted post_type counts",
    );
  }
  const { assetDiscovery } = conflicts;
  if (assetDiscovery.attachmentRefsUnresolved > 0) {
    warnings.push(
      `${assetDiscovery.attachmentRefsUnresolved} attachment ref(s) lack URLs in this export ` +
        `(${assetDiscovery.attachmentRefsResolved}/${assetDiscovery.attachmentRefs} resolved; ` +
        "include attachment rows, a media export, or REST resolution)",
    );
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
