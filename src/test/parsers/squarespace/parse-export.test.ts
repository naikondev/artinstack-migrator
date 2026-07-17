import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities } from "../../../normalizer/bundle.js";
import { analyzeConflicts } from "../../../sinks/conflicts.js";
import {
  SquarespaceCollectionClient,
  buildJsonPrettyUrl,
  mapJsonPrettyWire,
  mergeSquarespaceExportPartials,
} from "../../../parsers/squarespace/collect.js";
import { squarespaceAdapter } from "../../../parsers/squarespace/index.js";
import {
  enumerateSquarespaceEntities,
  summarizeSquarespaceExport,
} from "../../../parsers/squarespace/parse-export.js";
import type { SquarespaceExport } from "../../../parsers/squarespace/types.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/squarespace");

const minimalExport: SquarespaceExport = {
  exportVersion: "1",
  pages: [
    {
      id: "p1",
      title: "Welcome",
      slug: "welcome",
      blocks: [{ type: "html", html: "<p>Hi</p>" }],
    },
  ],
  posts: [
    {
      id: "post-1",
      title: "First post",
      slug: "first-post",
      blocks: [{ type: "form", id: "f1" }],
    },
  ],
};

describe("squarespace adapter", () => {
  it("enumerates pages and posts with flattened HTML", async () => {
    const entities = [];
    for await (const entity of enumerateSquarespaceEntities({ data: minimalExport })) {
      entities.push(entity);
    }
    expect(entities.map((e) => e.type)).toEqual(["page", "post"]);
    const page = entities.find((e) => e.type === "page");
    expect(page && page.type === "page" && page.contentHtml).toContain("<p>Hi</p>");
  });

  it("surfaces unsupported blocks in conflict report", async () => {
    const bundle = await collectEntities(enumerateSquarespaceEntities({ data: minimalExport }));
    const conflicts = analyzeConflicts(bundle);
    expect(conflicts.unsupportedBlocks).toEqual([
      { entityType: "post", sourceId: "post-1", blockType: "form", blockId: "f1" },
    ]);
  });

  it("summarizes export counts", () => {
    expect(summarizeSquarespaceExport(minimalExport)).toEqual({
      pages: 1,
      posts: 1,
      categories: 0,
      tags: 0,
      portfolios: 0,
    });
  });

  it("emits gallery blocks as portfolios with linked ordered assets", async () => {
    const doc: SquarespaceExport = {
      exportVersion: 1,
      pages: [
        {
          id: "page-work",
          title: "Work",
          slug: "work",
          blocks: [
            {
              id: "block-grid",
              type: "gallery",
              items: [
                {
                  id: "img-a",
                  imageUrl: "https://images.squarespace-cdn.com/content/v1/a.jpg",
                  caption: "A",
                },
                {
                  id: "img-b",
                  imageUrl: "https://images.squarespace-cdn.com/content/v1/b.jpg",
                },
              ],
            },
          ],
        },
      ],
    };

    const bundle = await collectEntities(enumerateSquarespaceEntities({ data: doc }));
    expect(bundle.portfolios).toHaveLength(1);
    expect(bundle.portfolios[0]).toMatchObject({
      sourceId: "gallery:block-grid",
      title: "Work",
      slug: "gallery-block-grid",
    });
    expect(bundle.media).toHaveLength(2);
    expect(bundle.media.map((a) => ({ id: a.sourceId, portfolio: a.portfolioSourceId, sort: a.sort }))).toEqual([
      { id: "img-a", portfolio: "gallery:block-grid", sort: 0 },
      { id: "img-b", portfolio: "gallery:block-grid", sort: 1 },
    ]);
    expect(bundle.pages[0]?.contentHtml).toContain("sqs-gallery");
    expect(summarizeSquarespaceExport(doc).portfolios).toBe(1);
  });

  it("emits top-level gallery collections as portfolios with distinct ids", async () => {
    const doc: SquarespaceExport = {
      exportVersion: 1,
      pages: [],
      galleries: [
        {
          id: "col-selected",
          title: "Selected Works",
          slug: "selected-works",
          url: "https://creative-studio.example/selected-works",
          description: "Curated",
          items: [
            {
              id: "sw-1",
              imageUrl: "https://images.squarespace-cdn.com/content/v1/selected-01.jpg",
              caption: "One",
            },
            {
              id: "sw-2",
              imageUrl: "https://images.squarespace-cdn.com/content/v1/selected-02.jpg",
            },
          ],
        },
      ],
    };

    const bundle = await collectEntities(enumerateSquarespaceEntities({ data: doc }));
    expect(bundle.portfolios).toHaveLength(1);
    expect(bundle.portfolios[0]).toMatchObject({
      sourceId: "gallery-collection:col-selected",
      title: "Selected Works",
      slug: "gallery-selected-works",
      description: "Curated",
    });
    expect(bundle.media).toHaveLength(2);
    expect(bundle.media.map((a) => ({ id: a.sourceId, portfolio: a.portfolioSourceId, sort: a.sort }))).toEqual([
      { id: "sw-1", portfolio: "gallery-collection:col-selected", sort: 0 },
      { id: "sw-2", portfolio: "gallery-collection:col-selected", sort: 1 },
    ]);
    expect(summarizeSquarespaceExport(doc).portfolios).toBe(1);
  });

  it("validates fixture file via adapter", async () => {
    const path = join(FIXTURES_ROOT, "creative-studio-site.json");
    const result = await squarespaceAdapter.validateInput({ path });
    expect(result.ok).toBe(true);
    expect(result.summary?.pages).toBe(2);
    expect(result.summary?.portfolios).toBe(2);
  });
});

describe("Squarespace json-pretty collector", () => {
  it("builds json-pretty URLs", () => {
    expect(buildJsonPrettyUrl("https://studio.example/about")).toBe(
      "https://studio.example/about?format=json-pretty",
    );
  });

  it("maps wire blog collection and static page into export partials", async () => {
    const blogWire = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "wire/blog-collection.json"), "utf8"),
    );
    const aboutWire = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "wire/about-page.json"), "utf8"),
    );

    const exportDoc = mergeSquarespaceExportPartials([
      mapJsonPrettyWire(blogWire, { fetchedUrl: "https://creative-studio.example/journal" }),
      mapJsonPrettyWire(aboutWire, { fetchedUrl: "https://creative-studio.example/about" }),
    ]);

    expect(exportDoc.posts).toHaveLength(1);
    expect(exportDoc.pages).toHaveLength(1);
    expect(exportDoc.categories).toHaveLength(2);
    expect(exportDoc.posts?.[0]?.blocks?.some((b) => b.type === "gallery")).toBe(true);
    expect(exportDoc.pages[0]?.blocks?.some((b) => b.type === "button")).toBe(true);
  });

  it("maps gallery collection wire into galleries[] (not posts)", async () => {
    const galleryWire = JSON.parse(
      await readFile(join(FIXTURES_ROOT, "wire/gallery-collection.json"), "utf8"),
    );

    const partial = mapJsonPrettyWire(galleryWire, {
      fetchedUrl: "https://creative-studio.example/selected-works",
    });

    expect(partial.posts).toEqual([]);
    expect(partial.pages).toEqual([]);
    expect(partial.galleries).toHaveLength(1);
    expect(partial.galleries?.[0]).toMatchObject({
      id: "col-selected-works",
      title: "Selected Works",
      slug: "selected-works",
    });
    expect(partial.galleries?.[0]?.items).toHaveLength(3);
    expect(partial.galleries?.[0]?.items[0]).toMatchObject({
      id: "sw-1",
      imageUrl: "https://images.squarespace-cdn.com/content/v1/selected-01.jpg",
      caption: "Frame one",
    });
  });

  it("collects via injected fetch and normalizes entities", async () => {
    const responses = new Map<string, unknown>([
      [
        "https://creative-studio.example/journal?format=json-pretty",
        JSON.parse(await readFile(join(FIXTURES_ROOT, "wire/blog-collection.json"), "utf8")),
      ],
      [
        "https://creative-studio.example/about?format=json-pretty",
        JSON.parse(await readFile(join(FIXTURES_ROOT, "wire/about-page.json"), "utf8")),
      ],
      [
        "https://creative-studio.example/selected-works?format=json-pretty",
        JSON.parse(await readFile(join(FIXTURES_ROOT, "wire/gallery-collection.json"), "utf8")),
      ],
    ]);

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const payload = responses.get(url);
      if (!payload) {
        return new Response(`missing mock for ${url}`, { status: 404 });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new SquarespaceCollectionClient({ fetchImpl, requestIntervalMs: 0 });
    const bundle = await collectEntities(
      enumerateSquarespaceEntities({
        client,
        collectTargets: [
          { url: "https://creative-studio.example/journal", kind: "collection" },
          { url: "https://creative-studio.example/about", kind: "page" },
          { url: "https://creative-studio.example/selected-works", kind: "collection" },
        ],
      }),
    );

    expect(bundle.posts).toHaveLength(1);
    expect(bundle.pages).toHaveLength(1);
    expect(bundle.portfolios.some((p) => p.sourceId === "gallery-collection:col-selected-works")).toBe(
      true,
    );
    expect(bundle.media.length).toBeGreaterThan(0);

    const conflicts = analyzeConflicts(bundle);
    expect(conflicts.unsupportedBlocks.some((b) => b.blockType === "form")).toBe(true);
    expect(conflicts.unsupportedBlocks.some((b) => b.blockType === "product")).toBe(true);
  });
});
