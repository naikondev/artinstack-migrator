import { createHmac, randomBytes } from "node:crypto";

import { z } from "zod";

import type { SmugMugFlatAlbum, SmugMugFlatExport, SmugMugFlatFolder, SmugMugFlatImage } from "./types.js";

/** SmugMug API v2 base (OAuth 1.0a). No secrets — inject credentials at runtime. */
export const SMUGMUG_API_HOST = "api.smugmug.com";
export const SMUGMUG_API_BASE = `https://${SMUGMUG_API_HOST}/api/v2`;

export const SMUGMUG_OAUTH_ENDPOINTS = {
  requestToken: "https://api.smugmug.com/services/oauth/1.0a/getRequestToken",
  authorize: "https://api.smugmug.com/services/oauth/1.0a/authorize",
  accessToken: "https://api.smugmug.com/services/oauth/1.0a/getAccessToken",
} as const;

export const smugMugCredentialsSchema = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  accessToken: z.string().min(1),
  accessTokenSecret: z.string().min(1),
});

export type SmugMugCredentials = z.infer<typeof smugMugCredentialsSchema>;

export const smugMugClientOptionsSchema = z.object({
  credentials: smugMugCredentialsSchema,
  pageSize: z.number().int().min(1).max(500).default(100),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryBaseDelayMs: z.number().int().min(0).default(500),
  maxRetryDelayMs: z.number().int().min(0).default(8000),
  requestIntervalMs: z.number().int().min(0).default(200),
  fetchImpl: z.custom<typeof fetch>().optional(),
});

export type SmugMugClientOptions = z.input<typeof smugMugClientOptionsSchema>;

const ALBUM_IMAGES_CONFIG = {
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
            ImageSizeDetails: {
              filter: ["OriginalImageUrl"],
            },
          },
        },
      },
    },
  },
};

interface SmugMugPages {
  Total?: number;
  Start?: number;
  Count?: number;
  NextPage?: string;
}

interface SmugMugApiEnvelope<T> {
  Response: T & { Pages?: SmugMugPages; Uri?: string };
  Code: number;
  Message: string;
}

interface SmugMugUserWire {
  NickName?: string;
  Uri: string;
  Uris: { Node: string };
}

interface SmugMugNodeWire {
  NodeID: string;
  Type: "Folder" | "Album" | "Page" | string;
  Name: string;
  Description?: string;
  UrlName?: string;
  WebUri?: string;
  Uri: string;
  Uris?: { Album?: string; ChildNodes?: string };
}

interface SmugMugImageMetadataWire {
  ISO?: number | string;
  Aperture?: number | string;
  ApertureValue?: number | string;
  ShutterSpeed?: string;
  ExposureTime?: string;
  FocalLength?: number | string;
}

interface SmugMugImageWire {
  FileName?: string;
  Caption?: string;
  KeywordsArray?: string[];
  ImageMetadata?: SmugMugImageMetadataWire;
  ImageSizeDetails?: { OriginalImageUrl?: string };
}

interface SmugMugAlbumImageWire {
  ImageKey: string;
  Caption?: string;
  FileName?: string;
  WebUri?: string;
  Image?: SmugMugImageWire;
  LargestImage?: { Url?: string };
  ImageMetadata?: SmugMugImageMetadataWire;
}

/** RFC 3986 encoding used by OAuth 1.0a parameter normalization. */
export function oauthPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeRequestUrl(url: URL): string {
  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  const host = url.hostname.toLowerCase();
  const defaultPort = protocol === "http" ? "80" : "443";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  return `${protocol}://${host}${port}${url.pathname}`;
}

function sortedParameterString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1))
    .map((key) => `${oauthPercentEncode(key)}=${oauthPercentEncode(params[key]!)}`)
    .join("&");
}

function collectSignatureParams(
  url: URL,
  oauthParams: Record<string, string>,
  bodyParams?: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = { ...oauthParams };
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  if (bodyParams) {
    for (const [key, value] of Object.entries(bodyParams)) {
      params[key] = value;
    }
  }
  return params;
}

/** Build OAuth 1.0a HMAC-SHA1 signature for a SmugMug API request. */
export function signSmugMugOAuthRequest(input: {
  method: string;
  url: string;
  credentials: SmugMugCredentials;
  oauthParams: Record<string, string>;
  bodyParams?: Record<string, string>;
}): string {
  const url = new URL(input.url);
  const parameterString = sortedParameterString(
    collectSignatureParams(url, input.oauthParams, input.bodyParams),
  );
  const signatureBase = [
    input.method.toUpperCase(),
    oauthPercentEncode(normalizeRequestUrl(url)),
    oauthPercentEncode(parameterString),
  ].join("&");
  const signingKey = `${oauthPercentEncode(input.credentials.consumerSecret)}&${oauthPercentEncode(input.credentials.accessTokenSecret)}`;
  return createHmac("sha1", signingKey).update(signatureBase).digest("base64");
}

function buildOAuthParams(credentials: SmugMugCredentials, nonce: string, timestamp: string) {
  return {
    oauth_consumer_key: credentials.consumerKey,
    oauth_token: credentials.accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };
}

export function buildSmugMugAuthorizationHeader(input: {
  method: string;
  url: string;
  credentials: SmugMugCredentials;
  nonce?: string;
  timestamp?: string;
  bodyParams?: Record<string, string>;
}): string {
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const oauthParams = buildOAuthParams(input.credentials, nonce, timestamp);
  const signature = signSmugMugOAuthRequest({
    method: input.method,
    url: input.url,
    credentials: input.credentials,
    oauthParams,
    bodyParams: input.bodyParams,
  });
  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerValue = Object.keys(headerParams)
    .sort()
    .map((key) => `${oauthPercentEncode(key)}="${oauthPercentEncode(headerParams[key as keyof typeof headerParams]!)}"`)
    .join(", ");
  return `OAuth ${headerValue}`;
}

export function readSmugMugCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmugMugCredentials {
  return smugMugCredentialsSchema.parse({
    consumerKey: env.SMUGMUG_CONSUMER_KEY,
    consumerSecret: env.SMUGMUG_CONSUMER_SECRET,
    accessToken: env.SMUGMUG_ACCESS_TOKEN,
    accessTokenSecret: env.SMUGMUG_ACCESS_TOKEN_SECRET,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function albumKeyFromUri(uri: string): string {
  const match = uri.match(/\/album\/([^/?!]+)/i);
  if (!match?.[1]) {
    throw new Error(`Unable to parse album key from URI: ${uri}`);
  }
  return match[1];
}

function nodeIdFromUri(uri: string): string {
  const match = uri.match(/\/node\/([^/?!]+)/i);
  if (!match?.[1]) {
    throw new Error(`Unable to parse node id from URI: ${uri}`);
  }
  return match[1];
}

function mapAlbumImage(
  albumImage: SmugMugAlbumImageWire,
  portfolioSourceId: string,
  sort: number,
): SmugMugFlatImage {
  const image = albumImage.Image;
  const metadata = image?.ImageMetadata ?? albumImage.ImageMetadata;
  const originalUrl =
    image?.ImageSizeDetails?.OriginalImageUrl ?? albumImage.LargestImage?.Url ?? albumImage.WebUri;
  const fileName = image?.FileName ?? albumImage.FileName;
  return {
    sourceId: albumImage.ImageKey,
    portfolioSourceId,
    sort,
    fileName,
    originalUrl,
    caption: albumImage.Caption ?? image?.Caption,
    keywords: image?.KeywordsArray?.length ? image.KeywordsArray : undefined,
    exif: metadata
      ? {
          iso: metadata.ISO,
          aperture: metadata.Aperture ?? metadata.ApertureValue,
          shutter: metadata.ShutterSpeed ?? metadata.ExposureTime,
          focalLength: metadata.FocalLength,
        }
      : undefined,
  };
}

/** Signed SmugMug API client — recursively discovers folders, albums, and images. */
export class SmugMugApiClient {
  readonly credentials: SmugMugCredentials;
  readonly pageSize: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly requestIntervalMs: number;
  readonly fetchImpl: typeof fetch;

  private lastRequestAt = 0;

  constructor(options: SmugMugClientOptions) {
    const parsed = smugMugClientOptionsSchema.parse(options);
    this.credentials = parsed.credentials;
    this.pageSize = parsed.pageSize;
    this.maxRetries = parsed.maxRetries;
    this.retryBaseDelayMs = parsed.retryBaseDelayMs;
    this.maxRetryDelayMs = parsed.maxRetryDelayMs;
    this.requestIntervalMs = parsed.requestIntervalMs;
    this.fetchImpl = parsed.fetchImpl ?? fetch;
  }

  /** Validate credentials against `GET /user/!authuser`. */
  async validateCredentials(): Promise<{ nick?: string; rootNodeUri: string }> {
    const user = await this.getAuthUser();
    return { nick: user.NickName, rootNodeUri: user.Uris.Node };
  }

  /** Crawl the authenticated user's node tree into flat export tables for `parse-node.ts`. */
  async crawlExport(): Promise<SmugMugFlatExport> {
    const user = await this.getAuthUser();
    const folders: SmugMugFlatFolder[] = [];
    const albums: SmugMugFlatAlbum[] = [];
    const images: SmugMugFlatImage[] = [];

    await this.walkNode(user.Uris.Node, undefined, folders, albums, images);

    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      Folders: folders,
      Albums: albums,
      Images: images,
    };
  }

  private async getAuthUser(): Promise<SmugMugUserWire> {
    const envelope = await this.requestJson<SmugMugUserWire>(`${SMUGMUG_API_BASE}/user/!authuser`);
    return envelope.Response;
  }

  private async walkNode(
    nodeUri: string,
    parentFolderId: string | undefined,
    folders: SmugMugFlatFolder[],
    albums: SmugMugFlatAlbum[],
    images: SmugMugFlatImage[],
  ): Promise<void> {
    const childrenPath = `${nodeUri}!children`;
    for await (const child of this.paginateNodes(childrenPath)) {
      if (child.Type === "Page") continue;

      if (child.Type === "Folder") {
        folders.push({
          sourceId: child.NodeID,
          name: child.Name,
          parentSourceId: parentFolderId,
          slug: child.UrlName,
          description: child.Description,
        });
        await this.walkNode(child.Uri, child.NodeID, folders, albums, images);
        continue;
      }

      if (child.Type === "Album") {
        albums.push({
          sourceId: child.NodeID,
          name: child.Name,
          parentSourceId: parentFolderId,
          slug: child.UrlName,
          description: child.Description,
          url: child.WebUri,
        });
        const albumUri = child.Uris?.Album;
        if (albumUri) {
          await this.collectAlbumImages(albumUri, child.NodeID, images);
        }
      }
    }
  }

  private async collectAlbumImages(
    albumUri: string,
    portfolioSourceId: string,
    images: SmugMugFlatImage[],
  ): Promise<void> {
    const albumKey = albumKeyFromUri(albumUri);
    const configQuery = `_config=${encodeURIComponent(JSON.stringify(ALBUM_IMAGES_CONFIG))}`;
    const initialPath = `${SMUGMUG_API_BASE}/album/${albumKey}!images?${configQuery}`;

    let sort = 0;
    for await (const albumImage of this.paginateAlbumImages(initialPath)) {
      images.push(mapAlbumImage(albumImage, portfolioSourceId, sort));
      sort += 1;
    }
  }

  private async *paginateNodes(path: string): AsyncGenerator<SmugMugNodeWire> {
    for await (const page of this.paginate<{ Node?: SmugMugNodeWire[] }>(path)) {
      for (const node of page.Node ?? []) {
        yield node;
      }
    }
  }

  private async *paginateAlbumImages(path: string): AsyncGenerator<SmugMugAlbumImageWire> {
    for await (const page of this.paginate<{ AlbumImage?: SmugMugAlbumImageWire[] }>(path)) {
      for (const albumImage of page.AlbumImage ?? []) {
        yield albumImage;
      }
    }
  }

  private async *paginate<T extends Record<string, unknown>>(
    initialPath: string,
  ): AsyncGenerator<T> {
    let nextPath: string | undefined = appendPagination(initialPath, this.pageSize, 1);
    while (nextPath) {
      const envelope: SmugMugApiEnvelope<T> = await this.requestJson<T>(nextPath);
      yield envelope.Response;
      nextPath = envelope.Response.Pages?.NextPage;
    }
  }

  private async requestJson<T>(pathOrUrl: string): Promise<SmugMugApiEnvelope<T>> {
    const url = toAbsoluteUrl(pathOrUrl);
    const response = await this.requestWithRetry(url);
    const body = (await response.json()) as SmugMugApiEnvelope<T>;
    if (body.Code !== 200) {
      throw new Error(`SmugMug API error ${body.Code}: ${body.Message}`);
    }
    return body;
  }

  private async requestWithRetry(url: URL): Promise<Response> {
    let attempt = 0;
    while (true) {
      await this.throttle();
      const authorization = buildSmugMugAuthorizationHeader({
        method: "GET",
        url: url.toString(),
        credentials: this.credentials,
      });
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
        },
      });

      if (response.ok) {
        return response;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `SmugMug HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }

      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs * 2 ** attempt);
      await sleep(delay);
      attempt += 1;
    }
  }

  private async throttle(): Promise<void> {
    if (this.requestIntervalMs <= 0) return;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.requestIntervalMs) {
      await sleep(this.requestIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

function toAbsoluteUrl(pathOrUrl: string): URL {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return new URL(pathOrUrl);
  }
  if (pathOrUrl.startsWith("/")) {
    return new URL(`https://${SMUGMUG_API_HOST}${pathOrUrl}`);
  }
  return new URL(pathOrUrl);
}

function appendPagination(pathOrUrl: string, count: number, start: number): string {
  const url = toAbsoluteUrl(pathOrUrl);
  url.searchParams.set("count", String(count));
  url.searchParams.set("start", String(start));
  return url.toString();
}

/** @internal Exported for crawl tests — resolves root node id from user node URI. */
export function smugMugRootNodeIdFromUserNodeUri(nodeUri: string): string {
  return nodeIdFromUri(nodeUri);
}
