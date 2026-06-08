#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { getAdapter } from "../parsers/index.js";
import type { MigrationPlatform } from "../normalizer/types.js";
import {
  analyzeConflicts,
  buildMigrationReport,
  buildRedirectMap,
  bundleToCombinedJson,
  createFilesystemMigrationSink,
  detectRedirectLoops,
  hasBlockingConflicts,
  hasWarnings,
  runDryRun,
  runMigration,
  writeFilesystemExport,
} from "../sinks/index.js";
import { collectEntities } from "../normalizer/bundle.js";
import { estimateStorage, staleUrlsFromEstimate } from "../sinks/storage-estimate.js";

const PLATFORMS: MigrationPlatform[] = ["wordpress", "smugmug", "squarespace"];
const SINKS = ["filesystem"] as const;

function printUsage(): void {
  console.log(`artinstack-migrate — platform content migration CLI

Usage:
  artinstack-migrate <platform> <export-file> [options]
  artinstack-migrate validate <platform> <export-file>

Platforms: ${PLATFORMS.join(", ")}

Options:
  --out <dir>       Write grouped JSON files to directory
  --sink <name>     Run through MigrationSink (supported: ${SINKS.join(", ")})
  --format json     Write combined JSON to stdout
  --dry-run         Parse and analyze without writing content files
  --report <dir>    With --dry-run, write conflicts.json + migration-report.json
  --offline         Skip network HEAD requests (4 MB fallback per asset)

Examples:
  artinstack-migrate wordpress export.xml --dry-run --report ./preview/
  artinstack-migrate wordpress export.xml --out ./output
  artinstack-migrate wordpress export.xml --sink filesystem --out ./output
  pnpm cli wordpress fixtures/wordpress/long-form-journal.xml --dry-run
`);
}

function printDryRunStatus(exitCode: 0 | 1 | 2, reportDir?: string): void {
  const dest = reportDir ? ` Reports written to ${reportDir}.` : "";
  if (exitCode === 0) {
    console.error(`Dry run complete.${dest}`);
  } else if (exitCode === 2) {
    console.error(`Dry run complete with warnings (exit 2).${dest}`);
  } else {
    console.error(`Dry run found blocking conflicts (exit 1).${dest}`);
  }
}

function parseArgs(argv: string[]): {
  command: string | undefined;
  platform: MigrationPlatform | undefined;
  inputPath: string | undefined;
  outDir: string | undefined;
  reportDir: string | undefined;
  sinkName: string | undefined;
  dryRun: boolean;
  formatJson: boolean;
  offline: boolean;
} {
  const args = [...argv];
  let command: string | undefined;
  let platform: MigrationPlatform | undefined;
  let inputPath: string | undefined;
  let outDir: string | undefined;
  let reportDir: string | undefined;
  let sinkName: string | undefined;
  let dryRun = false;
  let formatJson = false;
  let offline = false;

  const first = args[0];
  if (first === "validate") {
    command = "validate";
    platform = args[1] as MigrationPlatform;
    inputPath = args[2];
  } else if (first && PLATFORMS.includes(first as MigrationPlatform)) {
    command = "migrate";
    platform = first as MigrationPlatform;
    inputPath = args[1];
    for (let i = 2; i < args.length; i++) {
      const flag = args[i];
      if (flag === "--dry-run") dryRun = true;
      else if (flag === "--format" && args[i + 1] === "json") formatJson = true;
      else if (flag === "--offline") offline = true;
      else if (flag === "--out" && args[i + 1]) {
        outDir = args[++i];
      } else if (flag === "--report" && args[i + 1]) {
        reportDir = args[++i];
      } else if (flag === "--sink" && args[i + 1]) {
        sinkName = args[++i];
      }
    }
  } else {
    command = first;
  }

  return { command, platform, inputPath, outDir, reportDir, sinkName, dryRun, formatJson, offline };
}

function migrationExitCode(hasBlockers: boolean, hasWarn: boolean): 0 | 1 | 2 {
  if (hasBlockers) return 1;
  if (hasWarn) return 2;
  return 0;
}

async function main(): Promise<void> {
  const { command, platform, inputPath, outDir, reportDir, sinkName, dryRun, formatJson, offline } =
    parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "validate") {
    if (!platform || !PLATFORMS.includes(platform) || !inputPath) {
      console.error("Usage: artinstack-migrate validate <platform> <export-file>");
      process.exit(1);
    }
    const adapter = getAdapter(platform);
    const result = await adapter.validateInput({ path: inputPath });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "migrate") {
    if (!platform || !inputPath) {
      printUsage();
      process.exit(1);
    }

    if (sinkName && !SINKS.includes(sinkName as (typeof SINKS)[number])) {
      console.error(`Unknown sink: ${sinkName}. Supported: ${SINKS.join(", ")}`);
      process.exit(1);
    }

    const adapter = getAdapter(platform);
    const input = { path: inputPath };

    if (dryRun) {
      const result = await runDryRun({
        adapter,
        input,
        platform,
        offlineStorageEstimate: offline,
      });

      if (reportDir) {
        await mkdir(reportDir, { recursive: true });
        await writeFile(
          join(reportDir, "conflicts.json"),
          `${JSON.stringify(result.conflicts, null, 2)}\n`,
        );
        await writeFile(
          join(reportDir, "migration-report.json"),
          `${JSON.stringify(result.report, null, 2)}\n`,
        );
      } else {
        console.log(JSON.stringify(result.report, null, 2));
      }

      printDryRunStatus(result.exitCode, reportDir);
      process.exit(result.exitCode);
    }

    const startedAt = new Date();

    if (sinkName === "filesystem") {
      if (!outDir) {
        console.error("Filesystem sink requires --out <dir>");
        process.exit(1);
      }

      const sink = createFilesystemMigrationSink();
      const runResult = await runMigration({
        sink,
        platform,
        entities: adapter.enumerateEntities({ input }),
      });

      const bundle = sink.bundle;
      const estimate = await estimateStorage({
        assets: bundle.media,
        offline,
      });
      const redirectMap = buildRedirectMap(bundle);
      const conflicts = analyzeConflicts(bundle, {
        staleAssetUrls: staleUrlsFromEstimate(estimate),
        redirectLoops: detectRedirectLoops(redirectMap),
      });
      const report = buildMigrationReport({
        platform,
        mode: "sink",
        bundle,
        conflicts,
        redirectMap,
        startedAt,
        storageBytesEstimated: estimate.totalBytes,
        warnings:
          runResult.failed > 0
            ? [`${runResult.failed} entity write(s) failed during sink migration`]
            : [],
      });

      await sink.flush({ outDir, bundle, conflicts, report });
      console.error(`Wrote sink export to ${outDir}`);

      const exitCode = migrationExitCode(
        hasBlockingConflicts(conflicts) || runResult.failed > 0,
        hasWarnings(conflicts),
      );
      process.exit(exitCode);
    }

    const bundle = await collectEntities(adapter.enumerateEntities({ input }));

    const estimate = await estimateStorage({
      assets: bundle.media,
      offline,
    });
    const redirectMap = buildRedirectMap(bundle);
    const conflicts = analyzeConflicts(bundle, {
      staleAssetUrls: staleUrlsFromEstimate(estimate),
    });

    const report = buildMigrationReport({
      platform,
      mode: "export",
      bundle,
      conflicts,
      redirectMap,
      startedAt,
      storageBytesEstimated: estimate.totalBytes,
    });

    if (formatJson) {
      console.log(JSON.stringify({ ...bundleToCombinedJson(bundle), conflicts, report }, null, 2));
      process.exit(0);
    }

    if (!outDir) {
      console.error("Specify --out <dir>, --format json, --dry-run, or --sink filesystem --out <dir>");
      process.exit(1);
    }

    await writeFilesystemExport({
      outDir,
      bundle,
      conflicts,
      report,
    });

    console.error(`Wrote export to ${outDir}`);
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
