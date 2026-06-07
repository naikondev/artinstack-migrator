import * as cheerio from "cheerio";

/** Collect unique img src values from HTML (for conflict / asset discovery). */
export function extractInlineImageSrcs(html: string): string[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html, { xml: false });
  const srcs = new Set<string>();
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src")?.trim();
    if (src && !src.startsWith("data:")) {
      srcs.add(src);
    }
  });
  return [...srcs];
}
