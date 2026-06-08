export type WixFeedFormat = "rss" | "atom";

export interface WixPost {
  id: string;
  title: string;
  slug: string;
  url?: string;
  excerpt?: string;
  contentHtml: string;
  publishedAt?: string;
  status?: "draft" | "published" | "archived";
  categorySlugs?: string[];
  tagSlugs?: string[];
  featuredImageUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface WixPage {
  id: string;
  title: string;
  slug: string;
  url?: string;
  contentHtml: string;
  isHomePage?: boolean;
  status?: "draft" | "published" | "archived";
  seoTitle?: string;
  seoDescription?: string;
}

export interface WixCategory {
  id: string;
  name: string;
  slug: string;
}

export interface WixTag {
  id: string;
  name: string;
  slug: string;
}

/** Canonical collected document shared by W0 JSON fixtures, W1 API, and W2 snapshots. */
export interface WixExport {
  exportVersion: 1;
  exportedAt?: string;
  site?: { url?: string; siteId?: string; title?: string };
  posts?: WixPost[];
  pages?: WixPage[];
  categories?: WixCategory[];
  tags?: WixTag[];
}

export interface WixSnapshotTarget {
  url: string;
  isHomePage?: boolean;
  title?: string;
  slug?: string;
  /** Offline/test hook — use fixture HTML instead of fetching `url`. */
  html?: string;
}

export interface WixSnapshotGap {
  url: string;
  code: "empty_extract" | "login_wall" | "fetch_failed";
  message: string;
}
