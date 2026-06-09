import { describe, expect, it } from "vitest";

import { discoverContentAssetUrls } from "../../../lib/content-asset-urls.js";
import { flattenWordPressBuilders } from "./flatten.js";
import { findWordPressShortcodeMarkers } from "./shortcode-conflicts.js";

describe("flattenWordPressBuilders", () => {
  it("converts Tatsu image shortcodes and strips scaffolding", () => {
    const raw =
      '[tatsu_section padding="0"][tatsu_row][tatsu_column][tatsu_text]Hello[/tatsu_text]' +
      '[tatsu_image image= "https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg" id= "4507"][/tatsu_image]' +
      "[/tatsu_column][/tatsu_row][/tatsu_section]";

    const { html, detectedThemes } = flattenWordPressBuilders(raw);

    expect(detectedThemes).toContain("tatsu");
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg"');
    expect(html).not.toMatch(/\[tatsu_/);
    expect(html).toContain("Hello");
    expect(discoverContentAssetUrls(html)).toHaveLength(1);
  });

  it("leaves plain HTML unchanged when no builder detected", () => {
    const html = "<p>Plain post</p><img src=\"https://example.com/wp-content/uploads/a.jpg\" />";
    const result = flattenWordPressBuilders(html);
    expect(result.html).toBe(html);
    expect(result.detectedThemes).toEqual([]);
  });

  it("converts Divi et_pb_image src attributes", () => {
    const raw =
      '[et_pb_section][et_pb_row][et_pb_image src="https://example.com/wp-content/uploads/divi.jpg"][/et_pb_image][/et_pb_row][/et_pb_section]';
    const { html } = flattenWordPressBuilders(raw);
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

  it("strips legacy section/row/text scaffolding", () => {
    const raw = '[section][row][one_col][text]<h1>Hello</h1>[/text][/one_col][/row][/section]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toMatch(/\[(section|row|one_col|text)\b/);
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
