import { describe, expect, it } from "vitest";

import { rewriteInlineImages } from "./rewrite-inline-images.js";

const uploaded = new Map([
  ["url:https://origin.example/wp-content/uploads/About_w_2048.jpg", {
    targetId: "vault-about",
    publicUrl: "https://cdn.example/media/About_w_2048.jpg",
  }],
]);

const options = {
  resolveAsset: (src: string) =>
    src.includes("About_w_2048.jpg")
      ? {
          originalSrc: src,
          sourceAssetId: "url:https://origin.example/wp-content/uploads/About_w_2048.jpg",
        }
      : undefined,
  replaceWith: (_ref: { originalSrc: string }, asset: { publicUrl?: string; targetId: string }) =>
    asset.publicUrl ?? asset.targetId,
};

describe("rewriteInlineImages", () => {
  it("rewrites data-bg-image section hero markers", () => {
    const html =
      '<div data-layout="section" data-bg-image="https://origin.example/wp-content/uploads/About_w_2048.jpg">' +
      "<p>Hero</p></div>";

    const result = rewriteInlineImages(html, options, uploaded);

    expect(result.html).toContain('data-bg-image="https://cdn.example/media/About_w_2048.jpg"');
    expect(result.unresolved).toEqual([]);
  });

  it("rewrites inline CSS background-image urls", () => {
    const html =
      '<section style="background-image: url(\'https://origin.example/wp-content/uploads/About_w_2048.jpg\');">' +
      "<p>Hero</p></section>";

    const result = rewriteInlineImages(html, options, uploaded);

    expect(result.html).toContain("background-image: url('https://cdn.example/media/About_w_2048.jpg')");
    expect(result.unresolved).toEqual([]);
  });

  it("tracks unresolved hero backgrounds when upload map is missing", () => {
    const html =
      '<div data-bg-image="https://origin.example/wp-content/uploads/Missing.jpg"></div>';

    const result = rewriteInlineImages(html, options, new Map());

    expect(result.html).toContain("Missing.jpg");
    expect(result.unresolved).toEqual(["https://origin.example/wp-content/uploads/Missing.jpg"]);
  });
});
