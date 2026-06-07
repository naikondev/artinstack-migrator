import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEntities, bundleCounts } from "../src/normalizer/bundle.js";
import { wordpressAdapter } from "../src/parsers/wordpress/index.js";
import { runDryRun } from "../src/sinks/dry-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "wordpress");

interface ManifestFixture {
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
  dryRunExitCode?: number;
}

interface Manifest {
  fixtures: ManifestFixture[];
}

export interface FixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

function mockDeadHeadFetch(): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    return new Response(null, {
      status: url.includes("dead-cdn.example.com") ? 404 : 200,
      headers: { "content-length": "1024" },
    });
  };
}

export async function validateFixture(entry: ManifestFixture): Promise<FixtureValidationResult> {
  const errors: string[] = [];
  const filePath = join(FIXTURES_ROOT, entry.file);
  const input = { path: filePath };

  let bundle;
  try {
    bundle = await collectEntities(wordpressAdapter.enumerateEntities({ input }));
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

  if (gates.includes("dated_permalinks")) {
    const dated = bundle.posts.filter((p) => p.source.path?.match(/\/\d{4}\//));
    if (dated.length === 0) {
      errors.push("dated_permalinks: no post has dated source.path");
    }
  }

  if (gates.includes("taxonomy")) {
    const withTaxonomy = bundle.posts.filter(
      (p) => (p.categorySlugs?.length ?? 0) > 0 || (p.tagSlugs?.length ?? 0) > 0,
    );
    if (withTaxonomy.length === 0) {
      errors.push("taxonomy: no post has category or tag slugs");
    }
    if (bundle.categories.length === 0 || bundle.tags.length === 0) {
      errors.push("taxonomy: categories.json or tags.json would be empty");
    }
  }

  if (gates.includes("is_home_page")) {
    const home = bundle.pages.find((p) => p.isHomePage);
    if (!home) {
      errors.push("is_home_page: no page marked as home");
    }
  }

  if (gates.includes("inline_images")) {
    const withImages = bundle.posts.filter((p) => /<img\b/i.test(p.contentHtml));
    if (withImages.length === 0) {
      errors.push("inline_images: no post contains img tags");
    }
    if (bundle.media.length === 0) {
      errors.push("inline_images: no assets emitted");
    }
  }

  if (gates.includes("duplicate_slugs") || entry.id === "long-form-journal") {
    const slugGroups = new Map<string, number>();
    for (const post of bundle.posts) {
      slugGroups.set(post.slug, (slugGroups.get(post.slug) ?? 0) + 1);
    }
    const dupes = [...slugGroups.entries()].filter(([, n]) => n > 1);
    if (dupes.length === 0) {
      errors.push("duplicate_slugs: expected duplicate post slug group");
    }
  }

  const dryRun = await runDryRun({
    adapter: wordpressAdapter,
    input,
    platform: "wordpress",
    offlineStorageEstimate: entry.id !== "stale-legacy-void",
    fetchFn: entry.id === "stale-legacy-void" ? mockDeadHeadFetch() : undefined,
  });

  const expectedExit = entry.dryRunExitCode ?? 0;
  if (dryRun.exitCode !== expectedExit) {
    errors.push(`dry-run exit code: expected ${expectedExit}, got ${dryRun.exitCode}`);
  }

  if (gates.includes("malformed_html")) {
    if (dryRun.conflicts.invalidHtml.length === 0) {
      errors.push("malformed_html: expected invalidHtml conflicts");
    }
    const raw = bundle.posts.find((p) => p.sourceId === "1")?.contentHtml ?? "";
    if (!raw.includes("<script>")) {
      errors.push("malformed_html: raw contentHtml should preserve script tag");
    }
  }

  if (gates.includes("stale_urls")) {
    if (dryRun.conflicts.staleAssetUrls.length === 0) {
      errors.push("stale_urls: expected stale asset URL conflicts");
    }
    const fallbackOnly = dryRun.report.summary.storageBytesEstimated === 2 * 4 * 1024 * 1024;
    if (!fallbackOnly) {
      errors.push(
        `stale_urls: expected 8 MB storage estimate (2 × 4 MB fallback), got ${dryRun.report.summary.storageBytesEstimated}`,
      );
    }
  }

  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllFixtures(): Promise<FixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const results: FixtureValidationResult[] = [];

  for (const entry of manifest.fixtures) {
    results.push(await validateFixture(entry));
  }

  return results;
}

async function main(): Promise<void> {
  const results = await validateAllFixtures();
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

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`All ${results.length} fixture(s) passed.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
