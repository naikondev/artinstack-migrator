import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities } from "../../../normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../../../normalizer/portfolio-media.js";
import {
  SmugMugApiClient,
  SMUGMUG_OAUTH_ENDPOINTS,
  buildSmugMugAuthorizeUrl,
  buildSmugMugAuthorizationHeader,
  createSmugMugOAuthSession,
  getSmugMugAccessToken,
  getSmugMugRequestToken,
  oauthPercentEncode,
  parseSmugMugOAuthFormBody,
  signSmugMugOAuthRequest,
} from "../../../parsers/smugmug/api.js";
import { smugmugAdapter } from "../../../parsers/smugmug/index.js";
import {
  enumerateSmugMugEntities,
  isSmugMugFlatExport,
  loadSmugMugExport,
  summarizeSmugMugExport,
} from "../../../parsers/smugmug/parse-node.js";
import type { SmugMugMockExport } from "../../../parsers/smugmug/types.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/smugmug");

const nestedExport: SmugMugMockExport = {
  exportVersion: "1",
  folders: [
    {
      id: "folder-a",
      name: "Travel",
      albums: [
        {
          id: "album-1",
          name: "Iceland",
          images: [
            {
              id: "img-1",
              fileName: "aurora.jpg",
              originalUrl: "https://example.com/aurora.jpg",
              exif: { iso: 3200, aperture: 2.8, shutter: "15s", focalLength: 24 },
            },
          ],
        },
      ],
    },
  ],
};

describe("parse-node (nested fixture tree)", () => {
  it("emits folder portfolio, album portfolio, and asset", async () => {
    const entities = [];
    for await (const entity of enumerateSmugMugEntities({ data: nestedExport })) {
      entities.push(entity);
    }

    expect(entities.map((e) => e.type)).toEqual(["portfolio", "portfolio", "asset"]);
    const asset = entities.find((e) => e.type === "asset");
    expect(asset && asset.type === "asset" && asset.exif?.iso).toBe(3200);
  });

  it("collects into bundle with parent/child portfolios", async () => {
    const bundle = await collectEntities(enumerateSmugMugEntities({ data: nestedExport }));
    expect(bundle.portfolios).toHaveLength(2);
    expect(bundle.media).toHaveLength(1);
    expect(bundle.media[0]?.portfolioSourceId).toBe("album-1");
  });

  it("summarizes export counts", () => {
    expect(summarizeSmugMugExport(nestedExport)).toEqual({
      folders: 1,
      albums: 1,
      assets: 1,
      portfolios: 2,
    });
  });
});

describe("parse-node (flat production dump)", () => {
  it("loads production-portfolio-dump.json", async () => {
    const path = join(FIXTURES_ROOT, "production-portfolio-dump.json");
    const doc = await loadSmugMugExport({ filePath: path });
    expect(isSmugMugFlatExport(doc)).toBe(true);
  });

  it("parses nested folder hierarchy and coerces EXIF", async () => {
    const bundle = await collectEntities(
      smugmugAdapter.enumerateEntities({
        input: { path: join(FIXTURES_ROOT, "production-portfolio-dump.json") },
      }),
    );

    expect(bundle.portfolios).toHaveLength(6);
    expect(bundle.media).toHaveLength(7);

    const subFolder = bundle.portfolios.find((p) => p.sourceId === "f-sub-astro");
    expect(subFolder?.parentSourceId).toBe("f-north-georgia");

    const mwImage = bundle.media.find((a) => a.sourceId === "img-mw-pano-01");
    expect(mwImage?.exif?.iso).toBe(6400);
    expect(mwImage?.exif?.aperture).toBe(1.8);
    expect(mwImage?.exif?.focalLength).toBe(24);

    expect(buildPortfolioMediaLinks(bundle)).toHaveLength(7);

    const unresolved = bundle.media.find((a) => a.sourceId === "img-corrupted-edgecase");
    expect(unresolved?.sourceUrl).toBe("unspecified://smugmug/img-corrupted-edgecase");
    expect(unresolved?.exif).toBeUndefined();
  });
});

describe("SmugMug API client (OAuth + crawl)", () => {
  const credentials = {
    consumerKey: "test-consumer-key",
    consumerSecret: "test-consumer-secret",
    accessToken: "test-access-token",
    accessTokenSecret: "test-access-token-secret",
  };

  it("percent-encodes OAuth parameter values", () => {
    expect(oauthPercentEncode("hello world")).toBe("hello%20world");
    expect(oauthPercentEncode("a+b")).toBe("a%2Bb");
  });

  it("builds a deterministic HMAC-SHA1 signature", () => {
    const signature = signSmugMugOAuthRequest({
      method: "GET",
      url: "https://api.smugmug.com/api/v2/user/!authuser?count=1&start=1",
      credentials,
      oauthParams: {
        oauth_consumer_key: credentials.consumerKey,
        oauth_token: credentials.accessToken,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_nonce: "fixed-nonce",
        oauth_version: "1.0",
      },
    });
    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(
      signSmugMugOAuthRequest({
        method: "GET",
        url: "https://api.smugmug.com/api/v2/user/!authuser?count=1&start=1",
        credentials,
        oauthParams: {
          oauth_consumer_key: credentials.consumerKey,
          oauth_token: credentials.accessToken,
          oauth_signature_method: "HMAC-SHA1",
          oauth_timestamp: "1318622958",
          oauth_nonce: "fixed-nonce",
          oauth_version: "1.0",
        },
      }),
    ).toBe(signature);
  });

  it("signs request-token phase with empty token secret (no oauth_token)", () => {
    const withEmpty = signSmugMugOAuthRequest({
      method: "POST",
      url: "https://api.smugmug.com/services/oauth/1.0a/getRequestToken",
      credentials: {
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
        accessTokenSecret: "",
      },
      oauthParams: {
        oauth_consumer_key: credentials.consumerKey,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_nonce: "fixed-nonce",
        oauth_version: "1.0",
        oauth_callback: "https://app.example/callback",
      },
    });
    const omittedSecret = signSmugMugOAuthRequest({
      method: "POST",
      url: "https://api.smugmug.com/services/oauth/1.0a/getRequestToken",
      credentials: {
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
      },
      oauthParams: {
        oauth_consumer_key: credentials.consumerKey,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_nonce: "fixed-nonce",
        oauth_version: "1.0",
        oauth_callback: "https://app.example/callback",
      },
    });
    expect(withEmpty).toBe(omittedSecret);
    expect(withEmpty).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("formats Authorization header with oauth_signature", () => {
    const header = buildSmugMugAuthorizationHeader({
      method: "GET",
      url: "https://api.smugmug.com/api/v2/user/!authuser",
      credentials,
      nonce: "abc123",
      timestamp: "1700000000",
    });
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="test-consumer-key"');
    expect(header).toContain("oauth_signature=");
  });

  it("omits oauth_token and includes oauth_callback for request-token headers", () => {
    const header = buildSmugMugAuthorizationHeader({
      method: "POST",
      url: "https://api.smugmug.com/services/oauth/1.0a/getRequestToken",
      credentials: {
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
        accessTokenSecret: "",
      },
      oauthExtras: { oauth_callback: "https://app.example/oauth/callback" },
      nonce: "abc123",
      timestamp: "1700000000",
    });
    expect(header).toContain("oauth_callback=");
    expect(header).not.toContain("oauth_token=");
  });

  it("runs OAuth handshake helpers against mocked endpoints", async () => {
    expect(parseSmugMugOAuthFormBody("oauth_token=rt&oauth_token_secret=rts&oauth_callback_confirmed=true")).toEqual({
      oauth_token: "rt",
      oauth_token_secret: "rts",
      oauth_callback_confirmed: "true",
    });

    const fetchImpl: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      const auth = headers.get("Authorization") ?? "";
      expect(init?.method).toBe("POST");
      expect(auth.startsWith("OAuth ")).toBe(true);

      if (url === SMUGMUG_OAUTH_ENDPOINTS.requestToken) {
        expect(auth).toContain("oauth_callback=");
        expect(auth).not.toContain('oauth_token="');
        return new Response(
          "oauth_token=request-token&oauth_token_secret=request-secret&oauth_callback_confirmed=true",
          { status: 200, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        );
      }

      if (url === SMUGMUG_OAUTH_ENDPOINTS.accessToken) {
        expect(auth).toContain('oauth_token="request-token"');
        expect(auth).toContain("oauth_verifier=");
        return new Response("oauth_token=access-token&oauth_token_secret=access-secret", {
          status: 200,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      }

      return new Response(`unexpected ${url}`, { status: 404 });
    };

    const request = await getSmugMugRequestToken({
      consumer: {
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
      },
      callbackUrl: "https://app.example/oauth/callback",
      fetchImpl,
      nonce: "n1",
      timestamp: "1700000001",
    });
    expect(request).toEqual({
      token: "request-token",
      tokenSecret: "request-secret",
      callbackConfirmed: true,
    });

    const authorizeUrl = buildSmugMugAuthorizeUrl({ requestToken: request.token });
    expect(authorizeUrl).toContain("oauth_token=request-token");
    expect(authorizeUrl).toContain("Access=Full");
    expect(authorizeUrl).toContain("Permissions=Modify");

    const access = await getSmugMugAccessToken({
      consumer: {
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
      },
      requestToken: { token: request.token, tokenSecret: request.tokenSecret },
      verifier: "verifier-123",
      fetchImpl,
      nonce: "n2",
      timestamp: "1700000002",
    });
    expect(access).toEqual({ token: "access-token", tokenSecret: "access-secret" });

    const session = await createSmugMugOAuthSession({
      consumerKey: credentials.consumerKey,
      consumerSecret: credentials.consumerSecret,
      callbackUrl: "https://app.example/oauth/callback",
      fetchImpl,
      nonce: "n3",
      timestamp: "1700000003",
    });
    expect(session.requestToken).toBe("request-token");
    expect(session.requestTokenSecret).toBe("request-secret");
    expect(session.authorizeUrl).toContain("oauth_token=request-token");
    expect(session.callbackConfirmed).toBe(true);
  });

  it("crawls mock API pages into flat export and normalizes entities", async () => {
    const responses = new Map<string, unknown>([
      [
        "https://api.smugmug.com/api/v2/user/!authuser",
        {
          Code: 200,
          Message: "Ok",
          Response: {
            NickName: "demo",
            Uri: "/api/v2/user/demo",
            Uris: { Node: "/api/v2/node/root-node" },
          },
        },
      ],
      [
        "https://api.smugmug.com/api/v2/node/root-node!children?count=100&start=1",
        {
          Code: 200,
          Message: "Ok",
          Response: {
            Node: [
              {
                NodeID: "folder-travel",
                Type: "Folder",
                Name: "Travel",
                UrlName: "travel",
                Uri: "/api/v2/node/folder-travel",
              },
              {
                NodeID: "album-iceland",
                Type: "Album",
                Name: "Iceland",
                UrlName: "iceland",
                WebUri: "https://demo.smugmug.com/Iceland",
                Uri: "/api/v2/node/album-iceland",
                Uris: { Album: "/api/v2/album/alb-key-1" },
              },
            ],
            Pages: { Total: 2, Start: 1, Count: 2 },
          },
        },
      ],
      [
        "https://api.smugmug.com/api/v2/node/folder-travel!children?count=100&start=1",
        {
          Code: 200,
          Message: "Ok",
          Response: { Node: [], Pages: { Total: 0, Start: 1, Count: 0 } },
        },
      ],
    ]);

    const imagesConfig = encodeURIComponent(
      JSON.stringify({
        expand: {
          AlbumImage: {
            expand: {
              Image: {
                filter: ["FileName", "Caption", "KeywordsArray"],
                filteruri: ["ImageMetadata", "ImageSizeDetails"],
                expand: {
                  ImageMetadata: {
                    filter: ["ISO", "Aperture", "ApertureValue", "ShutterSpeed", "ExposureTime", "FocalLength"],
                  },
                  ImageSizeDetails: { filter: ["OriginalImageUrl"] },
                },
              },
            },
          },
        },
      }),
    );

    responses.set(
      `https://api.smugmug.com/api/v2/album/alb-key-1!images?_config=${imagesConfig}&count=100&start=1`,
      {
        Code: 200,
        Message: "Ok",
        Response: {
          AlbumImage: [
            {
              ImageKey: "img-aurora",
              Caption: "Aurora",
              Image: {
                FileName: "aurora.jpg",
                KeywordsArray: ["iceland"],
                ImageSizeDetails: { OriginalImageUrl: "https://photos.smugmug.com/aurora.jpg" },
                ImageMetadata: { ISO: 3200, Aperture: 2.8, ShutterSpeed: "15s", FocalLength: 24 },
              },
            },
          ],
          Pages: { Total: 1, Start: 1, Count: 1 },
        },
      },
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const payload = responses.get(url);
      if (!payload) {
        return new Response(`missing mock for ${url}`, { status: 404 });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new SmugMugApiClient({
      credentials,
      fetchImpl,
      requestIntervalMs: 0,
    });

    const bundle = await collectEntities(
      enumerateSmugMugEntities({
        client,
      }),
    );

    expect(bundle.portfolios).toHaveLength(2);
    expect(bundle.media).toHaveLength(1);
    expect(bundle.media[0]?.sourceUrl).toBe("https://photos.smugmug.com/aurora.jpg");
    expect(bundle.media[0]?.exif?.iso).toBe(3200);
    expect(buildPortfolioMediaLinks(bundle)).toEqual([
      { portfolioSourceId: "album-iceland", assetSourceId: "img-aurora", sort: 0 },
    ]);
  });
});
