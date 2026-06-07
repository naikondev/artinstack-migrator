import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";
import { validateAllFixtures, validateFixture } from "../../scripts/validate-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("M0 benchmark fixtures", () => {
  it("passes validate-fixtures gate for all manifest entries", async () => {
    const results = await validateAllFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("long-form-journal: dated paths and duplicate slugs", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({
        input: { path: join(FIXTURES_ROOT, "long-form-journal.xml") },
      }),
    );

    expect(bundleCounts(bundle)).toMatchObject({
      posts: 3,
      pages: 2,
      assets: 2,
      categories: 2,
      tags: 2,
    });

    const autumnPosts = bundle.posts.filter((p) => p.slug === "autumn-in-north-georgia");
    expect(autumnPosts).toHaveLength(2);
    expect(autumnPosts[0]?.source.path).toBe("/2018/11/04/autumn-in-north-georgia/");
    expect(autumnPosts[0]?.categorySlugs).toContain("landscape");
    expect(autumnPosts[0]?.featuredAssetSourceId).toBe("201");
  });

  it("portfolio-archive: home page and media", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({
        input: { path: join(FIXTURES_ROOT, "portfolio-archive.xml") },
      }),
    );

    const home = bundle.pages.find((p) => p.isHomePage);
    expect(home?.slug).toBe("home");
    expect(bundle.media).toHaveLength(3);
  });

  it("stale-legacy-void: preserves raw HTML and warns", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: { id: string }[] };
    const entry = manifest.fixtures.find((f) => f.id === "stale-legacy-void");
    expect(entry).toBeDefined();

    const result = await validateFixture(entry!);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});
