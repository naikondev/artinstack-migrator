import { describe, expect, it } from "vitest";

import { shouldProcessEntity } from "./idempotency.js";
import { entityKey } from "./types.js";
import type { NormalizedPost } from "./types.js";

describe("entityKey", () => {
  it("builds a stable key from a normalized post", () => {
    const post: NormalizedPost = {
      type: "post",
      source: { platform: "wordpress", id: "wp-42" },
      sourceId: "wp-42",
      title: "Hello",
      slug: "hello",
      contentHtml: "<p>Hi</p>",
      status: "published",
    };

    expect(entityKey(post, "wordpress")).toEqual({
      platform: "wordpress",
      entityType: "post",
      sourceId: "wp-42",
    });
  });
});

describe("shouldProcessEntity", () => {
  it("skips entities already marked done", () => {
    const key = { platform: "wordpress" as const, entityType: "post" as const, sourceId: "1" };
    expect(
      shouldProcessEntity(key, [{ ...key, state: "done" }]),
    ).toBe(false);
  });
});
