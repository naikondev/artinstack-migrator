import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractMainContentHtml, parseSitemapUrls, parseUrlList } from "../../../parsers/wix/snapshot.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/wix");

describe("extractMainContentHtml", () => {
  it("extracts article content and title from Wix-like HTML", () => {
    const html = readFileSync(join(FIXTURES_ROOT, "pages/about.html"), "utf8");
    const result = extractMainContentHtml(html);
    expect(result.loginWall).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.title).toContain("About the Studio");
    expect(result.contentHtml).toContain("Pacific Northwest");
    expect(result.contentHtml).toContain("about-team.jpg");
    expect(result.contentHtml).not.toContain("<footer>");
  });

  it("flags login walls", () => {
    const result = extractMainContentHtml(
      '<html><body><form action="/login"><input type="password" /></form></body></html>',
    );
    expect(result.loginWall).toBe(true);
  });
});

describe("parseUrlList", () => {
  it("parses newline and comma separated URLs", () => {
    expect(parseUrlList("https://a.test\nhttps://b.test,https://c.test")).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
  });
});

describe("parseSitemapUrls", () => {
  it("reads loc entries from urlset", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.wixsite.com/about</loc></url></urlset>`;
    expect(parseSitemapUrls(xml)).toEqual(["https://example.wixsite.com/about"]);
  });
});
