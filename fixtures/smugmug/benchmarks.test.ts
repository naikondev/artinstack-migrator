import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../../src/normalizer/portfolio-media.js";
import { smugmugAdapter } from "../../src/parsers/smugmug/index.js";
import {
  validateAllSmugMugFixtures,
  validateSmugMugFixture,
  type SmugMugManifestFixture,
} from "../../scripts/validate-smugmug-fixtures.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

describe("M0b SmugMug benchmark fixtures", () => {
  it("passes validate-fixtures gate for all manifest entries", async () => {
    const results = await validateAllSmugMugFixtures();
    expect(results.every((r) => r.ok), JSON.stringify(results, null, 2)).toBe(true);
  });

  it("portfolio-vault: hierarchy, M2M links, and EXIF", async () => {
    const bundle = await collectEntities(
      smugmugAdapter.enumerateEntities({
        input: { path: join(FIXTURES_ROOT, "portfolio-vault.json") },
      }),
    );

    expect(bundleCounts(bundle)).toMatchObject({
      portfolios: 18,
      assets: 45,
    });

    const roots = bundle.portfolios.filter((p) => !p.parentSourceId);
    expect(roots).toHaveLength(3);
    expect(bundle.portfolios.filter((p) => p.parentSourceId)).toHaveLength(15);

    const links = buildPortfolioMediaLinks(bundle);
    expect(links).toHaveLength(45);
    expect(links.every((l) => l.portfolioSourceId.startsWith("album-"))).toBe(true);

    const sample = bundle.media[0];
    expect(sample?.exif?.iso).toBeTypeOf("number");
    expect(sample?.exif?.aperture).toBeTypeOf("number");
    expect(sample?.exif?.shutter).toBeTypeOf("string");
    expect(sample?.exif?.focalLength).toBeTypeOf("number");
    expect(sample?.portfolioSourceId).toBeTruthy();
  });

  it("portfolio-vault: manifest gate", async () => {
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
    ) as { fixtures: SmugMugManifestFixture[] };
    const entry = manifest.fixtures.find((f) => f.id === "portfolio-vault");
    expect(entry).toBeDefined();

    const result = await validateSmugMugFixture(entry as SmugMugManifestFixture);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});
