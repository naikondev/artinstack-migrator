import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { wixAdapter } from "../../src/parsers/wix/index.js";
import { detectWixFeedFormat } from "../../src/parsers/wix/parse-export.js";
import {
  validateAllWixFixtures,
  validateWixFixture,
  type WixManifestFixture,
} from "../../scripts/validate-wix-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("Wix fixtures", () => {
  it("passes validate-wix-fixtures gate for all manifest entries", async () => {
    const results = await validateAllWixFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("studio-blog-export: discovers assets from contentHtml not XML enclosures", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: WixManifestFixture[] };
    const entry = manifest.fixtures.find((f) => f.id === "studio-blog-export");
    expect(entry).toBeDefined();

    const result = await validateWixFixture(entry as WixManifestFixture);
    expect(result.ok, result.errors.join("; ")).toBe(true);

    const bundle = await collectEntities(
      wixAdapter.enumerateEntities({ input: { path: join(FIXTURES_ROOT, entry!.file) } }),
    );

    expect(bundleCounts(bundle)).toMatchObject({
      posts: 2,
      assets: 1,
      categories: 1,
      tags: 1,
    });
    expect(bundle.posts[0]?.contentHtml).toContain("wixstatic.com");
    expect(bundle.media[0]?.sourceUrl).toContain("abc123~mv2.jpg");
  });

  it("detects RSS vs Atom feed formats", async () => {
    const rss = await readFile(join(FIXTURES_ROOT, "studio-blog-export.xml"), "utf8");
    const atom = await readFile(join(FIXTURES_ROOT, "legacy-atom-feed.xml"), "utf8");
    expect(detectWixFeedFormat(rss)).toBe("rss");
    expect(detectWixFeedFormat(atom)).toBe("atom");
  });
});
