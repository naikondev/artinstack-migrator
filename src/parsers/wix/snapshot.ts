import * as cheerio from "cheerio";
import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import { linkToPath, sanitizeSlug } from "../../lib/utility.js";
import type { WixPage, WixSnapshotGap, WixSnapshotTarget } from "./types.js";

export const MAIN_CONTENT_SELECTORS = [
  "main",
  "article",
  '[role="main"]',
  "#SITE_PAGES main",
  "#site-root main",
  "#PAGES_CONTAINER",
  "body",
] as const;

export const wixSnapshotClientOptionsSchema = z.object({
  fetchImpl: z.custom<typeof fetch>().optional(),
  maxRetries: z.number().int().min(0).max(5).default(2),
  retryBaseDelayMs: z.number().int().min(0).default(300),
  requestIntervalMs: z.number().int().min(0).default(150),
});

export type WixSnapshotClientOptions = z.input<typeof wixSnapshotClientOptionsSchema>;

export interface WixSnapshotResult {
  pages: WixPage[];
  gaps: WixSnapshotGap[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugFromUrl(url: string, fallback: string): string {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last) return sanitizeSlug(last);
  } catch {
    // fall through
  }
  return sanitizeSlug(fallback);
}

function looksLikeLoginWall($: cheerio.CheerioAPI, html: string): boolean {
  const lower = html.toLowerCase();
  if (lower.includes("members-login") || lower.includes("login-bar")) return true;
  if ($('input[type="password"]').length > 0 && $('form[action*="login"]').length > 0) return true;
  if ($('[data-testid="sign-in"]').length > 0) return true;
  return false;
}

function pickMainRoot($: cheerio.CheerioAPI) {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const match = $(selector).first();
    if (match.length > 0) return match;
  }
  return $("body");
}

/** Extract primary page copy from published HTML (cheerio only — no Puppeteer). */
export function extractMainContentHtml(html: string): {
  contentHtml: string;
  title?: string;
  empty: boolean;
  loginWall: boolean;
} {
  const $ = cheerio.load(html, { xml: false });
  const loginWall = looksLikeLoginWall($, html);
  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    undefined;

  const root = pickMainRoot($);
  root.find("script, style, noscript, nav, header, footer, iframe").remove();

  const contentHtml = root.html()?.trim() ?? "";
  const textOnly = root.text().replace(/\s+/g, " ").trim();
  const empty = textOnly.length < 20;

  return { contentHtml, title, empty, loginWall };
}

/** Parse newline-delimited or comma-separated URL lists. */
export function parseUrlList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && /^https?:\/\//i.test(entry));
}

/** Parse `<loc>` entries from a sitemap XML document. */
export function parseSitemapUrls(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  const doc = parser.parse(xml) as {
    urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
    sitemapindex?: { sitemap?: Array<{ loc?: string }> | { loc?: string } };
  };

  const urls: string[] = [];
  const urlEntries = doc.urlset?.url;
  if (urlEntries) {
    const list = Array.isArray(urlEntries) ? urlEntries : [urlEntries];
    for (const entry of list) {
      if (entry.loc) urls.push(entry.loc.trim());
    }
  }

  const sitemapEntries = doc.sitemapindex?.sitemap;
  if (sitemapEntries) {
    const list = Array.isArray(sitemapEntries) ? sitemapEntries : [sitemapEntries];
    for (const entry of list) {
      if (entry.loc) urls.push(entry.loc.trim());
    }
  }

  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
}

export async function loadUrlListFile(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf8");
  if (raw.trim().startsWith("<")) return parseSitemapUrls(raw);
  return parseUrlList(raw);
}

export class WixPageSnapshotCollector {
  readonly fetchImpl: typeof fetch;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly requestIntervalMs: number;

  private lastRequestAt = 0;

  constructor(options: WixSnapshotClientOptions = {}) {
    const parsed = wixSnapshotClientOptionsSchema.parse(options);
    this.fetchImpl = parsed.fetchImpl ?? fetch;
    this.maxRetries = parsed.maxRetries;
    this.retryBaseDelayMs = parsed.retryBaseDelayMs;
    this.requestIntervalMs = parsed.requestIntervalMs;
  }

  async collectPages(targets: WixSnapshotTarget[]): Promise<WixSnapshotResult> {
    const pages: WixPage[] = [];
    const gaps: WixSnapshotGap[] = [];

    for (const target of targets) {
      let html: string;
      try {
        html = target.html ?? (await this.fetchHtml(target.url));
      } catch (error) {
        gaps.push({
          url: target.url,
          code: "fetch_failed",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const extracted = extractMainContentHtml(html);
      if (extracted.loginWall) {
        gaps.push({
          url: target.url,
          code: "login_wall",
          message: "Page appears to require authentication",
        });
        continue;
      }

      if (extracted.empty) {
        gaps.push({
          url: target.url,
          code: "empty_extract",
          message: "No meaningful content found in main/article containers",
        });
        continue;
      }

      const title = target.title ?? extracted.title ?? "Untitled";
      const slug = target.slug ?? slugFromUrl(target.url, title);
      pages.push({
        id: `page:${slug}`,
        title,
        slug,
        url: target.url,
        contentHtml: extracted.contentHtml,
        isHomePage: target.isHomePage,
        status: "published",
      });
    }

    return { pages, gaps };
  }

  async collectFromUrlList(urls: string[]): Promise<WixSnapshotResult> {
    return this.collectPages(
      urls.map((url, index) => ({
        url,
        isHomePage: index === 0 && new URL(url).pathname === "/",
      })),
    );
  }

  private async fetchHtml(url: string): Promise<string> {
    let attempt = 0;
    while (true) {
      await this.throttle();
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });

      if (response.ok) {
        return response.text();
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        throw new Error(`Snapshot fetch HTTP ${response.status} for ${url}`);
      }

      await sleep(this.retryBaseDelayMs * 2 ** attempt);
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

export function mapSnapshotPageToSourcePath(page: WixPage): string | undefined {
  return linkToPath(page.url);
}
