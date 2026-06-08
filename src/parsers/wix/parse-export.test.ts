import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { detectWixFeedFormat, enumerateWixEntities, isWixFeedXml } from "./parse-export.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/wix");

describe("detectWixFeedFormat", () => {
  it("detects RSS and Atom roots", () => {
    expect(detectWixFeedFormat("<rss><channel></channel></rss>")).toBe("rss");
    expect(detectWixFeedFormat('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toBe("atom");
  });

  it("identifies feed-like XML documents", () => {
    expect(isWixFeedXml("<rss version=\"2.0\"></rss>")).toBe(true);
    expect(isWixFeedXml("<html></html>")).toBe(false);
  });
});

describe("enumerateWixEntities", () => {
  it("extracts Atom entry HTML and normalizes protocol-relative images", async () => {
    const entities = [];
    for await (const entity of enumerateWixEntities({
      filePath: join(FIXTURES_ROOT, "legacy-atom-feed.xml"),
    })) {
      entities.push(entity);
    }

    const assets = entities.filter((e) => e.type === "asset");
    expect(assets).toHaveLength(1);
    expect(assets[0].sourceUrl).toBe("https://static.wixstatic.com/media/welcome-hero.png");
  });
});
