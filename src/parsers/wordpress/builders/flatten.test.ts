import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { discoverContentAssetUrls } from "../../../lib/content-asset-urls.js";
import {
  applyStructuralLayoutMap,
  flattenWordPressBuilders,
  parseRowLayoutCols,
} from "./flatten.js";
import { findWordPressShortcodeMarkers } from "./shortcode-conflicts.js";
import {
  fractionalLayoutMap,
  parseFractionalColumnWidth,
  prefixedLayoutMap,
  type BuilderThemeConfig,
} from "./registry.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/wordpress");

function extractAboutPageRawContent(): string {
  const xml = readFileSync(join(FIXTURES_ROOT, "naikonpixels.WordPress.Pages.2026-06-09.xml"), "utf8");
  const match = xml.match(
    /<link>[^<]*\/about\/<\/link>[\s\S]*?<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/,
  );
  if (!match?.[1]) throw new Error("about page content not found in fixture");
  return match[1];
}

describe("flattenWordPressBuilders", () => {
  it("converts Tatsu structure to data-layout markers and image shortcodes", () => {
    const raw =
      '[tatsu_section padding="0"][tatsu_row layout="1/2+1/2"][tatsu_column][tatsu_text]Hello[/tatsu_text]' +
      '[tatsu_image image= "https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg" id= "4507"][/tatsu_image]' +
      "[/tatsu_column][/tatsu_row][/tatsu_section]";

    const { html, detectedThemes } = flattenWordPressBuilders(raw);

    expect(detectedThemes).toContain("tatsu");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-layout="column"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg"');
    expect(html).not.toMatch(/\[tatsu_/);
    expect(html).toContain("Hello");
    expect(discoverContentAssetUrls(html)).toHaveLength(1);
  });

  it("parses row layout strings into column counts", () => {
    expect(parseRowLayoutCols("1/2+1/2")).toBe(2);
    expect(parseRowLayoutCols("1/3+1/3+1/3")).toBe(3);
    expect(parseRowLayoutCols("1/1")).toBeUndefined();
  });

  it("applies layoutMap dynamically for any namespace via the generic compiler", () => {
    const raw =
      '[vc_section bg_image="https://example.com/hero.jpg"][vc_row layout="1/2+1/2"]' +
      '[vc_column]<p>Left</p>[/vc_column][vc_column]<p>Right</p>[/vc_column][/vc_row][/vc_section]';

    const map = prefixedLayoutMap({
      section: "vc_section",
      row: "vc_row",
      column: "vc_column",
      bgParamName: "bg_image",
      colsParamName: "layout",
    });
    const html = applyStructuralLayoutMap(raw, map);

    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://example.com/hero.jpg"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-layout="column"');
    expect(html).toContain("<p>Left</p>");
    expect(html).not.toMatch(/\[vc_/);
  });

  it("uses registry layoutMap for Divi without Tatsu-specific code", () => {
    const raw =
      '[et_pb_section][et_pb_row layout="1/2+1/2"][et_pb_column][et_pb_image src="https://example.com/wp-content/uploads/divi.jpg"][/et_pb_image][/et_pb_column][/et_pb_row][/et_pb_section]';
    const diviOnly: BuilderThemeConfig[] = [
      {
        id: "divi",
        detect: /\[(?:\/)?et_pb_/i,
        layoutMap: prefixedLayoutMap({
          section: "et_pb_section",
          row: "et_pb_row",
          column: "et_pb_column",
        }),
        urlRules: [{ shortcodePrefix: "et_pb_image", urlParams: ["src", "url"], tag: "img" }],
        scaffoldingPrefixes: ["et_pb_"],
      },
    ];
    const { html } = flattenWordPressBuilders(raw, { registry: diviOnly });
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/divi.jpg"');
    expect(html).not.toMatch(/\[et_pb_/);
  });

  it("flattens naikonpixels about page with section/row/column structure", () => {
    const { html, detectedThemes } = flattenWordPressBuilders(extractAboutPageRawContent());

    expect(detectedThemes).toContain("tatsu");
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod/wp-content/uploads/About_w_2048.jpg"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-cols="3"');
    expect(html).toContain("<p>I am Prashant Naik.");
    expect(html).toContain("International Dark-Sky Association");
    expect(html).toContain('data-unresolved-shortcode="blox_gmap"');
    expect(html).not.toMatch(/\[tatsu_/);
    expect((html.match(/data-layout="row"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((html.match(/data-layout="column"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("leaves plain HTML unchanged when no builder detected", () => {
    const html = "<p>Plain post</p><img src=\"https://example.com/wp-content/uploads/a.jpg\" />";
    const result = flattenWordPressBuilders(html);
    expect(result.html).toBe(html);
    expect(result.detectedThemes).toEqual([]);
  });

  it("converts Divi et_pb_image src attributes with structural layoutMap", () => {
    const raw =
      '[et_pb_section][et_pb_row][et_pb_image src="https://example.com/wp-content/uploads/divi.jpg"][/et_pb_image][/et_pb_row][/et_pb_section]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/divi.jpg"');
    expect(html).not.toMatch(/\[et_pb_/);
  });

  it("converts Oshine special_sub_title title_content to paragraphs", () => {
    const raw =
      '[special_sub_title title_content= "I am Prashant Naik." font_size= "18"][/special_sub_title]' +
      '<h5>Existing heading</h5>';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain("<p>I am Prashant Naik.</p>");
    expect(html).not.toMatch(/\[special_sub_title/);
    expect(html).toContain("<h5>Existing heading</h5>");
  });

  it("converts special_heading5 caption_content and strips grids scaffolding", () => {
    const raw =
      '[special_heading5 title_content= "" caption_content= "Awards and Recognition"][/special_heading5]' +
      '[grids column= "3"][grid_content]<h6>Gold</h6><p>IPA 2022</p>[/grid_content][/grids]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain("<h4>Awards and Recognition</h4>");
    expect(html).toContain("<h6>Gold</h6>");
    expect(html).not.toMatch(/\[grids|\[grid_content/);
  });

  it("preserves testimonial inner HTML and converts author_image", () => {
    const raw =
      '[testimonials][testimonial author_image= "https://example.com/wp-content/uploads/face.jpg" author= "Jane"]' +
      "<p>Great photographer.</p>[/testimonial][/testimonials]";
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/face.jpg"');
    expect(html).toContain("<p>Great photographer.</p>");
    expect(html).not.toMatch(/\[testimonial|\[testimonials/);
  });

  it("replaces blox_gmap with a static placeholder", () => {
    const raw = '[blox_gmap type="gmap"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-unresolved-shortcode="blox_gmap"');
    expect(html).not.toMatch(/\[blox_gmap/);
  });

  it("strips blox_row scaffolding and leaves portfolio shortcode for conflicts", () => {
    const raw =
      '[blox_row][blox_column width="1/1"][portfolio col="two" category="photography"][/portfolio][/blox_column][/blox_row]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).not.toMatch(/\[blox_/);
    expect(html).toMatch(/\[portfolio/);
    expect(findWordPressShortcodeMarkers(html)).toEqual([
      { shortcode: "portfolio", unresolvable: true },
    ]);
  });

  it("parses fractional column token names into width percentages", () => {
    expect(parseFractionalColumnWidth("one_third")).toBe("33.33%");
    expect(parseFractionalColumnWidth("one_half")).toBe("50%");
    expect(parseFractionalColumnWidth("three_fourths")).toBe("75%");
  });

  it("applies fractional layoutMap for legacy Blox section/row/column tokens", () => {
    const raw =
      '[section bg_image="https://example.com/hero.jpg"][row][one_third]<h6>Left</h6>[/one_third]' +
      '[two_third]<p>Right</p>[/two_third][/row][/section]';
    const html = applyStructuralLayoutMap(
      raw,
      fractionalLayoutMap({
        section: "section",
        row: "row",
        columns: ["one_third", "two_third", "one_half", "one_col"],
        bgParamName: "bg_image",
      }),
    );
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://example.com/hero.jpg"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-layout="column" data-col-width="33.33%"');
    expect(html).toContain('data-layout="column" data-col-width="66.67%"');
    expect(html).toContain("<h6>Left</h6>");
    expect(html).not.toMatch(/\[(section|row|one_third|two_third)\b/);
  });

  it("flattens legacy Blox section/row/column via oshine registry fractional profile", () => {
    const raw = '[section][row][one_col][text]<h1>Hello</h1>[/text][/one_col][/row][/section]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-layout="column" data-col-width="100%"');
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toMatch(/\[(section|row|one_col)\b/);
    expect(html).not.toMatch(/\[text\b/);
  });

  it("strips animate_icon scaffolding when that is the only builder marker", () => {
    const raw =
      '[animate_icons_style1 height= "200" key= "x"][animate_icon_style1 icon= "icon-email" key= "y"]' +
      "<p>hello@example.com</p>";
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain("<p>hello@example.com</p>");
    expect(html).not.toMatch(/\[animate_icon/);
  });
});

describe("findWordPressShortcodeMarkers", () => {
  it("flags unresolvable dynamic shortcodes", () => {
    const markers = findWordPressShortcodeMarkers(
      '[portfolio col="two"][/portfolio][recent_posts number="three"][/recent_posts][woocommerce_cart]',
    );
    expect(markers.map((m) => m.shortcode)).toEqual(["portfolio", "recent_posts", "woocommerce_cart"]);
    expect(markers.every((m) => m.unresolvable)).toBe(true);
  });
});
