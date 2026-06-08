import { readFile } from "node:fs/promises";

import { sanitizeSlug } from "../../lib/utility.js";
import type {
  NormalizedAsset,
  NormalizedAssetExif,
  NormalizedEntity,
  NormalizedPortfolio,
  SourceMetadata,
} from "../../normalizer/types.js";
import { SmugMugApiClient, type SmugMugClientOptions, type SmugMugCredentials } from "./api.js";
import type {
  SmugMugExportDocument,
  SmugMugFlatExport,
  SmugMugFlatImage,
  SmugMugMockAlbum,
  SmugMugMockExport,
  SmugMugMockFolder,
} from "./types.js";

const PLATFORM = "smugmug" as const;
const UNRESOLVED_URL_PREFIX = "unspecified://smugmug/";

export interface SmugMugParseOptions {
  filePath?: string;
  data?: SmugMugExportDocument;
  /** Pre-constructed signed API client (live crawl). */
  client?: SmugMugApiClient;
  /** OAuth credentials — builds a client when `client` is omitted. */
  credentials?: SmugMugCredentials;
  /** Optional tuning for credential-backed client. */
  clientOptions?: Omit<SmugMugClientOptions, "credentials">;
}

function sourceMeta(id: string, url?: string, exportedAt?: string): SourceMetadata {
  return {
    platform: PLATFORM,
    id,
    url,
    exportedAt,
  };
}

function guessMime(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return ext ? map[ext] : undefined;
}

function parseExifNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeExif(
  exif: SmugMugFlatImage["exif"] | SmugMugMockAlbum["images"][0]["exif"],
): NormalizedAssetExif | undefined {
  if (!exif || Object.keys(exif).length === 0) return undefined;
  const normalized: NormalizedAssetExif = {
    iso: parseExifNumber(exif.iso),
    aperture: parseExifNumber(exif.aperture),
    shutter: exif.shutter,
    focalLength: parseExifNumber(exif.focalLength),
  };
  if (
    normalized.iso === undefined &&
    normalized.aperture === undefined &&
    !normalized.shutter &&
    normalized.focalLength === undefined
  ) {
    return undefined;
  }
  return normalized;
}

export function isSmugMugFlatExport(value: unknown): value is SmugMugFlatExport {
  if (!value || typeof value !== "object") return false;
  const record = value as SmugMugFlatExport;
  const version = record.exportVersion;
  return (
    (version === 1 || version === "1") &&
    Array.isArray(record.Folders) &&
    Array.isArray(record.Albums) &&
    Array.isArray(record.Images)
  );
}

function isSmugMugNestedExport(value: unknown): value is SmugMugMockExport {
  if (!value || typeof value !== "object") return false;
  const record = value as SmugMugMockExport;
  const version = record.exportVersion;
  return (version === 1 || version === "1") && Array.isArray(record.folders);
}

export async function loadSmugMugExport(options: SmugMugParseOptions): Promise<SmugMugExportDocument> {
  if (options.data) return options.data;
  if (!options.filePath) {
    throw new Error("SmugMug parser requires filePath or data");
  }
  const raw: unknown = JSON.parse(await readFile(options.filePath, "utf8"));
  if (isSmugMugFlatExport(raw) || isSmugMugNestedExport(raw)) {
    return raw;
  }
  throw new Error(
    "Invalid SmugMug export: expected exportVersion 1 with folders[] (nested) or Folders/Albums/Images (flat)",
  );
}

function resolveAssetUrl(image: SmugMugFlatImage): string {
  if (image.originalUrl) return image.originalUrl;
  return `${UNRESOLVED_URL_PREFIX}${image.sourceId}`;
}

function resolveFilename(image: SmugMugFlatImage): string {
  if (image.fileName) return image.fileName;
  return `${image.sourceId}.jpg`;
}

function* emitNestedFolderPortfolio(
  folder: SmugMugMockFolder,
  exportedAt?: string,
): Generator<NormalizedPortfolio> {
  yield {
    type: "portfolio",
    source: sourceMeta(folder.id, undefined, exportedAt),
    sourceId: folder.id,
    title: folder.name,
    slug: sanitizeSlug(folder.slug ?? folder.name),
    description: folder.description,
  };
}

function* emitNestedAlbumPortfolio(
  folder: SmugMugMockFolder,
  album: SmugMugMockAlbum,
  exportedAt?: string,
): Generator<NormalizedPortfolio> {
  yield {
    type: "portfolio",
    source: sourceMeta(album.id, album.url, exportedAt),
    sourceId: album.id,
    title: album.name,
    slug: sanitizeSlug(album.slug ?? album.name),
    description: album.description,
    parentSourceId: folder.id,
  };
}

function* emitNestedAlbumAssets(
  album: SmugMugMockAlbum,
  exportedAt?: string,
): Generator<NormalizedAsset> {
  for (let index = 0; index < album.images.length; index++) {
    const image = album.images[index]!;
    yield {
      type: "asset",
      source: sourceMeta(image.id, image.originalUrl, exportedAt),
      sourceId: image.id,
      sourceUrl: image.originalUrl,
      filename: image.fileName,
      mimeType: guessMime(image.fileName),
      caption: image.caption,
      keywords: image.keywords?.length ? image.keywords : undefined,
      exif: normalizeExif(image.exif),
      portfolioSourceId: album.id,
      sort: index,
    };
  }
}

async function* enumerateNestedExport(
  doc: SmugMugMockExport,
): AsyncGenerator<NormalizedEntity> {
  const exportedAt = doc.exportedAt;
  for (const folder of doc.folders) {
    yield* emitNestedFolderPortfolio(folder, exportedAt);
    for (const album of folder.albums) {
      yield* emitNestedAlbumPortfolio(folder, album, exportedAt);
      yield* emitNestedAlbumAssets(album, exportedAt);
    }
  }
}

async function* enumerateFlatExport(doc: SmugMugFlatExport): AsyncGenerator<NormalizedEntity> {
  const exportedAt = doc.exportedAt;

  for (const folder of doc.Folders) {
    yield {
      type: "portfolio",
      source: sourceMeta(folder.sourceId, undefined, exportedAt),
      sourceId: folder.sourceId,
      title: folder.name,
      slug: sanitizeSlug(folder.slug ?? folder.name),
      description: folder.description,
      parentSourceId: folder.parentSourceId,
    } satisfies NormalizedPortfolio;
  }

  for (const album of doc.Albums) {
    yield {
      type: "portfolio",
      source: sourceMeta(album.sourceId, album.url, exportedAt),
      sourceId: album.sourceId,
      title: album.name,
      slug: sanitizeSlug(album.slug ?? album.name),
      description: album.description,
      parentSourceId: album.parentSourceId,
    } satisfies NormalizedPortfolio;
  }

  for (const image of doc.Images) {
    const filename = resolveFilename(image);
    yield {
      type: "asset",
      source: sourceMeta(image.sourceId, image.originalUrl, exportedAt),
      sourceId: image.sourceId,
      sourceUrl: resolveAssetUrl(image),
      filename,
      mimeType: guessMime(filename),
      caption: image.caption,
      keywords: image.keywords?.length ? image.keywords : undefined,
      exif: normalizeExif(image.exif),
      portfolioSourceId: image.portfolioSourceId,
      sort: image.sort ?? 0,
    } satisfies NormalizedAsset;
  }
}

async function resolveSmugMugDocument(options: SmugMugParseOptions): Promise<SmugMugExportDocument> {
  if (options.data) return options.data;
  if (options.client) return options.client.crawlExport();
  if (options.credentials) {
    const client = new SmugMugApiClient({ credentials: options.credentials, ...options.clientOptions });
    return client.crawlExport();
  }
  return loadSmugMugExport(options);
}

/** Walk discovered SmugMug nodes — fixture JSON or live API crawl via injected credentials. */
export async function* enumerateSmugMugEntities(
  options: SmugMugParseOptions,
): AsyncGenerator<NormalizedEntity> {
  const doc = await resolveSmugMugDocument(options);
  if (isSmugMugFlatExport(doc)) {
    yield* enumerateFlatExport(doc);
    return;
  }
  yield* enumerateNestedExport(doc);
}

export function summarizeSmugMugExport(doc: SmugMugExportDocument): {
  folders: number;
  albums: number;
  assets: number;
  portfolios: number;
} {
  if (isSmugMugFlatExport(doc)) {
    return {
      folders: doc.Folders.length,
      albums: doc.Albums.length,
      assets: doc.Images.length,
      portfolios: doc.Folders.length + doc.Albums.length,
    };
  }

  const folders = doc.folders.length;
  let albums = 0;
  let assets = 0;
  for (const folder of doc.folders) {
    albums += folder.albums.length;
    for (const album of folder.albums) {
      assets += album.images.length;
    }
  }
  return {
    folders,
    albums,
    assets,
    portfolios: folders + albums,
  };
}

export async function validateSmugMugExportFile(filePath: string): Promise<{
  ok: boolean;
  issues: { code: string; message: string }[];
  summary: Record<string, number>;
}> {
  const issues: { code: string; message: string }[] = [];
  let doc: SmugMugExportDocument;
  try {
    doc = await loadSmugMugExport({ filePath });
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid_export",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      summary: {},
    };
  }

  if (isSmugMugFlatExport(doc)) {
    if (doc.Folders.length === 0 && doc.Albums.length === 0) {
      issues.push({ code: "empty_export", message: "No folders or albums in export" });
    }
  } else if (doc.folders.length === 0) {
    issues.push({ code: "empty_export", message: "No folders in export" });
  }

  const summary = summarizeSmugMugExport(doc);
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      portfolios: summary.portfolios,
      assets: summary.assets,
      categories: summary.folders,
      posts: 0,
      pages: 0,
      tags: 0,
    },
  };
}

/** @deprecated Use validateSmugMugExportFile */
export const validateSmugMugMockFile = validateSmugMugExportFile;
