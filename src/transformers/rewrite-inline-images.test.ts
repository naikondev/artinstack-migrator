import { describe, expect, it } from "vitest";

import { formatMigrationMediaRef } from "../lib/migration-media-ref.js";
import { rewriteInlineImages, stampMigrationMediaRefs } from "./rewrite-inline-images.js";

const sourceId = "url:https://origin.example/wp-content/uploads/About_w_2048.jpg";
const uploaded = new Map([
  [sourceId, { targetId: "vault-about", publicUrl: "https://cdn.example/media/About_w_2048.jpg" }],
]);

const resolveAboutHero = (src: string) =>
  src.includes("About_w_2048.jpg") ? { originalSrc: src, sourceAssetId: sourceId } : undefined;

const cdnOptions = {
  resolveAsset: resolveAboutHero,
  replaceWith: (_ref: { originalSrc: string }, asset?: { publicUrl?: string; targetId: string }) =>
    asset!.publicUrl ?? asset!.targetId,
  requireUploaded: true,
};

describe("rewriteInlineImages", () => {
  it("stamps OSS-14 migration refs by default without an upload map", () => {
    const html =
      '<div data-bg-image="https://origin.example/wp-content/uploads/About_w_2048.jpg"></div>';
    const result = rewriteInlineImages(html, { resolveAsset: resolveAboutHero }, new Map());

    expect(result.html).toContain(`data-bg-image="${formatMigrationMediaRef(sourceId)}"`);
    expect(result.unresolved).toEqual([]);
  });

  it("rewrites data-bg-image section hero markers to CDN when host replaceWith is set", () => {
    const html =
      '<div data-layout="section" data-bg-image="https://origin.example/wp-content/uploads/About_w_2048.jpg">' +
      "<p>Hero</p></div>";

    const result = rewriteInlineImages(html, cdnOptions, uploaded);

    expect(result.html).toContain('data-bg-image="https://cdn.example/media/About_w_2048.jpg"');
    expect(result.unresolved).toEqual([]);
  });

  it("rewrites inline CSS background-image urls to CDN when host replaceWith is set", () => {
    const html =
      '<section style="background-image: url(\'https://origin.example/wp-content/uploads/About_w_2048.jpg\');">' +
      "<p>Hero</p></section>";

    const result = rewriteInlineImages(html, cdnOptions, uploaded);

    expect(result.html).toContain("background-image: url('https://cdn.example/media/About_w_2048.jpg')");
    expect(result.unresolved).toEqual([]);
  });

  it("tracks unresolved hero backgrounds when upload map is missing and CDN mode is required", () => {
    const html =
      '<div data-bg-image="https://origin.example/wp-content/uploads/Missing.jpg"></div>';

    const result = rewriteInlineImages(html, cdnOptions, new Map());

    expect(result.html).toContain("Missing.jpg");
    expect(result.unresolved).toEqual(["https://origin.example/wp-content/uploads/Missing.jpg"]);
  });
});

describe("stampMigrationMediaRefs", () => {
  it("stamps via url index without inventing refs for unknown urls", () => {
    const url = "https://origin.example/wp-content/uploads/About_w_2048.jpg";
    const result = stampMigrationMediaRefs(
      `<img src="${url}" /><img src="https://origin.example/unknown.jpg" />`,
      { urlToSourceId: new Map([[url, sourceId]]) },
    );

    expect(result.html).toContain(formatMigrationMediaRef(sourceId));
    expect(result.html).toContain("unknown.jpg");
    expect(result.unresolved).toContain("https://origin.example/unknown.jpg");
  });
});
