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

export const smugMugConsumerCredentialsSchema = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
});

export type SmugMugConsumerCredentials = z.infer<typeof smugMugConsumerCredentialsSchema>;

export const smugMugCredentialsSchema = smugMugConsumerCredentialsSchema.extend({
  accessToken: z.string().min(1),
  accessTokenSecret: z.string().min(1),
});

export type SmugMugCredentials = z.infer<typeof smugMugCredentialsSchema>;

/** Material for HMAC-SHA1 signing — token fields omitted/empty during request-token phase. */
export type SmugMugOAuthSigningMaterial = {
  consumerKey: string;
  consumerSecret: string;
  accessToken?: string;
  /** Empty string (or omitted) for `getRequestToken`. */
  accessTokenSecret?: string;
};

export type SmugMugOAuthTokenPair = {
  token: string;
  tokenSecret: string;
};

export type SmugMugRequestTokenResult = SmugMugOAuthTokenPair & {
  callbackConfirmed: boolean;
};

export type SmugMugAccessLevel = "Full" | "Public";
export type SmugMugPermissionLevel = "Read" | "Add" | "Modify";

export type SmugMugAuthorizeUrlOptions = {
  requestToken: string;
  /** SmugMug Access query param (default Full for migration crawl). */
  access?: SmugMugAccessLevel;
  /** SmugMug Permissions query param (default Modify for migration crawl). */
  permissions?: SmugMugPermissionLevel;
  allowThirdPartyLogin?: boolean;
  showSignUpButton?: boolean;
  username?: string;
};

export type SmugMugOAuthSession = {
  requestToken: string;
  requestTokenSecret: string;
  authorizeUrl: string;
  callbackConfirmed: boolean;
};

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

/** Normalize SmugMug list payloads — one child is often a bare object, not an array. */
export function asSmugMugList<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

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

/** SmugMug URI link — string when `_shorturis` is used, otherwise `{ Uri }`. */
type SmugMugUriLink = string | { Uri?: string };

interface SmugMugUserWire {
  NickName?: string;
  Uri: string;
  Uris: { Node: SmugMugUriLink };
}

interface SmugMugNodeWire {
  NodeID: string;
  Type: "Folder" | "Album" | "Page" | string;
  Name: string;
  Description?: string;
  UrlName?: string;
  WebUri?: string;
  Uri: string;
  Uris?: { Album?: SmugMugUriLink; ChildNodes?: SmugMugUriLink };
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
  ImageSizeDetails?: {
    OriginalImageUrl?: string;
    ImageSizeOriginal?: { Url?: string };
  };
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

/** Build OAuth 1.0a HMAC-SHA1 signature for a SmugMug API or handshake request. */
export function signSmugMugOAuthRequest(input: {
  method: string;
  url: string;
  credentials: SmugMugOAuthSigningMaterial;
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
  // Request-token phase uses consumerSecret& (empty token secret).
  const tokenSecret = input.credentials.accessTokenSecret ?? "";
  const signingKey = `${oauthPercentEncode(input.credentials.consumerSecret)}&${oauthPercentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(signatureBase).digest("base64");
}

function buildOAuthParams(
  credentials: SmugMugOAuthSigningMaterial,
  nonce: string,
  timestamp: string,
  extras?: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
    ...(extras ?? {}),
  };
  if (credentials.accessToken) {
    params.oauth_token = credentials.accessToken;
  }
  return params;
}

export function buildSmugMugAuthorizationHeader(input: {
  method: string;
  url: string;
  credentials: SmugMugOAuthSigningMaterial;
  nonce?: string;
  timestamp?: string;
  bodyParams?: Record<string, string>;
  /** Extra oauth_* params (e.g. oauth_callback, oauth_verifier). */
  oauthExtras?: Record<string, string>;
}): string {
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const oauthParams = buildOAuthParams(input.credentials, nonce, timestamp, input.oauthExtras);
  const signature = signSmugMugOAuthRequest({
    method: input.method,
    url: input.url,
    credentials: input.credentials,
    oauthParams,
    bodyParams: input.bodyParams,
  });
  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const headerValue = Object.keys(headerParams)
    .sort()
    .map((key) => `${oauthPercentEncode(key)}="${oauthPercentEncode(headerParams[key]!)}"`)
    .join(", ");
  return `OAuth ${headerValue}`;
}

/** Parse `application/x-www-form-urlencoded` OAuth token responses. */
export function parseSmugMugOAuthFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body.trim());
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function requireOAuthFormField(fields: Record<string, string>, name: string): string {
  const value = fields[name]?.trim();
  if (!value) {
    throw new Error(`SmugMug OAuth response missing ${name}`);
  }
  return value;
}

async function postSmugMugOAuthTokenEndpoint(input: {
  url: string;
  credentials: SmugMugOAuthSigningMaterial;
  oauthExtras?: Record<string, string>;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
}): Promise<Record<string, string>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorization = buildSmugMugAuthorizationHeader({
    method: "POST",
    url: input.url,
    credentials: input.credentials,
    oauthExtras: input.oauthExtras,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });
  const response = await fetchImpl(input.url, {
    method: "POST",
    headers: {
      Accept: "application/x-www-form-urlencoded",
      Authorization: authorization,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `SmugMug OAuth HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return parseSmugMugOAuthFormBody(body);
}

/**
 * Step 1 — temporary credentials.
 * Signs with consumer secret + empty token secret; includes `oauth_callback` (URL or `oob`).
 */
export async function getSmugMugRequestToken(input: {
  consumer: SmugMugConsumerCredentials;
  callbackUrl: string;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
}): Promise<SmugMugRequestTokenResult> {
  const consumer = smugMugConsumerCredentialsSchema.parse(input.consumer);
  const callbackUrl = input.callbackUrl.trim();
  if (!callbackUrl) {
    throw new Error("SmugMug OAuth callbackUrl is required (use a URL or \"oob\")");
  }

  const fields = await postSmugMugOAuthTokenEndpoint({
    url: SMUGMUG_OAUTH_ENDPOINTS.requestToken,
    credentials: {
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      accessTokenSecret: "",
    },
    oauthExtras: { oauth_callback: callbackUrl },
    fetchImpl: input.fetchImpl,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });

  return {
    token: requireOAuthFormField(fields, "oauth_token"),
    tokenSecret: requireOAuthFormField(fields, "oauth_token_secret"),
    callbackConfirmed: fields.oauth_callback_confirmed === "true",
  };
}

/** Step 2 — browser authorize URL (host redirects the photographer here). */
export function buildSmugMugAuthorizeUrl(options: SmugMugAuthorizeUrlOptions): string {
  const requestToken = options.requestToken.trim();
  if (!requestToken) {
    throw new Error("SmugMug authorize URL requires requestToken");
  }

  const url = new URL(SMUGMUG_OAUTH_ENDPOINTS.authorize);
  url.searchParams.set("oauth_token", requestToken);
  url.searchParams.set("Access", options.access ?? "Full");
  url.searchParams.set("Permissions", options.permissions ?? "Modify");
  if (options.allowThirdPartyLogin !== undefined) {
    url.searchParams.set("allowThirdPartyLogin", options.allowThirdPartyLogin ? "1" : "0");
  }
  if (options.showSignUpButton !== undefined) {
    url.searchParams.set("showSignUpButton", options.showSignUpButton ? "true" : "false");
  }
  if (options.username?.trim()) {
    url.searchParams.set("username", options.username.trim());
  }
  return url.toString();
}

/**
 * Step 3 — exchange request token + verifier for long-lived access credentials.
 * Signs with consumer secret + request token secret.
 */
export async function getSmugMugAccessToken(input: {
  consumer: SmugMugConsumerCredentials;
  requestToken: SmugMugOAuthTokenPair;
  verifier: string;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
}): Promise<SmugMugOAuthTokenPair> {
  const consumer = smugMugConsumerCredentialsSchema.parse(input.consumer);
  const token = input.requestToken.token.trim();
  const tokenSecret = input.requestToken.tokenSecret;
  const verifier = input.verifier.trim();
  if (!token || tokenSecret === undefined || tokenSecret === null) {
    throw new Error("SmugMug access-token exchange requires request token + secret");
  }
  if (!verifier) {
    throw new Error("SmugMug access-token exchange requires oauth_verifier");
  }

  const fields = await postSmugMugOAuthTokenEndpoint({
    url: SMUGMUG_OAUTH_ENDPOINTS.accessToken,
    credentials: {
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      accessToken: token,
      accessTokenSecret: tokenSecret,
    },
    oauthExtras: { oauth_verifier: verifier },
    fetchImpl: input.fetchImpl,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });

  return {
    token: requireOAuthFormField(fields, "oauth_token"),
    tokenSecret: requireOAuthFormField(fields, "oauth_token_secret"),
  };
}

/**
 * Connect-UI start helper: request token + authorize URL.
 * Host stores `requestTokenSecret` in session/cookie for the callback → `getSmugMugAccessToken`.
 */
export async function createSmugMugOAuthSession(input: {
  consumerKey: string;
  consumerSecret: string;
  callbackUrl: string;
  access?: SmugMugAccessLevel;
  permissions?: SmugMugPermissionLevel;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
}): Promise<SmugMugOAuthSession> {
  const request = await getSmugMugRequestToken({
    consumer: {
      consumerKey: input.consumerKey,
      consumerSecret: input.consumerSecret,
    },
    callbackUrl: input.callbackUrl,
    fetchImpl: input.fetchImpl,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });

  return {
    requestToken: request.token,
    requestTokenSecret: request.tokenSecret,
    authorizeUrl: buildSmugMugAuthorizeUrl({
      requestToken: request.token,
      access: input.access,
      permissions: input.permissions,
    }),
    callbackConfirmed: request.callbackConfirmed,
  };
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

/**
 * Resolve a SmugMug URI link. Default API responses use `{ Uri, Locator, … }`;
 * `_shorturis` responses use a bare string.
 */
export function resolveSmugMugUriLink(link: SmugMugUriLink | null | undefined, label: string): string {
  if (typeof link === "string" && link.trim()) return link.trim();
  if (link && typeof link === "object") {
    const uri = link.Uri;
    if (typeof uri === "string" && uri.trim()) return uri.trim();
  }
  throw new Error(`SmugMug response missing ${label} URI`);
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
  const sizeDetails = image?.ImageSizeDetails;
  const originalUrl =
    sizeDetails?.OriginalImageUrl ??
    sizeDetails?.ImageSizeOriginal?.Url ??
    albumImage.LargestImage?.Url ??
    albumImage.WebUri;
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

  /** Validate credentials against `GET /api/v2!authuser`. */
  async validateCredentials(): Promise<{ nick?: string; rootNodeUri: string }> {
    const user = await this.getAuthUser();
    return {
      nick: user.NickName,
      rootNodeUri: resolveSmugMugUriLink(user.Uris.Node, "User.Uris.Node"),
    };
  }

  /** Crawl the authenticated user's node tree into flat export tables for `parse-node.ts`. */
  async crawlExport(): Promise<SmugMugFlatExport> {
    const user = await this.getAuthUser();
    const folders: SmugMugFlatFolder[] = [];
    const albums: SmugMugFlatAlbum[] = [];
    const images: SmugMugFlatImage[] = [];

    const rootNodeUri = resolveSmugMugUriLink(user.Uris.Node, "User.Uris.Node");
    await this.walkNode(rootNodeUri, undefined, folders, albums, images);

    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      Folders: folders,
      Albums: albums,
      Images: images,
    };
  }

  private async getAuthUser(): Promise<SmugMugUserWire> {
    // Documented special endpoint is `/api/v2!authuser` (not `/api/v2/user/!authuser`).
    const envelope = await this.requestJson<SmugMugUserWire & { User?: SmugMugUserWire }>(
      `${SMUGMUG_API_BASE}!authuser`,
    );
    // Envelope may flatten User fields onto Response, or nest under Response.User.
    if (envelope.Response.User?.Uris?.Node != null) {
      return envelope.Response.User;
    }
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
        const albumUri = await this.resolveAlbumUri(child);
        if (albumUri) {
          await this.collectAlbumImages(albumUri, child.NodeID, images);
        }
      }
    }
  }

  /**
   * Album nodes usually expose `Uris.Album`; if missing, re-fetch the node with `_filteruri=Album`.
   */
  private async resolveAlbumUri(child: SmugMugNodeWire): Promise<string | null> {
    if (child.Uris?.Album != null) {
      return resolveSmugMugUriLink(child.Uris.Album, "Node.Uris.Album");
    }
    try {
      const envelope = await this.requestJson<
        SmugMugNodeWire & { Node?: SmugMugNodeWire }
      >(`${child.Uri}?_filteruri=Album`);
      const node = envelope.Response.Node ?? envelope.Response;
      if (node.Uris?.Album != null) {
        return resolveSmugMugUriLink(node.Uris.Album, "Node.Uris.Album");
      }
    } catch {
      // fall through
    }
    return null;
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
    for await (const page of this.paginate<{ Node?: SmugMugNodeWire | SmugMugNodeWire[] }>(path)) {
      for (const node of asSmugMugList(page.Node)) {
        yield node;
      }
    }
  }

  private async *paginateAlbumImages(path: string): AsyncGenerator<SmugMugAlbumImageWire> {
    for await (const page of this.paginate<{
      AlbumImage?: SmugMugAlbumImageWire | SmugMugAlbumImageWire[];
    }>(path)) {
      for (const albumImage of asSmugMugList(page.AlbumImage)) {
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

  /**
   * OAuth-signed GET for private original/media URLs (and API endpoints).
   * Hosts should prefer this over anonymous `fetch` when downloading vault images.
   */
  async fetchAuthenticated(
    url: string,
    options?: { accept?: string },
  ): Promise<Response> {
    return this.requestWithRetry(toAbsoluteUrl(url), {
      accept: options?.accept ?? "*/*",
    });
  }

  /** Convenience: signed GET → bytes (for MigrationSink `resolveAssetStream`). */
  async fetchAuthenticatedBytes(
    url: string,
  ): Promise<{ body: Uint8Array; contentType: string | undefined; contentLength: number }> {
    const response = await this.fetchAuthenticated(url);
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      body: buffer,
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength: buffer.byteLength,
    };
  }

  private async requestJson<T>(pathOrUrl: string): Promise<SmugMugApiEnvelope<T>> {
    const url = toAbsoluteUrl(pathOrUrl);
    const response = await this.requestWithRetry(url, { accept: "application/json" });
    const body = (await response.json()) as SmugMugApiEnvelope<T>;
    if (body.Code !== 200) {
      throw new Error(`SmugMug API error ${body.Code}: ${body.Message}`);
    }
    return body;
  }

  private async requestWithRetry(
    url: URL,
    options?: { accept?: string },
  ): Promise<Response> {
    let attempt = 0;
    const accept = options?.accept ?? "application/json";
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
          Accept: accept,
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
