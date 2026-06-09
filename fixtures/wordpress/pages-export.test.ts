import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../src/normalizer/bundle.js";
import { createWpContentGatewayRewrite } from "../../src/lib/origin-url-rewrite.js";
import { analyzeConflicts } from "../../src/sinks/conflicts.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
const PUBLIC = "https://www.naikonpixels.com";

describe("naikonpixels pages export", () => {
  const pagesFixture = join(FIXTURES_ROOT, "naikonpixels.WordPress.Pages.2026-06-09.xml");
  const pagesInput = {
    path: pagesFixture,
    originUrlRewrite: createWpContentGatewayRewrite(GATEWAY, PUBLIC),
  };
  it("flattens Oshine text shortcodes on about page", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );

    const about = bundle.pages.find((p) => p.slug === "about");
    expect(about?.contentHtml).toContain("<p>I am Prashant Naik.");
    expect(about?.contentHtml).not.toMatch(/\[special_sub_title/);
    expect(about?.contentHtml).toContain('data-unresolved-shortcode="blox_gmap"');
  });

  it("reports unresolvable portfolio and recent_posts shortcodes", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );

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

  it("skips WooCommerce stub pages by default", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );
    expect(bundle.pages.some((p) => p.slug === "cart")).toBe(false);
    expect(bundle.pages.some((p) => p.slug === "checkout")).toBe(false);
    expect(bundle.pages.some((p) => p.slug === "my-account")).toBe(false);
    expect(bundleCounts(bundle).pages).toBe(19);
  });

  it("rewrites gateway asset URLs to public origin", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );
    expect(bundle.media.some((a) => a.sourceUrl.includes("execute-api"))).toBe(false);
    expect(bundle.media.some((a) => a.sourceUrl.startsWith(`${PUBLIC}/wp-content/`))).toBe(true);
  });

  it("strips animate_icon shortcodes on contact page", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );
    const contact = bundle.pages.find((p) => p.slug === "contact");
    expect(contact?.contentHtml).toContain("2211 Lake Park Dr SE");
    expect(contact?.contentHtml).not.toMatch(/\[animate_icon/);
  });

  it("preserves awards grid inner HTML after flattening", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: pagesInput }),
    );

    const awards = bundle.pages.find((p) => p.slug === "awardsandhonors");
    expect(awards?.contentHtml).toContain("<h4>Awards and Recognition</h4>");
    expect(awards?.contentHtml).toContain("International Photography Awards 2022");
    expect(awards?.contentHtml).not.toMatch(/\[grid_content|\[grids/);
  });
});
