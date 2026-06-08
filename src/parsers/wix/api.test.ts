import { describe, expect, it } from "vitest";

import { mergeWixWireFixtures } from "./api.js";
import { mapWireListPostsResponse } from "./map-wire.js";
import wire from "../../../fixtures/wix/wire/blog-posts-response.json";

describe("Wix W1 wire mapping", () => {
  it("maps list posts response into canonical posts with Ricos HTML", () => {
    const categories = [{ id: "cat-studio-news", name: "Studio News", slug: "studio-news" }];
    const tags = [{ id: "tag-launch", name: "Launch", slug: "launch" }];
    const lookup = {
      categorySlugsById: new Map(categories.map((c) => [c.id, c.slug])),
      tagSlugsById: new Map(tags.map((t) => [t.id, t.slug])),
    };

    const posts = mapWireListPostsResponse(wire, lookup);
    expect(posts).toHaveLength(1);
    expect(posts[0].contentHtml).toContain("<img");
    expect(posts[0].contentHtml).toContain("spring collection");
    expect(posts[0].categorySlugs).toEqual(["studio-news"]);
    expect(posts[0].tagSlugs).toEqual(["launch", "portfolio"]);
    expect(posts[0].url).toBe("https://example.wixsite.com/studio/post/spring-collection-launch");
  });

  it("merges wire fixtures into WixExport", () => {
    const doc = mergeWixWireFixtures({
      categories: { categories: (wire as { categories: unknown[] }).categories },
      tags: { tags: (wire as { tags: unknown[] }).tags },
      posts: { posts: (wire as { posts: unknown[] }).posts },
    });
    expect(doc.exportVersion).toBe(1);
    expect(doc.posts).toHaveLength(1);
    expect(doc.categories).toHaveLength(1);
    expect(doc.tags).toHaveLength(1);
  });
});
