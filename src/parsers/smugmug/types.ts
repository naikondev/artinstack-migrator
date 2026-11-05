/** Mock SmugMug export shape for CI fixtures (not raw API wire format). */

/** Fixture / flat-export comment row (OSS-36). */
export interface SmugMugMockComment {
  id: string;
  body: string;
  parentId?: string;
  authorName?: string;
  authorEmail?: string;
  authorUrl?: string;
  publishedAt?: string;
  /** When omitted, normalize as pending + treat as moderation-absent. */
  approved?: boolean | "1" | "0" | "spam" | "trash" | string;
}

export interface SmugMugMockImage {
  id: string;
  fileName: string;
  originalUrl: string;
  caption?: string;
  keywords?: string[];
  exif?: {
    iso?: number;
    aperture?: number;
    shutter?: string;
    focalLength?: number;
  };
  /** Image-level comments when the source exposes them. */
  comments?: SmugMugMockComment[];
}

export interface SmugMugMockAlbum {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  url?: string;
  images: SmugMugMockImage[];
  /** Album/node-level comments. */
  comments?: SmugMugMockComment[];
}

export interface SmugMugMockFolder {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  albums: SmugMugMockAlbum[];
}

export interface SmugMugMockExport {
  exportVersion: string | number;
  exportedAt?: string;
  user?: { nick?: string; uri?: string };
  folders: SmugMugMockFolder[];
}

/** Flat relational dump (Folders / Albums / Images tables). */
export interface SmugMugFlatFolder {
  sourceId: string;
  name: string;
  parentSourceId?: string;
  slug?: string;
  description?: string;
}

export interface SmugMugFlatAlbum {
  sourceId: string;
  name: string;
  parentSourceId?: string;
  slug?: string;
  description?: string;
  url?: string;
}

export interface SmugMugFlatImage {
  sourceId: string;
  portfolioSourceId: string;
  sort?: number;
  fileName?: string;
  originalUrl?: string;
  caption?: string;
  keywords?: string[];
  exif?: {
    iso?: number | string;
    aperture?: number | string;
    shutter?: string;
    focalLength?: number | string;
  };
}

/** Flat comment table from API crawl or fixture dump. */
export interface SmugMugFlatComment {
  sourceId: string;
  targetType: "portfolio" | "media";
  targetSourceId: string;
  parentSourceId?: string;
  contentHtml: string;
  authorName?: string;
  authorEmail?: string;
  authorUrl?: string;
  publishedAt?: string;
  /** Raw approval/status from source when present. */
  approved?: boolean | string;
}

export interface SmugMugFlatExport {
  exportVersion: string | number;
  exportedAt?: string;
  Folders: SmugMugFlatFolder[];
  Albums: SmugMugFlatAlbum[];
  Images: SmugMugFlatImage[];
  /** OSS-36 — album/node + image comments (may be empty). */
  Comments?: SmugMugFlatComment[];
}

export type SmugMugExportDocument = SmugMugMockExport | SmugMugFlatExport;
