import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEntities, bundleCounts } from "../src/normalizer/bundle.js";
import { wixAdapter } from "../src/parsers/wix/index.js";
import { runDryRun } from "../src/sinks/dry-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "wix");

export interface WixManifestFixture {
  id: string;
  file: string;
  description: string;
  expected: {
    posts: number;
    pages: number;
    assets: number;
    categories: number;
    tags: number;
  };
  gates?: string[];
  snapshot?: {
    url: string;
    slug?: string;
    title?: string;
  };
}

interface WixManifest {
  fixtures: WixManifestFixture[];
}

export interface WixFixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

export async function validateWixFixture(entry: WixManifestFixture): Promise<WixFixtureValidationResult> {
  const errors: string[] = [];
  const filePath = join(FIXTURES_ROOT, entry.file);

  let input: unknown;
  if (entry.snapshot) {
    const html = await readFile(filePath, "utf8");
    input = {
      snapshotTargets: [
        {
          url: entry.snapshot.url,
          slug: entry.snapshot.slug,
          title: entry.snapshot.title,
          html,
        },
      ],
    };
  } else {
    input = { path: filePath };
  }

  let bundle;
  try {
    bundle = await collectEntities(wixAdapter.enumerateEntities({ input }));
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

  if (gates.includes("content_asset_discovery")) {
    if (bundle.media.length === 0) {
      errors.push("content_asset_discovery: expected NormalizedAsset rows from inline img tags");
    }
    const hasWixStatic = bundle.media.some((asset) => asset.sourceUrl.includes("wixstatic.com"));
    if (!hasWixStatic) {
      errors.push("content_asset_discovery: expected wixstatic.com asset URL");
    }
  }

  if (gates.includes("protocol_relative_images")) {
    const normalized = bundle.media.find((asset) => asset.sourceUrl.startsWith("https://static.wixstatic.com"));
    if (!normalized) {
      errors.push("protocol_relative_images: expected protocol-relative src normalized to https");
    }
  }

  if (gates.includes("w1_ricos_assets")) {
    const post = bundle.posts[0];
    if (!post?.contentHtml.includes("<img")) {
      errors.push("w1_ricos_assets: expected Ricos-derived inline image in contentHtml");
    }
    if (!bundle.media.some((asset) => asset.sourceUrl.includes("abc123~mv2.jpg"))) {
      errors.push("w1_ricos_assets: expected inline and hero assets from API export");
    }
  }

  if (gates.includes("w1_taxonomy")) {
    if (bundle.categories.length === 0 || bundle.tags.length === 0) {
      errors.push("w1_taxonomy: expected categories and tags from W1 export");
    }
  }

  if (gates.includes("w2_main_extract")) {
    const page = bundle.pages[0];
    if (!page?.contentHtml.includes("Pacific Northwest")) {
      errors.push("w2_main_extract: expected main/article content in NormalizedPage");
    }
  }

  if (gates.includes("w2_inline_assets")) {
    if (!bundle.media.some((asset) => asset.sourceUrl.includes("about-team.jpg"))) {
      errors.push("w2_inline_assets: expected inline image asset from page snapshot");
    }
  }

  if (gates.includes("rss_format")) {
    const xml = await readFile(filePath, "utf8");
    if (!xml.includes("<rss")) {
      errors.push("rss_format: expected RSS document");
    }
  }

  if (gates.includes("atom_format")) {
    const xml = await readFile(filePath, "utf8");
    if (!xml.includes("<feed")) {
      errors.push("atom_format: expected Atom document");
    }
  }

  if (gates.includes("dry_run")) {
    const dryRun = await runDryRun({
      adapter: wixAdapter,
      input,
      platform: "wix",
      offlineStorageEstimate: true,
    });
    if (dryRun.exitCode !== 0 && dryRun.exitCode !== 2) {
      errors.push(`dry_run: expected exit 0 or 2, got ${dryRun.exitCode}`);
    }
  }

  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllWixFixtures(): Promise<WixFixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WixManifest;
  const results: WixFixtureValidationResult[] = [];
  for (const entry of manifest.fixtures) {
    results.push(await validateWixFixture(entry));
  }
  return results;
}

async function main(): Promise<void> {
  const results = await validateAllWixFixtures();
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
  console.log(`All ${results.length} Wix fixture(s) passed.`);
}

const isDirectRun = process.argv[1]?.includes("validate-wix-fixtures");
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
