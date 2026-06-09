import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { htmlToTiptap } from "../../src/transformers/html-to-tiptap/index.js";
import {
  validateAllTiptapFixtures,
  validateTiptapFixture,
  type TiptapManifestFixture,
} from "../../scripts/validate-tiptap-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("Tiptap golden fixtures", () => {
  it("generates golden snapshots when UPDATE_TIPTAP_FIXTURES=1", async () => {
    if (process.env.UPDATE_TIPTAP_FIXTURES !== "1") return;

    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: TiptapManifestFixture[] };

    await mkdir(join(FIXTURES_ROOT, "golden"), { recursive: true });
    for (const entry of manifest.fixtures) {
      const html = await readFile(join(FIXTURES_ROOT, entry.html), "utf8");
      const doc = htmlToTiptap(html, entry.options);
      await writeFile(
        join(FIXTURES_ROOT, entry.golden),
        `${JSON.stringify(doc, null, 2)}\n`,
      );
    }
  });

  it("passes validate-tiptap-fixtures gate for all manifest entries", async () => {
    const results = await validateAllTiptapFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("editorial-post: composite HTML matches golden snapshot", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: TiptapManifestFixture[] };
    const entry = manifest.fixtures.find((f) => f.id === "editorial-post");
    expect(entry).toBeDefined();

    const result = await validateTiptapFixture(entry as TiptapManifestFixture);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("regenerates deterministically from html inputs", async () => {
    const html = await readFile(join(FIXTURES_ROOT, "html/inline-text.html"), "utf8");
    const golden = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "golden/inline-text.snapshot.json"), "utf8"),
    );

    expect(htmlToTiptap(html)).toEqual(golden);
  });
});
