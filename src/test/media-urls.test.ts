import { describe, expect, it } from "vitest";

import {
  canonicalizeInlineAssetUrl,
  createWpContentGatewayRewrite,
  discoverContentAssetUrls,
  discoverContentAssets,
  formatMigrationMediaRef,
  isLikelyImageUrl,
  isMigrationMediaRef,
  normalizeAssetUrl,
  parseMigrationMediaRef,
  resolveFeaturedContentAssetUrl,
  rewriteOriginUrlsInText,
} from "../lib/media-urls.js";

describe("discoverContentAssets", () => {
  it("returns urls and unresolved attachment ids in separate buckets", () => {
    const html =
      '<figure data-wp-inline-gallery>' +
      '<img data-wp-attachment-id="142" alt="" />' +
      '<img data-wp-attachment-id="143" alt="" />' +
      "</figure>" +
      '<img src="https://example.com/wp-content/uploads/inline.jpg" />';
    expect(discoverContentAssets(html)).toEqual({
      urls: ["https://example.com/wp-content/uploads/inline.jpg"],
      unresolvedAttachmentIds: ["142", "143"],
    });
  });

  it("extracts ids from gallery shortcodes before flatten", () => {
    const content = '[oshine_gallery ids= "4931,4932"]';
    expect(discoverContentAssets(content).unresolvedAttachmentIds).toEqual(["4931", "4932"]);
    expect(discoverContentAssets(content).urls).toEqual([]);
  });

  it("counts stamped migration refs as discovered urls", () => {
    const ref = formatMigrationMediaRef(
      "url:https://www.example.com/wp-content/uploads/2023/04/photo.jpg",
    );
    const html = `<img src="${ref}" alt="" />`;
    expect(discoverContentAssets(html).urls).toEqual([
      "https://www.example.com/wp-content/uploads/2023/04/photo.jpg",
    ]);
  });
});

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

describe("migration media refs", () => {
  it("round-trips a normal attachment source id", () => {
    const ref = formatMigrationMediaRef("4507");
    expect(ref).toBe("artinstack-migration://asset/4507");
    expect(isMigrationMediaRef(ref)).toBe(true);
    expect(parseMigrationMediaRef(ref)).toBe("4507");
  });

  it("percent-encodes inline url source ids", () => {
    const sourceId = "url:https://www.naikonpixels.com/wp-content/uploads/About_w_2048.jpg";
    const ref = formatMigrationMediaRef(sourceId);
    expect(parseMigrationMediaRef(ref)).toBe(sourceId);
  });

  it("rejects non-ref strings", () => {
    expect(parseMigrationMediaRef("https://example.com/a.jpg")).toBeUndefined();
    expect(isMigrationMediaRef("https://example.com/a.jpg")).toBe(false);
  });
});

describe("canonicalizeInlineAssetUrl", () => {
  const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
  const PUBLIC = "https://www.naikonpixels.com";
  const rewrite = createWpContentGatewayRewrite(GATEWAY, PUBLIC);

  it("rewrites gateway host then builds url: sourceId", () => {
    const result = canonicalizeInlineAssetUrl(
      `${GATEWAY}/wp-content/uploads/About_w_2048.jpg`,
      rewrite,
    );
    expect(result?.canonicalUrl).toBe(`${PUBLIC}/wp-content/uploads/About_w_2048.jpg`);
    expect(result?.sourceId).toBe(`url:${PUBLIC}/wp-content/uploads/About_w_2048.jpg`);
  });

  it("normalizes protocol-relative URLs", () => {
    const result = canonicalizeInlineAssetUrl("//cdn.example.com/wp-content/uploads/a.jpg");
    expect(result?.canonicalUrl).toBe("https://cdn.example.com/wp-content/uploads/a.jpg");
    expect(result?.sourceId).toBe("url:https://cdn.example.com/wp-content/uploads/a.jpg");
  });

  it("is idempotent when input is already public origin", () => {
    const url = `${PUBLIC}/wp-content/uploads/About_w_2048.jpg`;
    const result = canonicalizeInlineAssetUrl(url, rewrite);
    expect(result?.sourceId).toBe(`url:${url}`);
  });
});

describe("rewriteOriginUrlsInText", () => {
  it("replaces gateway wp-content paths with public origin", () => {
    const config = createWpContentGatewayRewrite(
      "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod",
      "https://naikonpixels.com",
    );
    const raw =
      '[tatsu_image image= "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod/wp-content/uploads/2022/05/photo.jpg"]';
    expect(rewriteOriginUrlsInText(raw, config)).toContain(
      "https://naikonpixels.com/wp-content/uploads/2022/05/photo.jpg",
    );
  });

  it("supports regex rules", () => {
    const result = rewriteOriginUrlsInText("https://staging.example/a.jpg", {
      rules: [{ match: /staging\.example/, replace: "cdn.example" }],
    });
    expect(result).toBe("https://cdn.example/a.jpg");
  });
});
