import { describe, expect, it } from "vitest";

import { htmlToGrapes } from "../../transformers/html-to-grapes/index.js";
import { validateGrapesProjectSnapshot } from "../../transformers/validate-snapshot.js";

describe("validateGrapesProjectSnapshot", () => {
  it("accepts output from htmlToGrapes by default", () => {
    const snapshot = htmlToGrapes("<p>Hello <strong>world</strong></p>");
    expect(validateGrapesProjectSnapshot(snapshot)).toEqual({ ok: true, issues: [] });
  });

  it("rejects malformed snapshots", () => {
    const result = validateGrapesProjectSnapshot({ content: "not-an-array", styles: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("optionally enforces allowed component types", () => {
    const snapshot = htmlToGrapes("<p>Hello</p>");
    const permissive = validateGrapesProjectSnapshot(snapshot);
    const strict = validateGrapesProjectSnapshot(snapshot, {
      allowedComponentTypes: ["image"],
    });

    expect(permissive.ok).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.issues[0]?.code).toBe("invalid_component_type");
  });
});
