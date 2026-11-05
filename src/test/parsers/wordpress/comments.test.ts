import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../../normalizer/bundle.js";
import { validateNormalizedComment } from "../../../normalizer/validate.js";
import {
  mapWpCommentModerationStatus,
  wordpressAdapter,
} from "../../../parsers/wordpress/index.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/wordpress");

describe("mapWpCommentModerationStatus", () => {
  it("maps WordPress approved values into AIS statuses", () => {
    expect(mapWpCommentModerationStatus("1")).toEqual({ status: "approved" });
    expect(mapWpCommentModerationStatus("0")).toEqual({ status: "pending" });
    expect(mapWpCommentModerationStatus("spam")).toEqual({ status: "spam" });
    expect(mapWpCommentModerationStatus("trash")).toEqual({ status: "rejected" });
    expect(mapWpCommentModerationStatus("weird")).toEqual({ status: "pending", unknown: true });
  });
});

describe("WXR comment parse (M-engagement)", () => {
  const fixture = join(FIXTURES_ROOT, "comments-minimal.xml");

  it("emits NormalizedComment for post, page, attachment, and portfolio CPT (OSS-37)", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: fixture } }),
    );

    expect(bundleCounts(bundle).posts).toBe(1);
    expect(bundleCounts(bundle).pages).toBe(2); // about + portfolio CPT shell
    expect(bundleCounts(bundle).assets).toBe(1);
    expect(bundleCounts(bundle).comments).toBe(8); // 5 post + page + media + portfolio CPT (pingback skipped)

    // Fixture has content:encoded + empty excerpt:encoded; removeNSPrefix must not
    // String([html, ""])-join them into a trailing comma on the post body.
    const post = bundle.posts[0];
    expect(post?.contentHtml).toContain("<p>Post body</p>");
    expect(post?.contentHtml?.includes(",</body>")).toBe(false);

    const byId = new Map(bundle.comments.map((comment) => [comment.sourceId, comment]));
    expect(byId.get("101")).toMatchObject({
      type: "comment",
      target: { type: "post", sourceId: "10" },
      postSourceId: "10",
      status: "approved",
      authorType: "guest",
      authorName: "Root",
      authorEmail: "root@example.com",
      contentHtml: "Approved root",
    });
    expect(byId.get("102")).toMatchObject({
      parentSourceId: "101",
      status: "approved",
    });
    expect(byId.get("103")?.status).toBe("pending");
    expect(byId.get("104")?.status).toBe("spam");
    expect(byId.get("105")?.status).toBe("rejected");
    expect(byId.has("106")).toBe(false);

    expect(byId.get("201")).toMatchObject({
      target: { type: "page", sourceId: "20" },
      contentHtml: "Page comment",
    });
    expect(byId.get("201")?.postSourceId).toBeUndefined();

    expect(byId.get("301")).toMatchObject({
      target: { type: "media", sourceId: "30" },
      contentHtml: "Attachment comment",
    });
    expect(byId.get("301")?.postSourceId).toBeUndefined();

    expect(byId.get("401")).toMatchObject({
      target: { type: "portfolio", sourceId: "portfolio:40" },
      contentHtml: "Portfolio CPT comment",
    });
    expect(byId.get("401")?.postSourceId).toBeUndefined();

    for (const comment of bundle.comments) {
      expect(validateNormalizedComment(comment)).toEqual({ ok: true, issues: [] });
    }
  });

  it("parses the real posts export comment", async () => {
    const postsFixture = join(FIXTURES_ROOT, "naikonpixels.WordPress.Posts.2026-06-07.xml");
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: postsFixture } }),
    );

    expect(bundle.comments.length).toBeGreaterThanOrEqual(1);
    const comment = bundle.comments.find((row) => row.sourceId === "58");
    expect(comment).toMatchObject({
      target: { type: "post", sourceId: expect.any(String) },
      postSourceId: expect.any(String),
      status: "approved",
      authorType: "guest",
      authorName: "Anand",
      contentHtml: expect.stringContaining("Awesome Photos"),
    });
    expect(comment?.target.sourceId).toBe(comment?.postSourceId);
    expect(comment?.parentSourceId).toBeUndefined();
  });
});
