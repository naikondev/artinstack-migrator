import { describe, expect, it } from "vitest";

import {
  validateNormalizedComment,
  validateNormalizedEntity,
  validateNormalizedPage,
  validateNormalizedPost,
} from "../../normalizer/validate.js";

const validPost = {
  type: "post",
  source: { platform: "wordpress", id: "post-1" },
  sourceId: "post-1",
  title: "Hello",
  slug: "hello",
  contentHtml: "<p>Hi</p>",
  status: "published",
} as const;

const validPage = {
  type: "page",
  source: { platform: "wordpress", id: "page-1" },
  sourceId: "page-1",
  title: "About",
  slug: "about",
  contentHtml: "<p>About</p>",
  status: "published",
} as const;

describe("validateNormalizedPost", () => {
  it("accepts a structurally valid post", () => {
    expect(validateNormalizedPost(validPost)).toEqual({ ok: true, issues: [] });
  });

  it("rejects missing slug", () => {
    const result = validateNormalizedPost({ ...validPost, slug: "" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path?.includes("slug"))).toBe(true);
  });

  it("rejects invalid publish status", () => {
    const result = validateNormalizedPost({ ...validPost, status: "live" });
    expect(result.ok).toBe(false);
  });
});

describe("validateNormalizedPage", () => {
  it("accepts a structurally valid page", () => {
    expect(validateNormalizedPage(validPage)).toEqual({ ok: true, issues: [] });
  });

  it("rejects non-string contentHtml", () => {
    const result = validateNormalizedPage({ ...validPage, contentHtml: 42 });
    expect(result.ok).toBe(false);
  });
});

const validComment = {
  type: "comment",
  source: { platform: "wordpress", id: "c-1" },
  sourceId: "c-1",
  postSourceId: "post-1",
  contentHtml: "Hello",
  status: "approved",
  authorType: "guest",
  authorName: "Ada",
} as const;

describe("validateNormalizedComment", () => {
  it("accepts a structurally valid comment", () => {
    expect(validateNormalizedComment(validComment)).toEqual({ ok: true, issues: [] });
  });

  it("rejects member authorType", () => {
    const result = validateNormalizedComment({ ...validComment, authorType: "member" });
    expect(result.ok).toBe(false);
  });
});

describe("validateNormalizedEntity", () => {
  it("accepts known entity types and rejects unknown discriminants", () => {
    expect(validateNormalizedEntity(validPost).ok).toBe(true);
    expect(validateNormalizedEntity(validPage).ok).toBe(true);
    expect(validateNormalizedEntity(validComment).ok).toBe(true);
    expect(validateNormalizedEntity({ type: "portfolio" }).ok).toBe(false);
  });
});
