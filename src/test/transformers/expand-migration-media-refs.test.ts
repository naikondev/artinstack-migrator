import { describe, expect, it } from "vitest";

import { formatMigrationMediaRef } from "../../lib/media-urls.js";
import { expandMigrationMediaRefs } from "../../transformers/expand-migration-media-refs.js";

describe("expandMigrationMediaRefs", () => {
  const sourceId = "url:https://www.naikonpixels.com/wp-content/uploads/About_w_2048.jpg";
  const ref = formatMigrationMediaRef(sourceId);

  it("expands data-bg-image refs to CDN urls", () => {
    const html = `<div data-layout="section" data-bg-image="${ref}"></div>`;
    const result = expandMigrationMediaRefs(html, (id) =>
      id === sourceId ? "https://cdn.example/media/About_w_2048.jpg" : undefined,
    );

    expect(result.html).toContain('data-bg-image="https://cdn.example/media/About_w_2048.jpg"');
    expect(result.unresolved).toEqual([]);
  });

  it("expands data-video-url and video src refs to CDN urls", () => {
    const videoSourceId = "url:https://www.naikonpixels.com/wp-content/uploads/Naikonpixels_H264.mp4";
    const videoRef = formatMigrationMediaRef(videoSourceId);
    const html =
      `<div data-video-url="${videoRef}"></div>` +
      `<video src="${videoRef}" controls></video>`;
    const result = expandMigrationMediaRefs(html, (id) =>
      id === videoSourceId ? "https://cdn.example/media/Naikonpixels_H264.mp4" : undefined,
    );

    expect(result.html).toContain('data-video-url="https://cdn.example/media/Naikonpixels_H264.mp4"');
    expect(result.html).toContain('src="https://cdn.example/media/Naikonpixels_H264.mp4"');
    expect(result.unresolved).toEqual([]);
  });

  it("leaves unknown refs and reports unresolved", () => {
    const html = `<img src="${ref}" />`;
    const result = expandMigrationMediaRefs(html, () => undefined);
    expect(result.html).toContain(ref);
    expect(result.unresolved).toEqual([ref]);
  });
});
