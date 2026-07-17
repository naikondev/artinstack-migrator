import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../../src/normalizer/portfolio-media.js";
import { squarespaceAdapter } from "../../src/parsers/squarespace/index.js";
import {
  flattenSquarespaceBlock,
  flattenSquarespaceBlocks,
} from "../../src/parsers/squarespace/parse-export.js";
import { analyzeConflicts } from "../../src/sinks/conflicts.js";
import {
  validateAllSquarespaceFixtures,
  validateSquarespaceFixture,
  type SquarespaceManifestFixture,
} from "../../scripts/validate-squarespace-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("parse-export (block flattening)", () => {
  it("flattens supported blocks and flags product blocks", () => {
    const result = flattenSquarespaceBlocks([
      { id: "b1", type: "html", html: "<p>Hello</p>" },
      { id: "b2", type: "image", imageUrl: "https://cdn.example/photo.jpg", altText: "Photo" },
      { id: "b3", type: "product", value: "Shop" },
    ]);

    expect(result.contentHtml).toContain("sqs-block-html");
    expect(result.contentHtml).toContain("photo.jpg");
    expect(result.contentHtml).toContain('data-artinstack-unsupported-block="product"');
    expect(result.assetUrls).toEqual(["https://cdn.example/photo.jpg"]);
  });

  it("marks unknown block types as unsupported", () => {
    const { contentHtml } = flattenSquarespaceBlock({ type: "future-widget", id: "x1" });
    expect(contentHtml).toContain('data-artinstack-unsupported-block="future-widget"');
  });
});

describe("M0c Squarespace benchmark fixtures", () => {
  it("passes validate-fixtures gate for all manifest entries", async () => {
    const results = await validateAllSquarespaceFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("creative-studio-site: pages, posts, gallery portfolios, assets, unsupported blocks", async () => {
    const bundle = await collectEntities(
      squarespaceAdapter.enumerateEntities({
        input: { path: join(FIXTURES_ROOT, "creative-studio-site.json") },
      }),
    );

    expect(bundleCounts(bundle)).toMatchObject({
      pages: 2,
      posts: 2,
      categories: 2,
      tags: 2,
      assets: 8,
      portfolios: 2,
    });

    const home = bundle.pages.find((p) => p.isHomePage);
    expect(home?.contentCss).toContain(".sqs-block");

    const post = bundle.posts.find((p) => p.sourceId === "post-desert-light");
    expect(post?.featuredAssetSourceId).toBe("featured-post-desert-light");
    expect(post?.categorySlugs).toContain("travel");
    expect(post?.contentHtml).toContain("sqs-gallery");

    expect(bundle.portfolios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "gallery:block-post-gallery",
          title: "Desert Light Study",
        }),
        expect.objectContaining({
          sourceId: "gallery-collection:col-selected-works",
          title: "Selected Works",
          slug: "gallery-selected-works",
        }),
      ]),
    );

    const links = buildPortfolioMediaLinks(bundle);
    expect(links).toEqual([
      { portfolioSourceId: "gallery-collection:col-selected-works", assetSourceId: "sw-1", sort: 0 },
      { portfolioSourceId: "gallery-collection:col-selected-works", assetSourceId: "sw-2", sort: 1 },
      { portfolioSourceId: "gallery-collection:col-selected-works", assetSourceId: "sw-3", sort: 2 },
      { portfolioSourceId: "gallery:block-post-gallery", assetSourceId: "gal-1", sort: 0 },
      { portfolioSourceId: "gallery:block-post-gallery", assetSourceId: "gal-2", sort: 1 },
    ]);

    const conflicts = analyzeConflicts(bundle);
    expect(conflicts.unsupportedBlocks.some((b) => b.blockType === "product")).toBe(true);
    expect(conflicts.unsupportedBlocks.some((b) => b.blockType === "form")).toBe(true);
  });

  it("creative-studio-site: manifest gate", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: SquarespaceManifestFixture[] };
    const entry = manifest.fixtures.find((f) => f.id === "creative-studio-site");
    expect(entry).toBeDefined();

    const result = await validateSquarespaceFixture(entry as SquarespaceManifestFixture);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});
