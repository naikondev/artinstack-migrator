import * as cheerio from "cheerio";

import type { EntityBundle } from "../normalizer/bundle.js";
import { discoverRawImgSrcs, normalizeAssetUrl } from "../lib/content-asset-urls.js";
export interface DuplicateSlugConflict {
  entityType: "post" | "page";
  slug: string;
  sourceIds: string[];
}

export interface MissingFeaturedImageConflict {
  postSourceId: string;
  featuredMediaSourceId: string;
  reason: string;
}

export interface StaleAssetUrlConflict {
  sourceId: string;
  url: string;
  reason: string;
}

export interface InvalidHtmlConflict {
  entityType: "post" | "page";
  sourceId: string;
  issues: string[];
}

export interface UnresolvedInlineImageConflict {
  postOrPageSourceId: string;
  src: string;
}

export interface RedirectLoopConflict {
  fromPath: string;
  toPath: string;
  blocked: boolean;
}

export interface ConflictReport {
  duplicatePostSlugs: DuplicateSlugConflict[];
  duplicatePageSlugs: DuplicateSlugConflict[];
  missingFeaturedImages: MissingFeaturedImageConflict[];
  staleAssetUrls: StaleAssetUrlConflict[];
  invalidHtml: InvalidHtmlConflict[];
  unresolvedInlineImages: UnresolvedInlineImageConflict[];
  redirectLoops: RedirectLoopConflict[];
}

export function emptyConflictReport(): ConflictReport {
  return {
    duplicatePostSlugs: [],
    duplicatePageSlugs: [],
    missingFeaturedImages: [],
    staleAssetUrls: [],
    invalidHtml: [],
    unresolvedInlineImages: [],
    redirectLoops: [],
  };
}

function findDuplicateSlugs(
  items: { sourceId: string; slug: string }[],
  entityType: "post" | "page",
): DuplicateSlugConflict[] {
  const bySlug = new Map<string, string[]>();
  for (const item of items) {
    const list = bySlug.get(item.slug) ?? [];
    list.push(item.sourceId);
    bySlug.set(item.slug, list);
  }

  const conflicts: DuplicateSlugConflict[] = [];
  for (const [slug, sourceIds] of bySlug) {
    if (sourceIds.length > 1) {
      conflicts.push({ entityType, slug, sourceIds });
    }
  }
  return conflicts;
}

function analyzeHtml(html: string): string[] {
  const issues: string[] = [];
  if (/<script\b/i.test(html)) {
    issues.push("script_tag_present");
  }

  try {
    const $ = cheerio.load(html, { xml: false });
    $("p").each((_, el) => {
      const inner = $(el).html() ?? "";
      if (inner.includes("<p")) {
        issues.push("nested_paragraph");
      }
    });
  } catch {
    issues.push("html_parse_error");
  }

  return [...new Set(issues)];
}

function mediaUrlSet(bundle: EntityBundle): Set<string> {
  const urls = new Set<string>();
  for (const asset of bundle.media) {
    const normalized = normalizeAssetUrl(asset.sourceUrl);
    if (normalized) urls.add(normalized);
    urls.add(asset.sourceUrl);
  }
  return urls;
}

function findUnresolvedInlineImages(
  sourceId: string,
  contentHtml: string,
  mediaUrls: Set<string>,
): UnresolvedInlineImageConflict[] {
  const conflicts: UnresolvedInlineImageConflict[] = [];
  for (const raw of discoverRawImgSrcs(contentHtml)) {
    const normalized = normalizeAssetUrl(raw);
    if (!normalized) continue;
    if (!mediaUrls.has(normalized) && !mediaUrls.has(raw)) {
      conflicts.push({ postOrPageSourceId: sourceId, src: raw });
    }
  }
  return conflicts;
}

export function analyzeConflicts(
  bundle: EntityBundle,
  options?: {
    staleAssetUrls?: StaleAssetUrlConflict[];
    redirectLoops?: RedirectLoopConflict[];
  },
): ConflictReport {
  const report = emptyConflictReport();
  const mediaUrls = mediaUrlSet(bundle);

  report.duplicatePostSlugs = findDuplicateSlugs(bundle.posts, "post");
  report.duplicatePageSlugs = findDuplicateSlugs(bundle.pages, "page");

  for (const post of bundle.posts) {
    if (post.sourceFeaturedMediaId && !post.featuredAssetSourceId) {
      report.missingFeaturedImages.push({
        postSourceId: post.sourceId,
        featuredMediaSourceId: post.sourceFeaturedMediaId,
        reason: "attachment_not_in_export",
      });
    }

    const htmlIssues = analyzeHtml(post.contentHtml);
    if (htmlIssues.length) {
      report.invalidHtml.push({
        entityType: "post",
        sourceId: post.sourceId,
        issues: htmlIssues,
      });
    }

    report.unresolvedInlineImages.push(
      ...findUnresolvedInlineImages(post.sourceId, post.contentHtml, mediaUrls),
    );
  }

  for (const page of bundle.pages) {
    const htmlIssues = analyzeHtml(page.contentHtml);
    if (htmlIssues.length) {
      report.invalidHtml.push({
        entityType: "page",
        sourceId: page.sourceId,
        issues: htmlIssues,
      });
    }

    report.unresolvedInlineImages.push(
      ...findUnresolvedInlineImages(page.sourceId, page.contentHtml, mediaUrls),
    );
  }

  if (options?.staleAssetUrls) {
    report.staleAssetUrls = options.staleAssetUrls;
  }
  if (options?.redirectLoops) {
    report.redirectLoops = options.redirectLoops;
  }

  return report;
}

export function hasBlockingConflicts(report: ConflictReport): boolean {
  return report.duplicatePageSlugs.length > 0 || report.redirectLoops.some((r) => r.blocked);
}

export function hasWarnings(report: ConflictReport): boolean {
  return (
    report.duplicatePostSlugs.length > 0 ||
    report.missingFeaturedImages.length > 0 ||
    report.staleAssetUrls.length > 0 ||
    report.invalidHtml.length > 0 ||
    report.unresolvedInlineImages.length > 0
  );
}

export function buildRedirectMap(bundle: EntityBundle): {
  fromPath: string;
  toPath: string;
  statusCode: number;
}[] {
  const redirects: { fromPath: string; toPath: string; statusCode: number }[] = [];

  for (const post of bundle.posts) {
    const from = post.source.path;
    if (!from) continue;
    const to = `/blog/${post.slug}`;
    if (from.replace(/\/$/, "") === to.replace(/\/$/, "")) continue;
    redirects.push({ fromPath: from, toPath: to, statusCode: 301 });
  }

  for (const page of bundle.pages) {
    const from = page.source.path;
    if (!from) continue;
    const to = `/${page.slug}`;
    if (from.replace(/\/$/, "") === to.replace(/\/$/, "")) continue;
    redirects.push({ fromPath: from, toPath: to, statusCode: 301 });
  }

  return redirects;
}

export function detectRedirectLoops(
  redirects: { fromPath: string; toPath: string }[],
): RedirectLoopConflict[] {
  const loops: RedirectLoopConflict[] = [];
  for (const row of redirects) {
    if (row.fromPath.replace(/\/$/, "") === row.toPath.replace(/\/$/, "")) {
      loops.push({ fromPath: row.fromPath, toPath: row.toPath, blocked: true });
    }
  }
  return loops;
}
