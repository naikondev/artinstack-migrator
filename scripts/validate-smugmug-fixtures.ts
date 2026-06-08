import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEntities, bundleCounts } from "../src/normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../src/normalizer/portfolio-media.js";
import { smugmugAdapter } from "../src/parsers/smugmug/index.js";
import { runDryRun } from "../src/sinks/dry-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "smugmug");

export interface SmugMugManifestFixture {
  id: string;
  file: string;
  description: string;
  expected: {
    folders: number;
    albums: number;
    portfolios: number;
    assets: number;
  };
  gates?: string[];
  dryRunExitCode?: number;
}

interface SmugMugManifest {
  fixtures: SmugMugManifestFixture[];
}

export interface SmugMugFixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

export async function validateSmugMugFixture(
  entry: SmugMugManifestFixture,
): Promise<SmugMugFixtureValidationResult> {
  const errors: string[] = [];
  const filePath = join(FIXTURES_ROOT, entry.file);
  const input = { path: filePath };

  let bundle;
  try {
    bundle = await collectEntities(smugmugAdapter.enumerateEntities({ input }));
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const counts = bundleCounts(bundle);
  if (counts.portfolios !== entry.expected.portfolios) {
    errors.push(
      `portfolios: expected ${entry.expected.portfolios}, got ${counts.portfolios}`,
    );
  }
  if (counts.assets !== entry.expected.assets) {
    errors.push(`assets: expected ${entry.expected.assets}, got ${counts.assets}`);
  }

  const gates = entry.gates ?? [];

  if (gates.includes("portfolio_hierarchy")) {
    const parents = bundle.portfolios.filter((p) => !p.parentSourceId);
    const children = bundle.portfolios.filter((p) => p.parentSourceId);
    if (parents.length !== entry.expected.folders) {
      errors.push(`portfolio_hierarchy: expected ${entry.expected.folders} root folders`);
    }
    if (children.length !== entry.expected.albums) {
      errors.push(`portfolio_hierarchy: expected ${entry.expected.albums} child albums`);
    }
    for (const parent of parents) {
      const childCount = children.filter((c) => c.parentSourceId === parent.sourceId).length;
      if (childCount < 5) {
        errors.push(
          `portfolio_hierarchy: folder ${parent.sourceId} has ${childCount} albums, expected ≥5`,
        );
      }
    }
  }

  if (gates.includes("portfolio_media_m2m")) {
    const links = buildPortfolioMediaLinks(bundle);
    if (links.length !== bundle.media.length) {
      errors.push(
        `portfolio_media_m2m: expected ${bundle.media.length} links, got ${links.length}`,
      );
    }
    const albumIds = new Set(
      bundle.portfolios.filter((p) => p.parentSourceId).map((p) => p.sourceId),
    );
    for (const albumId of albumIds) {
      const albumLinks = links.filter((l) => l.portfolioSourceId === albumId);
      if (albumLinks.length === 0) {
        errors.push(`portfolio_media_m2m: album ${albumId} has no linked assets`);
      }
    }
  }

  if (gates.includes("exif_metadata")) {
    const withExif = bundle.media.filter(
      (a) =>
        a.exif?.iso !== undefined &&
        a.exif.aperture !== undefined &&
        a.exif.shutter !== undefined &&
        a.exif.focalLength !== undefined,
    );
    if (withExif.length !== bundle.media.length) {
      errors.push(
        `exif_metadata: ${withExif.length}/${bundle.media.length} assets have full EXIF`,
      );
    }
  }

  const dryRun = await runDryRun({
    adapter: smugmugAdapter,
    input,
    platform: "smugmug",
    offlineStorageEstimate: true,
  });

  const expectedExit = entry.dryRunExitCode ?? 0;
  if (dryRun.exitCode !== expectedExit) {
    errors.push(`dry-run exit code: expected ${expectedExit}, got ${dryRun.exitCode}`);
  }

  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllSmugMugFixtures(): Promise<SmugMugFixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SmugMugManifest;
  const results: SmugMugFixtureValidationResult[] = [];

  for (const entry of manifest.fixtures) {
    results.push(await validateSmugMugFixture(entry));
  }

  return results;
}

async function main(): Promise<void> {
  const results = await validateAllSmugMugFixtures();
  let failed = 0;

  for (const result of results) {
    if (result.ok) {
      console.log(`✓ ${result.id}`);
    } else {
      failed += 1;
      console.error(`✗ ${result.id}`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }
  }

  if (failed > 0) process.exit(1);
  console.log(`All ${results.length} SmugMug fixture(s) passed.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
