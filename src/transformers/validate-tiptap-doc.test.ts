import { describe, expect, it } from "vitest";

import { validateTiptapDoc } from "./validate-tiptap-doc.js";

describe("validateTiptapDoc", () => {
  it("accepts a minimal valid doc", () => {
    const result = validateTiptapDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects docs missing the doc root type", () => {
    const result = validateTiptapDoc({ type: "paragraph", content: [] });
    expect(result.ok).toBe(false);
  });

  it("enforces allowedNodeTypes when provided", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };
    expect(validateTiptapDoc(doc, { allowedNodeTypes: ["doc", "paragraph", "text"] }).ok).toBe(
      true,
    );
    expect(validateTiptapDoc(doc, { allowedNodeTypes: ["doc", "paragraph"] }).ok).toBe(false);
  });
});
