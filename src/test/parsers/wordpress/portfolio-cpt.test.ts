import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../../normalizer/bundle.js";
import { DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS, wordpressAdapter } from "../../../parsers/wordpress/index.js";
import { validateWxrFile } from "../../../parsers/wordpress/parse-wxr.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/wordpress");

describe("WordPress portfolio CPT (OSS-18)", () => {
  const minimalFixture = join(FIXTURES_ROOT, "portfolio-cpt-minimal.xml");

  it("exports DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS with portfolio", () => {
    expect(DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS).toContain("portfolio");
  });

  it("validateWxrFile counts portfolioCpt items", async () => {
    const result = await validateWxrFile(minimalFixture);
    expect(result.ok).toBe(true);
    expect(result.summary.portfolioCpt).toBe(1);
  });

  it("emits portfolio CPT as NormalizedPage with portfolio:{id} sourceId", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: minimalFixture } }),
    );

    expect(bundleCounts(bundle).pages).toBe(1);
    expect(bundleCounts(bundle).portfolios).toBe(0);

    const page = bundle.pages[0];
    expect(page.sourceId).toBe("portfolio:99");
    expect(page.source.id).toBe("portfolio:99");
    expect(page.source.postType).toBe("portfolio");
    expect(page.slug).toBe("into-the-dark");
    expect(page.contentHtml).toContain('data-layout="section"');
    expect(page.contentHtml).not.toMatch(/\[tatsu_/i);
  });

  it("respects custom portfolioCptSlugs", async () => {
    const customXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Custom CPT</title>
  <link>https://example.com</link>
  <wp:wxr_version>1.2</wp:wxr_version>
  <item>
    <title>Case Study</title>
    <link>https://example.com/?post_type=project&amp;p=7</link>
    <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
    <wp:post_id>7</wp:post_id>
    <wp:post_name>case-study</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>project</wp:post_type>
  </item>
</channel>
</rss>`;

    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "portfolio-cpt-"));
    const filePath = join(dir, "project-cpt.xml");
    await writeFile(filePath, customXml, "utf8");

    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({
        input: { path: filePath, portfolioCptSlugs: ["project"] },
      }),
    );

    expect(bundle.pages).toHaveLength(1);
    expect(bundle.pages[0]?.sourceId).toBe("portfolio:7");
    expect(bundle.pages[0]?.source.postType).toBe("project");
  });
});
