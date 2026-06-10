import { describe, expect, it } from "vitest";

import { formatMigrationMediaRef } from "../lib/migration-media-ref.js";
import { expandMigrationMediaRefs } from "./expand-migration-media-refs.js";

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

  it("leaves unknown refs and reports unresolved", () => {
    const html = `<img src="${ref}" />`;
    const result = expandMigrationMediaRefs(html, () => undefined);
    expect(result.html).toContain(ref);
    expect(result.unresolved).toEqual([ref]);
  });
});
