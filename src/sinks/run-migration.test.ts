import { describe, expect, it, vi } from "vitest";

import type { EntityBundle } from "../normalizer/bundle.js";
import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedPage,
  NormalizedPortfolio,
  NormalizedPost,
  NormalizedTag,
} from "../normalizer/types.js";
import { rewriteInlineImages } from "../transformers/rewrite-inline-images.js";
import { FilesystemMigrationSink, portfolioMediaMatchesBundle } from "./filesystem-sink.js";
import { runMigrationFromBundle } from "./run-migration.js";
import type { MigrationSink } from "./types.js";

const category: NormalizedCategory = {
  type: "category",
  source: { platform: "wordpress", id: "cat-1" },
  sourceId: "cat-1",
  name: "News",
  slug: "news",
};

const tag: NormalizedTag = {
  type: "tag",
  source: { platform: "wordpress", id: "tag-1" },
  sourceId: "tag-1",
  name: "Launch",
  slug: "launch",
};

const asset: NormalizedAsset = {
  type: "asset",
  source: { platform: "wordpress", id: "asset-1", url: "https://cdn.example/hero.jpg" },
  sourceId: "asset-1",
  sourceUrl: "https://cdn.example/hero.jpg",
  filename: "hero.jpg",
  portfolioSourceId: "portfolio-1",
  sort: 0,
};

const portfolio: NormalizedPortfolio = {
  type: "portfolio",
  source: { platform: "smugmug", id: "portfolio-1" },
  sourceId: "portfolio-1",
  title: "Gallery",
  slug: "gallery",
};

const post: NormalizedPost = {
  type: "post",
  source: { platform: "wordpress", id: "post-1", path: "/2024/hello/" },
  sourceId: "post-1",
  title: "Hello",
  slug: "hello",
  contentHtml: '<p>Hi</p><img src="https://cdn.example/hero.jpg" />',
  status: "published",
};

const page: NormalizedPage = {
  type: "page",
  source: { platform: "wordpress", id: "page-1", path: "/about/" },
  sourceId: "page-1",
  title: "About",
  slug: "about",
  contentHtml: "<p>About us</p>",
  status: "published",
};

function shuffledBundle(): EntityBundle {
  return {
    posts: [post],
    pages: [page],
    media: [asset],
    portfolios: [portfolio],
    categories: [category],
    tags: [tag],
  };
}

describe("rewriteInlineImages", () => {
  it("rewrites img src using uploaded asset map", () => {
    const uploaded = new Map([
      ["asset-1", { targetId: "asset-1", publicUrl: "https://target.example/media/hero.jpg" }],
    ]);
    const result = rewriteInlineImages(
      post.contentHtml,
      {
        resolveAsset: (src) =>
          src.includes("hero.jpg") ? { originalSrc: src, sourceAssetId: "asset-1" } : undefined,
        replaceWith: (_ref, uploadedAsset) => uploadedAsset.publicUrl ?? uploadedAsset.targetId,
      },
      uploaded,
    );

    expect(result.html).toContain("https://target.example/media/hero.jpg");
    expect(result.unresolved).toEqual([]);
  });
});

describe("runMigration canonical write order", () => {
  it("dispatches taxonomy → assets → portfolios → content → bindings → redirects", async () => {
    const calls: string[] = [];
    const sink: MigrationSink = {
      createCategory: vi.fn(async () => {
        calls.push("category");
        return { targetId: "cat-1" };
      }),
      createTag: vi.fn(async () => {
        calls.push("tag");
        return { targetId: "tag-1" };
      }),
      uploadAsset: vi.fn(async () => {
        calls.push("asset");
        return { targetId: "asset-1", publicUrl: "https://cdn.example/hero.jpg" };
      }),
      createPortfolio: vi.fn(async () => {
        calls.push("portfolio");
        return { targetId: "portfolio-1" };
      }),
      createPost: vi.fn(async () => {
        calls.push("post");
        return { targetId: "post-1", publicPath: "/blog/hello" };
      }),
      createPage: vi.fn(async () => {
        calls.push("page");
        return { targetId: "page-1", publicPath: "/about" };
      }),
      linkPortfolioMedia: vi.fn(async () => {
        calls.push("binding");
      }),
      writeRedirect: vi.fn(async () => {
        calls.push("redirect");
      }),
    };

    await runMigrationFromBundle(shuffledBundle(), {
      sink,
      platform: "wordpress",
      entities: (async function* empty() {})(),
      rewriteInlineImages: {
        resolveAsset: (src) =>
          src.includes("hero.jpg") ? { originalSrc: src, sourceAssetId: "asset-1" } : undefined,
        replaceWith: (_ref, uploaded) => uploaded.publicUrl ?? uploaded.targetId,
      },
    });

    expect(calls.indexOf("category")).toBeLessThan(calls.indexOf("asset"));
    expect(calls.indexOf("tag")).toBeLessThan(calls.indexOf("asset"));
    expect(calls.indexOf("asset")).toBeLessThan(calls.indexOf("portfolio"));
    expect(calls.indexOf("portfolio")).toBeLessThan(calls.indexOf("post"));
    expect(calls.indexOf("post")).toBeLessThan(calls.indexOf("binding"));
    expect(calls.indexOf("page")).toBeLessThan(calls.indexOf("binding"));
    expect(calls.indexOf("binding")).toBeLessThan(calls.indexOf("redirect"));
    expect(sink.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHtml: expect.stringContaining("https://cdn.example/hero.jpg"),
      }),
    );
  });

  it("filesystem sink output matches bundle-derived M2M links", async () => {
    const sink = new FilesystemMigrationSink();
    await runMigrationFromBundle(shuffledBundle(), {
      sink,
      platform: "wordpress",
      entities: (async function* empty() {})(),
    });

    expect(sink.bundle.posts).toHaveLength(1);
    expect(sink.bundle.pages).toHaveLength(1);
    expect(sink.bundle.media).toHaveLength(1);
    expect(sink.bundle.portfolios).toHaveLength(1);
    expect(sink.bundle.categories).toHaveLength(1);
    expect(sink.bundle.tags).toHaveLength(1);
    expect(sink.redirects.length).toBeGreaterThan(0);
    expect(portfolioMediaMatchesBundle(sink)).toBe(true);
  });
});
