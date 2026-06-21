import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { collectEntities } from "../../src/normalizer/bundle.js";
import { createWpContentGatewayRewrite } from "../../src/lib/media-urls.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";
import type { EntityBundle } from "../../src/normalizer/bundle.js";

const LOCAL_ROOT = "/Volumes/Documents/Projects/Naikonpixels - Local";
const PORTFOLIO_WXR = join(LOCAL_ROOT, "portfolio.WordPress.2026-06-21.xml");
const WILDLIFE_WXR = join(LOCAL_ROOT, "wildlife.WordPress.2026-06-21.xml");

const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
const PUBLIC = "https://www.naikonpixels.com";

const inputOptions = {
  originUrlRewrite: createWpContentGatewayRewrite(GATEWAY, PUBLIC),
};

describe.skipIf(!existsSync(PORTFOLIO_WXR))("local portfolio page WXR (2026-06-21)", () => {
  let bundle: EntityBundle;

  beforeAll(async () => {
    bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: PORTFOLIO_WXR, ...inputOptions } }),
    );
  });

  it("emits hero slider hint from theme meta (not in contentHtml)", () => {
    const portfolio = bundle.pages.find((p) => p.slug === "portfolio");
    expect(portfolio).toBeDefined();
    expect(portfolio?.layoutHints?.heroSlider).toEqual({
      plugin: "revslider",
      alias: "Portfolio_slider",
      slidertitle: "Portfolio_slider",
      source: "meta-shortcode",
    });
    expect(portfolio?.contentHtml).not.toContain('data-wp-widget="slider"');
    expect(portfolio?.contentHtml).not.toMatch(/\[rev_slider\b/i);
  });
});

describe.skipIf(!existsSync(WILDLIFE_WXR))("local wildlife portfolio CPT WXR (2026-06-21)", () => {
  let bundle: EntityBundle;

  beforeAll(async () => {
    bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: WILDLIFE_WXR, ...inputOptions } }),
    );
  });

  it("emits hero slider hint on wildlife portfolio CPT page", () => {
    const wildlife = bundle.pages.find((p) => p.slug === "wildlife");
    expect(wildlife).toBeDefined();
    expect(wildlife?.sourceId).toBe("portfolio:45");
    expect(wildlife?.layoutHints?.heroSlider).toEqual({
      plugin: "revslider",
      alias: "wildlife",
      slidertitle: "Wildlife",
      source: "meta-shortcode",
    });
    expect(wildlife?.contentHtml).not.toContain('data-wp-widget="slider"');
    expect(wildlife?.contentHtml).not.toMatch(/\[rev_slider\b/i);
    expect(wildlife?.contentHtml).toContain("data-wp-inline-gallery");
  });

  it("flattens in-body [masterslider] to slider widget stubs on portfolio CPT pages", () => {
    const intoTheDark = bundle.pages.find((p) => p.slug === "into-the-dark");
    expect(intoTheDark?.contentHtml).toContain('data-wp-widget="slider"');
    expect(intoTheDark?.contentHtml).toContain('data-wp-slider-plugin="masterslider"');
    expect(intoTheDark?.contentHtml).toContain('data-wp-slider-alias="video-slider"');
    expect(intoTheDark?.contentHtml).not.toMatch(/\[masterslider\b/i);

    const sliderPages = bundle.pages.filter((p) => p.contentHtml.includes('data-wp-widget="slider"'));
    expect(sliderPages.length).toBeGreaterThan(0);
    expect(sliderPages.every((p) => !/\[masterslider\b/i.test(p.contentHtml))).toBe(true);
  });
});
