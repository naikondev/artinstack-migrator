import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { createWpContentGatewayRewrite } from "../../src/lib/origin-url-rewrite.js";
import { findWordPressShortcodeMarkers } from "../../src/parsers/wordpress/builders/shortcode-conflicts.js";
import { analyzeConflicts } from "../../src/sinks/conflicts.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";
import type { EntityBundle } from "../../src/normalizer/bundle.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
const PUBLIC = "https://www.naikonpixels.com";

const ALLOWED_UNRESOLVABLE_SHORTCODES = new Set(["portfolio", "recent_posts"]);
const LEGACY_LAYOUT_SHORTCODE =
  /\[(section|row|one_col|one_third|one_half|one_fourth|two_third|three_fourth)\b/i;

function pageFlattenReport(page: EntityBundle["pages"][number]) {
  const html = page.contentHtml ?? "";
  const markers = findWordPressShortcodeMarkers(html);
  return {
    slug: page.slug || `(id:${page.sourceId})`,
    sections: (html.match(/data-layout="section"/g) ?? []).length,
    rows: (html.match(/data-layout="row"/g) ?? []).length,
    columns: (html.match(/data-layout="column"/g) ?? []).length,
    colWidths: (html.match(/data-col-width=/g) ?? []).length,
    tatsuLeft: (html.match(/\[tatsu_/gi) ?? []).length,
    bloxLeft: (html.match(/\[blox_/gi) ?? []).length,
    legacyLayoutLeft: (html.match(LEGACY_LAYOUT_SHORTCODE) ?? []).length,
    gatewayUrls: (html.match(/execute-api/gi) ?? []).length,
    shortcodes: markers.map((m) => m.shortcode),
    unresolvable: markers.filter((m) => m.unresolvable).map((m) => m.shortcode),
  };
}

describe("naikonpixels pages export", () => {
  const pagesFixture = join(FIXTURES_ROOT, "naikonpixels.WordPress.Pages.2026-06-09.xml");
  const pagesInput = {
    path: pagesFixture,
    originUrlRewrite: createWpContentGatewayRewrite(GATEWAY, PUBLIC),
  };

  let bundle: EntityBundle;

  beforeAll(async () => {
    bundle = await collectEntities(wordpressAdapter.enumerateEntities({ input: pagesInput }));
  });
  it("flattens all 19 pages without leftover builder scaffolding", () => {
    expect(bundleCounts(bundle).pages).toBe(19);

    const failures: string[] = [];
    for (const page of bundle.pages) {
      const report = pageFlattenReport(page);
      if (report.tatsuLeft > 0) {
        failures.push(`${report.slug}: ${report.tatsuLeft} [tatsu_* shortcodes remain`);
      }
      if (report.bloxLeft > 0) {
        failures.push(`${report.slug}: ${report.bloxLeft} [blox_* shortcodes remain`);
      }
      if (report.legacyLayoutLeft > 0) {
        failures.push(`${report.slug}: legacy [section]/[row]/[one_*] shortcodes remain`);
      }
      for (const shortcode of report.shortcodes) {
        if (!ALLOWED_UNRESOLVABLE_SHORTCODES.has(shortcode)) {
          failures.push(`${report.slug}: unexpected shortcode [${shortcode}]`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("logs per-page flatten metrics for the fixture export", () => {
    const reports = bundle.pages
      .map(pageFlattenReport)
      .sort((a, b) => a.slug.localeCompare(b.slug));

    // Visible when running: pnpm exec vitest run fixtures/wordpress/pages-export.test.ts
    console.table(
      reports.map((r) => ({
        slug: r.slug,
        sections: r.sections,
        rows: r.rows,
        columns: r.columns,
        colWidths: r.colWidths,
        shortcodes: r.shortcodes.join(", ") || "-",
      })),
    );
    expect(reports.length).toBe(19);
  });

  it("emits structural data-layout markers on builder-heavy pages", () => {
    const reports = new Map(bundle.pages.map((p) => [p.slug, pageFlattenReport(p)]));

    const about = reports.get("about");
    expect(about?.sections).toBeGreaterThanOrEqual(4);
    expect(about?.rows).toBeGreaterThanOrEqual(3);
    expect(about?.columns).toBeGreaterThanOrEqual(5);

    const home = reports.get("naikonpixels");
    expect(home?.sections).toBeGreaterThan(0);
    expect(home?.tatsuLeft).toBe(0);

    const contact = reports.get("contact");
    expect(contact?.sections).toBeGreaterThan(0);

    const awards = reports.get("awardsandhonors");
    expect(awards?.sections).toBeGreaterThanOrEqual(0);
    expect(awards?.tatsuLeft).toBe(0);

    const toMyMother = reports.get("to-my-mother");
    expect(toMyMother?.sections).toBeGreaterThanOrEqual(1);
    expect(toMyMother?.rows).toBeGreaterThanOrEqual(2);
    expect(toMyMother?.columns).toBeGreaterThanOrEqual(3);
    expect(toMyMother?.bloxLeft).toBe(0);
  });

  it("flattens Blox prefixed layout on to-my-mother page", () => {
    const page = bundle.pages.find((p) => p.slug === "to-my-mother");
    expect(page?.contentHtml).toContain('data-layout="section"');
    expect(page?.contentHtml).toContain('data-layout="row"');
    expect(page?.contentHtml).toContain('data-layout="column"');
    expect(page?.contentHtml).toContain("dedicated to my Late Mother");
    expect(page?.contentHtml).not.toMatch(/\[blox_/);
  });

  it("flattens Tatsu structure and Oshine text on about page", () => {
    const about = bundle.pages.find((p) => p.slug === "about");
    expect(about?.contentHtml).toContain('data-layout="section"');
    expect(about?.contentHtml).toContain('data-cols="2"');
    expect(about?.contentHtml).toContain('data-cols="3"');
    expect(about?.contentHtml).toContain("<p>I am Prashant Naik.");
    expect(about?.contentHtml).not.toMatch(/\[special_sub_title|\[tatsu_/);
    expect(about?.contentHtml).toContain('data-unresolved-shortcode="blox_gmap"');
    expect(about?.contentHtml).toContain("International Dark-Sky Association");
  });

  it("reports unresolvable portfolio and recent_posts shortcodes", () => {
    const conflicts = analyzeConflicts(bundle);
    const portfolio = conflicts.unsupportedBlocks.filter((b) =>
      b.blockType.includes("portfolio"),
    );
    const recentPosts = conflicts.unsupportedBlocks.filter((b) =>
      b.blockType.includes("recent_posts"),
    );

    expect(portfolio.length).toBeGreaterThan(0);
    expect(recentPosts.length).toBeGreaterThan(0);
    expect(
      conflicts.unsupportedBlocks.some((b) => b.blockType.includes("woocommerce")),
    ).toBe(false);
  });

  it("skips WooCommerce stub pages by default", () => {
    expect(bundle.pages.some((p) => p.slug === "cart")).toBe(false);
    expect(bundle.pages.some((p) => p.slug === "checkout")).toBe(false);
    expect(bundle.pages.some((p) => p.slug === "my-account")).toBe(false);
    expect(bundleCounts(bundle).pages).toBe(19);
  });

  it("rewrites gateway asset URLs to public origin", () => {
    expect(bundle.media.some((a) => a.sourceUrl.includes("execute-api"))).toBe(false);
    expect(bundle.media.some((a) => a.sourceUrl.startsWith(`${PUBLIC}/wp-content/`))).toBe(true);
  });

  it("discovers section hero backgrounds in bundle media", () => {
    const heroAssets = [
      "About_w_2048.jpg",
      "Gear_List_w_2048.jpg",
    ];

    for (const filename of heroAssets) {
      expect(
        bundle.media.some((asset) => asset.sourceUrl.includes(filename)),
        `expected bundle media to include ${filename}`,
      ).toBe(true);
    }

    const about = bundle.pages.find((p) => p.slug === "about");
    expect(about?.contentHtml).toContain('data-bg-image="');
    expect(about?.contentHtml).toContain("About_w_2048.jpg");
  });

  it("strips animate_icon shortcodes on contact page", () => {
    const contact = bundle.pages.find((p) => p.slug === "contact");
    expect(contact?.contentHtml).toContain("2211 Lake Park Dr SE");
    expect(contact?.contentHtml).not.toMatch(/\[animate_icon/);
  });

  it("preserves awards grid inner HTML after flattening", () => {
    const awards = bundle.pages.find((p) => p.slug === "awardsandhonors");
    expect(awards?.contentHtml).toContain("<h4>Awards and Recognition</h4>");
    expect(awards?.contentHtml).toContain("International Photography Awards 2022");
    expect(awards?.contentHtml).not.toMatch(/\[grid_content|\[grids/);
  });
});
