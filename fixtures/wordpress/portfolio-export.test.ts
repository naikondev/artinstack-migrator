import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { createWpContentGatewayRewrite } from "../../src/lib/media-urls.js";
import { analyzeConflicts } from "../../src/sinks/conflicts.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";
import type { EntityBundle } from "../../src/normalizer/bundle.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
const PUBLIC = "https://www.naikonpixels.com";

const LEGACY_LAYOUT_SHORTCODE =
  /\[(section|row|one_col|one_third|one_half|one_fourth|two_third|three_fourth)\b/i;

function pageFlattenReport(page: EntityBundle["pages"][number]) {
  const html = page.contentHtml ?? "";
  return {
    slug: page.slug || `(id:${page.sourceId})`,
    sections: (html.match(/data-layout="section"/g) ?? []).length,
    tatsuLeft: (html.match(/\[tatsu_/gi) ?? []).length,
    bloxLeft: (html.match(/\[blox_/gi) ?? []).length,
    legacyLayoutLeft: (html.match(LEGACY_LAYOUT_SHORTCODE) ?? []).length,
  };
}

describe("naikonpixels portfolio export (OSS-18)", () => {
  const portfolioFixture = join(
    FIXTURES_ROOT,
    "naikonpixels.WordPress.Portfolio.2026-06-11.xml",
  );
  const portfolioInput = {
    path: portfolioFixture,
    originUrlRewrite: createWpContentGatewayRewrite(GATEWAY, PUBLIC),
  };

  let bundle: EntityBundle;

  beforeAll(async () => {
    bundle = await collectEntities(wordpressAdapter.enumerateEntities({ input: portfolioInput }));
  });

  it("emits all portfolio CPT items as pages with portfolio:{id} sourceIds", () => {
    expect(bundleCounts(bundle).pages).toBe(21);
    expect(bundleCounts(bundle).portfolios).toBe(0);
    expect(bundleCounts(bundle).posts).toBe(0);

    for (const page of bundle.pages) {
      expect(page.sourceId).toMatch(/^portfolio:\d+$/);
      expect(page.source.id).toBe(page.sourceId);
      expect(page.source.postType).toBe("portfolio");
    }
  });

  it("flattens Tatsu/Blox layout scaffolding on portfolio singles", () => {
    const failures: string[] = [];
    let withSections = 0;
    for (const page of bundle.pages) {
      const report = pageFlattenReport(page);
      if (report.sections > 0) withSections++;
      if (report.tatsuLeft > 0) {
        failures.push(`${report.slug}: ${report.tatsuLeft} [tatsu_* shortcodes remain`);
      }
      if (report.bloxLeft > 0) {
        failures.push(`${report.slug}: ${report.bloxLeft} [blox_* shortcodes remain`);
      }
      if (report.legacyLayoutLeft > 0) {
        failures.push(`${report.slug}: legacy layout shortcodes remain`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
    expect(withSections).toBeGreaterThan(0);
  });

  it("includes draft portfolio items (export is draft-heavy)", () => {
    const drafts = bundle.pages.filter((p) => p.status === "draft");
    expect(drafts.length).toBeGreaterThan(0);
  });

  it("reports attachment discovery vs resolution (no attachment rows in export)", () => {
    const conflicts = analyzeConflicts(bundle);
    const { assetDiscovery } = conflicts;

    expect(assetDiscovery.attachmentRefs).toBeGreaterThan(300);
    expect(assetDiscovery.attachmentRefsResolved).toBe(0);
    expect(assetDiscovery.attachmentRefsUnresolved).toBe(assetDiscovery.attachmentRefs);
    expect(bundleCounts(bundle).assets).toBeLessThan(10);

    for (const page of bundle.pages) {
      expect(page.contentHtml ?? "").not.toMatch(/\[oshine_gallery\b/i);
    }
  });
});
