import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectEntities, bundleCounts } from "../../../normalizer/bundle.js";
import { analyzeConflicts } from "../../../sinks/conflicts.js";
import { runDryRun } from "../../../sinks/dry-run.js";
import {
  summarizeWxrImportFromFile,
  validateWxrFile,
  wordpressAdapter,
} from "../../../parsers/wordpress/index.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/wordpress");

describe("Wxr import summary (OSS-19)", () => {
  const commerceFixture = join(FIXTURES_ROOT, "commerce-only-minimal.xml");

  it("validateWxrFile reports skipped post types and unsupportedOnly", async () => {
    const result = await validateWxrFile(commerceFixture);
    expect(result.ok).toBe(true);
    expect(result.importSummary.importableItemCount).toBe(0);
    expect(result.importSummary.unsupportedOnly).toBe(true);
    expect(result.importSummary.skippedPostTypes).toEqual({
      product: 1,
      product_variation: 1,
      shop_order: 1,
      tatsu_header: 1,
    });
    expect(result.summary.importableItemCount).toBe(0);
  });

  it("enumerate yields empty bundle for commerce-only export", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: commerceFixture } }),
    );
    expect(bundleCounts(bundle).pages).toBe(0);
    expect(bundleCounts(bundle).posts).toBe(0);
    expect(bundleCounts(bundle).assets).toBe(0);
  });

  it("dry-run conflicts surface skippedPostTypes", async () => {
    const result = await runDryRun({
      adapter: wordpressAdapter,
      input: { path: commerceFixture },
      platform: "wordpress",
      offlineStorageEstimate: true,
    });

    expect(result.conflicts.unsupportedOnly).toBe(true);
    expect(result.conflicts.importableItemCount).toBe(0);
    expect(result.conflicts.skippedPostTypes.product).toBe(1);
    expect(result.conflicts.skippedPostTypes.shop_order).toBe(1);
    expect(result.report.summary.unsupportedOnly).toBe(true);
    expect(result.report.summary.skippedPostTypes?.shop_order).toBe(1);
    expect(result.report.warnings.some((w) => w.includes("no importable content"))).toBe(true);
  });

  it("counts WooCommerce stub pages separately from skipped post types", async () => {
    const summary = await summarizeWxrImportFromFile(commerceFixture);
    expect(summary.skippedWooCommerceStubPages).toBeUndefined();

    const stubXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Stub</title><link>https://example.com</link><wp:wxr_version>1.2</wp:wxr_version>
<item>
<title>Cart</title><wp:post_id>1</wp:post_id><wp:post_name>cart</wp:post_name>
<wp:post_type>page</wp:post_type><content:encoded><![CDATA[[woocommerce_cart]]]></content:encoded>
</item>
</channel></rss>`;

    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "wxr-stub-"));
    const filePath = join(dir, "woo-stub.xml");
    await writeFile(filePath, stubXml, "utf8");

    const stubSummary = await summarizeWxrImportFromFile(filePath);
    expect(stubSummary.importableItemCount).toBe(0);
    expect(stubSummary.skippedWooCommerceStubPages).toBe(1);
    expect(stubSummary.skippedPostTypes).toEqual({});
    expect(stubSummary.unsupportedOnly).toBe(false);
  });

  it("portfolio CPT counts as importable, not skipped", async () => {
    const portfolioFixture = join(FIXTURES_ROOT, "portfolio-cpt-minimal.xml");
    const summary = await summarizeWxrImportFromFile(portfolioFixture);
    expect(summary.importableItemCount).toBe(1);
    expect(summary.unsupportedOnly).toBe(false);
    expect(summary.skippedPostTypes).toEqual({});
  });

  it("analyzeConflicts merges adapter import summary", async () => {
    const bundle = await collectEntities(
      wordpressAdapter.enumerateEntities({ input: { path: commerceFixture } }),
    );
    const importSummary = await wordpressAdapter.getImportSummary!({ path: commerceFixture });
    const conflicts = analyzeConflicts(bundle, { wxrImportSummary: importSummary });
    expect(conflicts.skippedPostTypes.tatsu_header).toBe(1);
  });
});
