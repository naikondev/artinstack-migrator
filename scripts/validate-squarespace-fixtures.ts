import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEntities, bundleCounts } from "../src/normalizer/bundle.js";
import { squarespaceAdapter } from "../src/parsers/squarespace/index.js";
import { analyzeConflicts } from "../src/sinks/conflicts.js";
import { runDryRun } from "../src/sinks/dry-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "squarespace");

export interface SquarespaceManifestFixture {
  id: string;
  file: string;
  description: string;
  expected: {
    pages: number;
    posts: number;
    categories: number;
    tags: number;
    assets: number;
    portfolios?: number;
  };
  gates?: string[];
  dryRunExitCode?: number;
}

interface SquarespaceManifest {
  fixtures: SquarespaceManifestFixture[];
}

export interface SquarespaceFixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

export async function validateSquarespaceFixture(
  entry: SquarespaceManifestFixture,
): Promise<SquarespaceFixtureValidationResult> {
  const errors: string[] = [];
  const filePath = join(FIXTURES_ROOT, entry.file);
  const input = { path: filePath };

  let bundle;
  try {
    bundle = await collectEntities(squarespaceAdapter.enumerateEntities({ input }));
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const counts = bundleCounts(bundle);
  for (const [key, expected] of Object.entries(entry.expected)) {
    const actual = counts[key as keyof typeof counts];
    if (actual !== expected) {
      errors.push(`count mismatch ${key}: expected ${expected}, got ${actual}`);
    }
  }

  const gates = entry.gates ?? [];

  if (gates.includes("block_flattening")) {
    const home = bundle.pages.find((p) => p.sourceId === "page-home");
    if (!home?.contentHtml.includes("sqs-block-html")) {
      errors.push("block_flattening: home page missing flattened html block wrapper");
    }
    if (!home?.contentHtml.includes("<h1>Creative Studio</h1>")) {
      errors.push("block_flattening: home hero text not preserved");
    }
    const about = bundle.pages.find((p) => p.sourceId === "page-about");
    if (!about?.contentHtml.includes("sqs-block-button")) {
      errors.push("block_flattening: about page missing button block");
    }
  }

  if (gates.includes("unsupported_blocks")) {
    const conflicts = analyzeConflicts(bundle);
    if (conflicts.unsupportedBlocks.length < 3) {
      errors.push(
        `unsupported_blocks: expected ≥3 unsupported block flags, got ${conflicts.unsupportedBlocks.length}`,
      );
    }
    const types = new Set(conflicts.unsupportedBlocks.map((b) => b.blockType));
    if (!types.has("product") || !types.has("form")) {
      errors.push("unsupported_blocks: missing product or form block flags");
    }
  }

  if (gates.includes("gallery_portfolios")) {
    if (bundle.portfolios.length < 1) {
      errors.push(
        "gallery_portfolios: expected at least one portfolio from gallery blocks or collections",
      );
    }
    const linked = bundle.media.filter((asset) => asset.portfolioSourceId);
    if (linked.length < 1) {
      errors.push("gallery_portfolios: expected gallery assets with portfolioSourceId");
    }
    const missingSort = linked.some((asset) => asset.sort === undefined);
    if (missingSort) {
      errors.push("gallery_portfolios: gallery assets must include sort order");
    }
    const hasBlock = bundle.portfolios.some((p) => p.sourceId.startsWith("gallery:"));
    const hasCollection = bundle.portfolios.some((p) =>
      p.sourceId.startsWith("gallery-collection:"),
    );
    if (!hasBlock || !hasCollection) {
      errors.push(
        "gallery_portfolios: expected both gallery block (`gallery:…`) and collection (`gallery-collection:…`) portfolios",
      );
    }
  }

  if (entry.dryRunExitCode !== undefined) {
    const dryRun = await runDryRun({
      adapter: squarespaceAdapter,
      input,
      platform: "squarespace",
      offlineStorageEstimate: true,
    });
    if (dryRun.exitCode !== entry.dryRunExitCode) {
      errors.push(`dryRunExitCode: expected ${entry.dryRunExitCode}, got ${dryRun.exitCode}`);
    }
  }

  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllSquarespaceFixtures(): Promise<SquarespaceFixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SquarespaceManifest;
  const results: SquarespaceFixtureValidationResult[] = [];
  for (const entry of manifest.fixtures) {
    results.push(await validateSquarespaceFixture(entry));
  }
  return results;
}

async function main(): Promise<void> {
  const results = await validateAllSquarespaceFixtures();
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`FAIL ${result.id}:`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }
    process.exit(1);
  }
  console.log(`All ${results.length} Squarespace fixture(s) passed.`);
}

const isDirectRun = process.argv[1]?.includes("validate-squarespace-fixtures");
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
