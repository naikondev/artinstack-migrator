import { describe, expect, it } from "vitest";

import { discoverContentAssetUrls } from "../../../lib/content-asset-urls.js";
import { flattenWordPressBuilders } from "./flatten.js";

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
});
