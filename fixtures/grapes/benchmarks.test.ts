import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { htmlToGrapes } from "../../src/transformers/html-to-grapes/index.js";
import {
  validateAllGrapesFixtures,
  validateGrapesFixture,
  type GrapesManifestFixture,
} from "../../scripts/validate-grapes-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("Grapes golden fixtures", () => {
  it("passes validate-grapes-fixtures gate for all manifest entries", async () => {
    const results = await validateAllGrapesFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("editorial-page: composite HTML matches golden snapshot", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: GrapesManifestFixture[] };
    const entry = manifest.fixtures.find((f) => f.id === "editorial-page");
    expect(entry).toBeDefined();

    const result = await validateGrapesFixture(entry as GrapesManifestFixture);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("regenerates deterministically from html inputs", async () => {
    const html = await readFile(join(FIXTURES_ROOT, "html/inline-text.html"), "utf8");
    const golden = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "golden/inline-text.snapshot.json"), "utf8"),
    );

    expect(htmlToGrapes(html)).toEqual(golden);
  });
});
