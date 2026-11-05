import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../../normalizer/bundle.js";
import { validateNormalizedComment } from "../../../normalizer/validate.js";
import {
  SmugMugApiClient,
  mapSmugMugCommentWire,
} from "../../../parsers/smugmug/api.js";
import {
  enumerateSmugMugEntities,
  loadSmugMugExport,
  mapSmugMugCommentModerationStatus,
  smugMugCommentSourceId,
  summarizeSmugMugExport,
} from "../../../parsers/smugmug/parse-node.js";
import type { SmugMugFlatExport } from "../../../parsers/smugmug/types.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/smugmug");

describe("mapSmugMugCommentModerationStatus", () => {
  it("maps approved / pending / spam / trash and absent vs unmapped", () => {
    expect(mapSmugMugCommentModerationStatus(true)).toEqual({ status: "approved" });
    expect(mapSmugMugCommentModerationStatus("public")).toEqual({ status: "approved" });
    expect(mapSmugMugCommentModerationStatus(false)).toEqual({ status: "pending" });
    expect(mapSmugMugCommentModerationStatus("spam")).toEqual({ status: "spam" });
    expect(mapSmugMugCommentModerationStatus("trash")).toEqual({ status: "rejected" });
    expect(mapSmugMugCommentModerationStatus(undefined)).toEqual({
      status: "pending",
      absent: true,
    });
    expect(mapSmugMugCommentModerationStatus("weird")).toEqual({
      status: "pending",
      unmapped: true,
      raw: "weird",
    });
  });
});

describe("smugMugCommentSourceId", () => {
  it("namespaces once", () => {
    expect(smugMugCommentSourceId("42")).toBe("smugmug:comment:42");
    expect(smugMugCommentSourceId("smugmug:comment:42")).toBe("smugmug:comment:42");
  });
});

describe("SmugMug comments normalize (OSS-36)", () => {
  it("emits portfolio + media comments from nested fixture", async () => {
    const path = join(FIXTURES_ROOT, "comments-minimal.json");
    const bundle = await collectEntities(enumerateSmugMugEntities({ filePath: path }));

    expect(bundleCounts(bundle).comments).toBe(4);
    expect(bundleCounts(bundle).portfolios).toBe(2);
    expect(bundleCounts(bundle).assets).toBe(1);

    const byId = new Map(bundle.comments.map((c) => [c.sourceId, c]));

    expect(byId.get("smugmug:comment:c-album-root")).toMatchObject({
      type: "comment",
      target: { type: "portfolio", sourceId: "album-iceland" },
      contentHtml: "Beautiful album — love the aurora set.",
      status: "approved",
      authorType: "guest",
      authorName: "Alex Visitor",
      authorEmail: "alex@example.com",
    });

    expect(byId.get("smugmug:comment:c-album-reply")).toMatchObject({
      target: { type: "portfolio", sourceId: "album-iceland" },
      parentSourceId: "smugmug:comment:c-album-root",
      status: "approved",
    });

    expect(byId.get("smugmug:comment:c-album-pending")).toMatchObject({
      target: { type: "portfolio", sourceId: "album-iceland" },
      status: "pending",
      parentSourceId: undefined,
    });

    expect(byId.get("smugmug:comment:c-image-1")).toMatchObject({
      target: { type: "media", sourceId: "img-aurora" },
      contentHtml: "Stunning capture of the lights.",
      status: "approved",
      authorUrl: "https://example.com/fan",
    });

    for (const comment of bundle.comments) {
      expect(validateNormalizedComment(comment)).toEqual({ ok: true, issues: [] });
    }

    expect(summarizeSmugMugExport(await loadSmugMugExport({ filePath: path })).comments).toBe(4);
  });

  it("emits comments from flat Comments table without rolling media onto portfolio", async () => {
    const flat: SmugMugFlatExport = {
      exportVersion: 1,
      Folders: [],
      Albums: [{ sourceId: "album-1", name: "A" }],
      Images: [
        {
          sourceId: "img-1",
          portfolioSourceId: "album-1",
          fileName: "a.jpg",
          originalUrl: "https://photos.example/a.jpg",
        },
      ],
      Comments: [
        {
          sourceId: "10",
          targetType: "portfolio",
          targetSourceId: "album-1",
          contentHtml: "Album note",
          approved: true,
        },
        {
          sourceId: "11",
          targetType: "media",
          targetSourceId: "img-1",
          contentHtml: "Photo note",
          approved: true,
        },
        {
          sourceId: "12",
          targetType: "media",
          targetSourceId: "img-1",
          parentSourceId: "11",
          contentHtml: "Reply on photo",
          approved: "1",
        },
      ],
    };

    const bundle = await collectEntities(enumerateSmugMugEntities({ data: flat }));
    expect(bundle.comments).toHaveLength(3);
    expect(bundle.comments.find((c) => c.sourceId === "smugmug:comment:11")?.target).toEqual({
      type: "media",
      sourceId: "img-1",
    });
    expect(bundle.comments.find((c) => c.sourceId === "smugmug:comment:12")?.parentSourceId).toBe(
      "smugmug:comment:11",
    );
  });
});

describe("mapSmugMugCommentWire", () => {
  it("maps wire fields and skips empty bodies", () => {
    expect(
      mapSmugMugCommentWire(
        {
          CommentID: 99,
          Text: "Hello",
          Name: "Pat",
          Date: "2024-01-01T00:00:00Z",
          ParentID: 98,
          Approved: true,
        },
        { type: "portfolio", sourceId: "album-x" },
      ),
    ).toEqual({
      sourceId: "99",
      targetType: "portfolio",
      targetSourceId: "album-x",
      parentSourceId: "98",
      contentHtml: "Hello",
      authorName: "Pat",
      authorEmail: undefined,
      authorUrl: undefined,
      publishedAt: "2024-01-01T00:00:00Z",
      approved: true,
    });

    expect(
      mapSmugMugCommentWire({ CommentID: 1, Text: "   " }, { type: "media", sourceId: "img" }),
    ).toBeNull();
  });
});

describe("SmugMug API crawl comments (OSS-36)", () => {
  const credentials = {
    consumerKey: "test-consumer-key",
    consumerSecret: "test-consumer-secret",
    accessToken: "test-access-token",
    accessTokenSecret: "test-access-token-secret",
  };

  it("follows NodeComments + ImageComments relation URIs and paginates", async () => {
    const imagesConfig = encodeURIComponent(
      JSON.stringify({
        expand: {
          ImageSizeDetails: {},
          ImageMetadata: {
            filter: ["ISO", "Aperture", "ApertureValue", "ShutterSpeed", "ExposureTime", "FocalLength"],
          },
          LargestImage: {
            filter: ["Url"],
          },
        },
      }),
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.smugmug.com/api/v2!authuser") {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            NickName: "demo",
            Uri: "/api/v2/user/demo",
            Uris: { Node: "/api/v2/node/root-node" },
          },
        });
      }

      if (url.startsWith("https://api.smugmug.com/api/v2/node/root-node!children")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Node: {
              NodeID: "album-iceland",
              Type: "Album",
              Name: "Iceland",
              Uri: "/api/v2/node/album-iceland",
              Uris: {
                Album: "/api/v2/album/alb-key-1",
                NodeComments: "/api/v2/node/album-iceland!comments",
              },
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }

      if (
        url ===
        "https://api.smugmug.com/api/v2/node/album-iceland!comments?count=100&start=1"
      ) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Comment: {
              CommentID: "c1",
              Text: "Album page 1",
              Name: "Visitor",
              Approved: true,
            },
            Pages: {
              Total: 2,
              Start: 1,
              Count: 1,
              NextPage: "/api/v2/node/album-iceland!comments?count=100&start=2",
            },
          },
        });
      }

      if (
        url ===
        "https://api.smugmug.com/api/v2/node/album-iceland!comments?count=100&start=2"
      ) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Comment: {
              CommentID: "c2",
              Text: "Album page 2 reply",
              ParentID: "c1",
              Name: "Owner",
              Approved: true,
            },
            Pages: { Total: 2, Start: 2, Count: 1 },
          },
        });
      }

      if (
        url ===
        `https://api.smugmug.com/api/v2/album/alb-key-1!images?_config=${imagesConfig}&_expandmethod=inline&count=100&start=1`
      ) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            AlbumImage: {
              ImageKey: "img-aurora",
              FileName: "aurora.jpg",
              Uris: {
                ImageComments: "/api/v2/image/img-aurora!comments",
                ImageSizeDetails: {
                  Uri: "/api/v2/image/img-aurora!sizedetails",
                  Locator: "ImageSizeDetails",
                  ImageSizeDetails: {
                    OriginalImageUrl: "https://photos.smugmug.com/aurora.jpg",
                  },
                },
              },
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }

      if (url.startsWith("https://api.smugmug.com/api/v2/image/img-aurora!comments")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Comment: {
              CommentID: "img-c1",
              Text: "Image comment",
              Name: "Fan",
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }

      return new Response(`missing mock for ${url}`, { status: 404 });
    };

    const client = new SmugMugApiClient({
      credentials,
      fetchImpl,
      requestIntervalMs: 0,
    });

    const exportDoc = await client.crawlExport();
    expect(exportDoc.Comments).toHaveLength(3);
    expect(exportDoc.Comments?.map((c) => c.targetType).sort()).toEqual([
      "media",
      "portfolio",
      "portfolio",
    ]);

    const bundle = await collectEntities(enumerateSmugMugEntities({ client }));
    expect(bundleCounts(bundle).comments).toBe(3);
    expect(bundle.comments.find((c) => c.sourceId === "smugmug:comment:c2")?.parentSourceId).toBe(
      "smugmug:comment:c1",
    );
    expect(bundle.comments.find((c) => c.sourceId === "smugmug:comment:img-c1")).toMatchObject({
      target: { type: "media", sourceId: "img-aurora" },
      status: "pending", // moderation absent on wire
    });
  });

  it("rediscovers NodeComments via _filteruri when !children omits the link", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.smugmug.com/api/v2!authuser") {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            NickName: "demo",
            Uri: "/api/v2/user/demo",
            Uris: { Node: "/api/v2/node/root-node" },
          },
        });
      }

      if (url.startsWith("https://api.smugmug.com/api/v2/node/root-node!children")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Node: {
              NodeID: "6TrZhT",
              Type: "Album",
              Name: "wildlife",
              Uri: "/api/v2/node/6TrZhT",
              Uris: { Album: "/api/v2/album/WZTmc4" },
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }

      if (url === "https://api.smugmug.com/api/v2/node/6TrZhT?_filteruri=NodeComments") {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            NodeID: "6TrZhT",
            Type: "Album",
            Name: "wildlife",
            Uri: "/api/v2/node/6TrZhT",
            Uris: {
              Album: "/api/v2/album/WZTmc4",
              NodeComments: "/api/v2/node/6TrZhT!comments",
            },
          },
        });
      }

      if (url.startsWith("https://api.smugmug.com/api/v2/node/6TrZhT!comments")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Comment: {
              Uri: "/api/v2/comment/13689262",
              Comment: "Dogfood comment.",
              Name: "Prashant Naik",
              Status: "Approved",
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }

      if (url.includes("/api/v2/album/WZTmc4!images")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: { AlbumImage: [], Pages: { Total: 0, Start: 1, Count: 0 } },
        });
      }

      return new Response(`missing mock for ${url}`, { status: 404 });
    };

    const client = new SmugMugApiClient({
      credentials,
      fetchImpl,
      requestIntervalMs: 0,
    });
    const exportDoc = await client.crawlExport();
    expect(exportDoc.Comments).toHaveLength(1);
    expect(exportDoc.Comments?.[0]).toMatchObject({
      sourceId: "13689262",
      targetType: "portfolio",
      targetSourceId: "6TrZhT",
    });

    const bundle = await collectEntities(enumerateSmugMugEntities({ client }));
    expect(bundleCounts(bundle).comments).toBe(1);
    expect(bundle.comments[0]?.target).toEqual({ type: "portfolio", sourceId: "6TrZhT" });
  });

  it("does not invent !comments when relation URIs are absent after filteruri", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requested.push(url);

      if (url === "https://api.smugmug.com/api/v2!authuser") {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            User: {
              NickName: "demo",
              Uri: "/api/v2/user/demo",
              Uris: { Node: { Uri: "/api/v2/node/root" } },
            },
          },
        });
      }
      if (url.startsWith("https://api.smugmug.com/api/v2/node/root!children")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            Node: {
              NodeID: "album-a",
              Type: "Album",
              Name: "A",
              Uri: "/api/v2/node/album-a",
              Uris: { Album: { Uri: "/api/v2/album/alb-a" } },
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }
      if (url === "https://api.smugmug.com/api/v2/node/album-a?_filteruri=NodeComments") {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            NodeID: "album-a",
            Type: "Album",
            Name: "A",
            Uri: "/api/v2/node/album-a",
            Uris: { Album: { Uri: "/api/v2/album/alb-a" } },
          },
        });
      }
      if (url.includes("/api/v2/album/alb-a!images")) {
        return json({
          Code: 200,
          Message: "Ok",
          Response: {
            AlbumImage: {
              ImageKey: "img-1",
              FileName: "one.jpg",
              ArchivedUri: "https://photos.smugmug.com/one.jpg",
            },
            Pages: { Total: 1, Start: 1, Count: 1 },
          },
        });
      }
      return new Response(`missing ${url}`, { status: 404 });
    };

    const client = new SmugMugApiClient({
      credentials,
      fetchImpl,
      requestIntervalMs: 0,
    });
    const doc = await client.crawlExport();
    expect(doc.Comments).toEqual([]);
    expect(requested.some((u) => u.includes("_filteruri=NodeComments"))).toBe(true);
    expect(requested.some((u) => u.includes("!comments"))).toBe(false);
  });
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
