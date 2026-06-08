/** Mock SmugMug export shape for CI fixtures (not raw API wire format). */

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
}

export interface SmugMugMockAlbum {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  url?: string;
  images: SmugMugMockImage[];
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

export interface SmugMugFlatExport {
  exportVersion: string | number;
  exportedAt?: string;
  Folders: SmugMugFlatFolder[];
  Albums: SmugMugFlatAlbum[];
  Images: SmugMugFlatImage[];
}

export type SmugMugExportDocument = SmugMugMockExport | SmugMugFlatExport;
