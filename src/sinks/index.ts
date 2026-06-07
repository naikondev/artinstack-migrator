export type { MigrationSink, MigrationRunOptions, MigrationRunResult } from "./types.js";
export { runMigration } from "./run-migration.js";
export { runDryRun, type DryRunResult, type DryRunOptions } from "./dry-run.js";
export {
  analyzeConflicts,
  buildRedirectMap,
  detectRedirectLoops,
  hasBlockingConflicts,
  hasWarnings,
  emptyConflictReport,
  type ConflictReport,
} from "./conflicts.js";
export { buildMigrationReport, type MigrationReport, type MigrationRunMode } from "./migration-report.js";
export {
  writeFilesystemExport,
  bundleToCombinedJson,
  type WriteFilesystemOptions,
} from "./filesystem.js";
export {
  estimateStorage,
  staleUrlsFromEstimate,
  FALLBACK_ASSET_BYTES,
  type StorageEstimate,
} from "./storage-estimate.js";
