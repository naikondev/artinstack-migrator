import { describe, expect, it } from "vitest";

import {
  discoverContentAssetUrls,
  isLikelyImageUrl,
  normalizeAssetUrl,
} from "./content-asset-urls.js";

describe("discoverContentAssetUrls", () => {
  it("extracts standard img tags", () => {
    const html = '<p>Hi</p><img src="https://example.com/wp-content/uploads/a.jpg" />';
    expect(discoverContentAssetUrls(html)).toEqual([
      "https://example.com/wp-content/uploads/a.jpg",
    ]);
  });

  it("extracts Tatsu shortcode image= attributes with spaced equals", () => {
    const content = `[tatsu_image image= "https://site.example/prod/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg" id= "4507"]`;
    expect(discoverContentAssetUrls(content)).toEqual([
      "https://site.example/prod/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg",
    ]);
  });

  it("extracts protocol-relative wp-content URLs", () => {
    const content = 'image="//s3-us-west-2.amazonaws.com/bucket/wp-content/uploads/2017/06/photo.jpg"';
    expect(discoverContentAssetUrls(content)).toEqual([
      "https://s3-us-west-2.amazonaws.com/bucket/wp-content/uploads/2017/06/photo.jpg",
    ]);
  });

  it("deduplicates the same URL from img and shortcode", () => {
    const content =
      '<img src="https://example.com/wp-content/uploads/x.png" />' +
      '[tatsu_image image="https://example.com/wp-content/uploads/x.png"]';
    expect(discoverContentAssetUrls(content)).toHaveLength(1);
  });

  it("ignores non-image url= parameters", () => {
    const content = 'url="https://example.com/about" link="https://example.com/page"';
    expect(discoverContentAssetUrls(content)).toEqual([]);
  });

  it("ignores data URIs", () => {
    const content = 'src="data:image/png;base64,abc" image="data:image/jpeg;base64,xyz"';
    expect(discoverContentAssetUrls(content)).toEqual([]);
  });

  it("accepts root-relative wp-content paths", () => {
    expect(isLikelyImageUrl("/wp-content/uploads/2021/01/photo.jpg")).toBe(true);
    expect(discoverContentAssetUrls('src="/wp-content/uploads/2021/01/photo.jpg"')).toEqual([
      "/wp-content/uploads/2021/01/photo.jpg",
    ]);
  });
});

describe("normalizeAssetUrl", () => {
  it("prefixes protocol-relative URLs with https", () => {
    expect(normalizeAssetUrl("//cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
  });
});
