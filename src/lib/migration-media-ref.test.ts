import { describe, expect, it } from "vitest";

import {
  formatMigrationMediaRef,
  isMigrationMediaRef,
  parseMigrationMediaRef,
} from "./migration-media-ref.js";

describe("migration media refs", () => {
  it("round-trips a normal attachment source id", () => {
    const ref = formatMigrationMediaRef("4507");
    expect(ref).toBe("artinstack-migration://asset/4507");
    expect(isMigrationMediaRef(ref)).toBe(true);
    expect(parseMigrationMediaRef(ref)).toBe("4507");
  });

  it("percent-encodes inline url source ids", () => {
    const sourceId = "url:https://www.naikonpixels.com/wp-content/uploads/About_w_2048.jpg";
    const ref = formatMigrationMediaRef(sourceId);
    expect(parseMigrationMediaRef(ref)).toBe(sourceId);
  });

  it("rejects non-ref strings", () => {
    expect(parseMigrationMediaRef("https://example.com/a.jpg")).toBeUndefined();
    expect(isMigrationMediaRef("https://example.com/a.jpg")).toBe(false);
  });
});
