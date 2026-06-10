import { describe, expect, it } from "vitest";

import {
  discoverContentAssetUrls,
  isLikelyImageUrl,
  normalizeAssetUrl,
  resolveFeaturedContentAssetUrl,
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

  it("ignores iframe and page links even when path mentions wp-content/uploads", () => {
    const content =
      '<iframe src="https://www.youtube.com/embed/abc123"></iframe>' +
      'url="https://example.com/category/wp-content/uploads/gallery-meta" ' +
      'src="https://example.com/about"';
    expect(discoverContentAssetUrls(content)).toEqual([]);
    expect(
      isLikelyImageUrl("https://example.com/category/wp-content/uploads/gallery-meta"),
    ).toBe(false);
  });

  it("accepts CDN image URLs with trailing query parameters", () => {
    const url = "https://example.com/wp-content/uploads/2026/01/MilkyWay.jpg?w=2048&ssl=1";
    expect(isLikelyImageUrl(url)).toBe(true);
    expect(discoverContentAssetUrls(`image="${url}"`)).toEqual([url]);
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

  it("extracts data-bg-image section hero markers", () => {
    const html =
      '<div data-layout="section" data-bg-image="https://example.com/wp-content/uploads/About_w_2048.jpg">' +
      "<p>Hero copy</p></div>";
    expect(discoverContentAssetUrls(html)).toEqual([
      "https://example.com/wp-content/uploads/About_w_2048.jpg",
    ]);
  });

  it("extracts inline CSS background-image urls", () => {
    const html =
      '<section style="background-image: url(\'https://example.com/wp-content/uploads/hero_16x9.jpg\');">' +
      "<p>Hero</p></section>";
    expect(discoverContentAssetUrls(html)).toEqual([
      "https://example.com/wp-content/uploads/hero_16x9.jpg",
    ]);
  });

  it("extracts Tatsu bg_image shortcode attributes", () => {
    const content =
      '[tatsu_section bg_image= "https://site.example/prod/wp-content/uploads/2022/05/hero.jpg"]';
    expect(discoverContentAssetUrls(content)).toEqual([
      "https://site.example/prod/wp-content/uploads/2022/05/hero.jpg",
    ]);
  });

  it("ignores numeric attachment ids in bg_image params", () => {
    const content = '[section bg_image= "78"][one_col][/one_col][/section]';
    expect(discoverContentAssetUrls(content)).toEqual([]);
  });

  it("deduplicates hero background and img src for the same asset", () => {
    const content =
      '<div data-bg-image="https://example.com/wp-content/uploads/x.jpg"></div>' +
      '<img src="https://example.com/wp-content/uploads/x.jpg" />';
    expect(discoverContentAssetUrls(content)).toHaveLength(1);
  });
});

describe("resolveFeaturedContentAssetUrl", () => {
  it("prefers section data-bg-image over earlier inline _w_<width> export", () => {
    const content =
      '<img src="https://example.com/wp-content/uploads/MoccasinCreek_w_1045.jpg" />' +
      '<div data-layout="section" data-bg-image="https://example.com/wp-content/uploads/MilkyWay_16x9.jpg"></div>';
    expect(resolveFeaturedContentAssetUrl(content)).toBe(
      "https://example.com/wp-content/uploads/MilkyWay_16x9.jpg",
    );
  });

  it("prefers bg_image shortcode over inline tatsu_image _w export", () => {
    const content =
      '[tatsu_image image= "https://example.com/wp-content/uploads/inline_w.jpg"]' +
      '[tatsu_section bg_image= "https://example.com/wp-content/uploads/Hero_2048.jpg"]';
    expect(resolveFeaturedContentAssetUrl(content)).toBe(
      "https://example.com/wp-content/uploads/Hero_2048.jpg",
    );
  });

  it("prefers inline CSS background-image over document-order img src", () => {
    const content =
      '<img src="https://example.com/wp-content/uploads/thumb_w.jpg" />' +
      '<div style="background-image: url(\'https://example.com/wp-content/uploads/hero_16x9.jpg\');"></div>';
    expect(resolveFeaturedContentAssetUrl(content)).toBe(
      "https://example.com/wp-content/uploads/hero_16x9.jpg",
    );
  });

  it("uses document order among inline images when no section hero exists", () => {
    const content =
      '[tatsu_image image= "https://example.com/wp-content/uploads/MoccasinCreek_w_1045.jpg"]' +
      '[tatsu_image image= "https://example.com/wp-content/uploads/MoccasinCreek_w_2048.jpg"]';
    expect(resolveFeaturedContentAssetUrl(content)).toBe(
      "https://example.com/wp-content/uploads/MoccasinCreek_w_1045.jpg",
    );
  });

  it("ignores empty bg_image params when falling back to inline assets", () => {
    const content =
      '[tatsu_section bg_image= ""][tatsu_image image= "https://example.com/wp-content/uploads/only.jpg"]';
    expect(resolveFeaturedContentAssetUrl(content)).toBe(
      "https://example.com/wp-content/uploads/only.jpg",
    );
  });
});

describe("normalizeAssetUrl", () => {
  it("prefixes protocol-relative URLs with https", () => {
    expect(normalizeAssetUrl("//cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
  });
});
