/** Squarespace JSON export shape for fixtures and static HTML snapshot migration. */

export interface SquarespaceGalleryItem {
  id?: string;
  imageUrl: string;
  altText?: string;
  caption?: string;
}

export interface SquarespaceBlock {
  id?: string;
  type: string;
  html?: string;
  value?: string;
  imageUrl?: string;
  altText?: string;
  caption?: string;
  url?: string;
  label?: string;
  embedHtml?: string;
  items?: SquarespaceGalleryItem[];
}

export interface SquarespacePage {
  id: string;
  title: string;
  slug: string;
  url?: string;
  status?: "published" | "draft" | "scheduled";
  isHomePage?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  contentCss?: string;
  /** Pre-rendered snapshot when blocks[] is absent. */
  contentHtml?: string;
  blocks?: SquarespaceBlock[];
}

export interface SquarespacePost {
  id: string;
  title: string;
  slug: string;
  url?: string;
  excerpt?: string;
  publishedAt?: string;
  status?: "published" | "draft" | "scheduled";
  categorySlugs?: string[];
  tagSlugs?: string[];
  featuredImageUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  contentHtml?: string;
  blocks?: SquarespaceBlock[];
}

export interface SquarespaceCategory {
  id: string;
  name: string;
  slug: string;
}

export interface SquarespaceTag {
  id: string;
  name: string;
  slug: string;
}

export interface SquarespaceExport {
  exportVersion: string | number;
  exportedAt?: string;
  site?: { url?: string; title?: string };
  pages: SquarespacePage[];
  posts?: SquarespacePost[];
  categories?: SquarespaceCategory[];
  tags?: SquarespaceTag[];
}
