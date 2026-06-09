import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { collectEntities, bundleCounts, type EntityBundle } from "../../src/normalizer/bundle.js";
import { createWpContentGatewayRewrite } from "../../src/lib/origin-url-rewrite.js";
import { findWordPressShortcodeMarkers } from "../../src/parsers/wordpress/builders/shortcode-conflicts.js";
import { wordpressAdapter } from "../../src/parsers/wordpress/index.js";
import { htmlToTiptap, type TiptapDoc, type TiptapNode } from "../../src/transformers/html-to-tiptap/index.js";
import { validateTiptapDoc } from "../../src/transformers/validate-tiptap-doc.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)));

const GATEWAY = "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod";
const PUBLIC = "https://www.naikonpixels.com";

function countNodeTypes(nodes: TiptapNode[], counts: Record<string, number> = {}): Record<string, number> {
  for (const node of nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    if (node.content?.length) countNodeTypes(node.content, counts);
  }
  return counts;
}

function postTiptapReport(post: EntityBundle["posts"][number], doc: TiptapDoc) {
  const counts = countNodeTypes(doc.content);
  const html = post.contentHtml ?? "";
  const markers = findWordPressShortcodeMarkers(html);

  return {
    slug: post.slug || `(id:${post.sourceId})`,
    blocks: doc.content.length,
    paragraphs: counts.paragraph ?? 0,
    images: counts.image ?? 0,
    headings: counts.heading ?? 0,
    lists: (counts.bulletList ?? 0) + (counts.orderedList ?? 0),
    layoutSections: (html.match(/data-layout="section"/g) ?? []).length,
    tatsuLeft: (html.match(/\[tatsu_/gi) ?? []).length,
    shortcodes: markers.map((m) => m.shortcode).join(", ") || "-",
  };
}

describe("naikonpixels posts export", () => {
  const postsFixture = join(FIXTURES_ROOT, "naikonpixels.WordPress.Posts.2026-06-07.xml");
  const postsInput = {
    path: postsFixture,
    originUrlRewrite: createWpContentGatewayRewrite(GATEWAY, PUBLIC),
  };

  let bundle: EntityBundle;
  let tiptapBySlug: Map<string, TiptapDoc>;

  beforeAll(async () => {
    bundle = await collectEntities(wordpressAdapter.enumerateEntities({ input: postsInput }));
    tiptapBySlug = new Map(
      bundle.posts.map((post) => [post.slug, htmlToTiptap(post.contentHtml)]),
    );
  });

  it("parses all posts from the fixture export", () => {
    expect(bundleCounts(bundle).posts).toBe(13);
    expect(bundleCounts(bundle).assets).toBeGreaterThan(50);
  });

  it("converts every post to a valid Tiptap doc", () => {
    const failures: string[] = [];

    for (const post of bundle.posts) {
      const doc = tiptapBySlug.get(post.slug);
      if (!doc) {
        failures.push(`${post.slug}: missing Tiptap doc`);
        continue;
      }

      const validation = validateTiptapDoc(doc);
      if (!validation.ok) {
        failures.push(`${post.slug}: ${validation.issues.map((i) => i.message).join("; ")}`);
      }

      const json = JSON.stringify(doc);
      if (json.includes("data-layout")) {
        failures.push(`${post.slug}: data-layout leaked into content_json`);
      }
      if (/\[tatsu_/i.test(json)) {
        failures.push(`${post.slug}: tatsu shortcode leaked into content_json`);
      }
      if (doc.content.length === 0) {
        failures.push(`${post.slug}: empty doc content`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("flattens Tatsu scaffolding in post HTML before Tiptap conversion", () => {
    const failures: string[] = [];

    for (const post of bundle.posts) {
      const html = post.contentHtml ?? "";
      if (/\[tatsu_/i.test(html)) {
        failures.push(`${post.slug}: [tatsu_* shortcodes remain in contentHtml`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("logs per-post Tiptap metrics for the fixture export", () => {
    const reports = bundle.posts
      .map((post) => postTiptapReport(post, tiptapBySlug.get(post.slug)!))
      .sort((a, b) => a.slug.localeCompare(b.slug));

    // Visible when running: pnpm exec vitest run fixtures/wordpress/posts-export.test.ts
    console.table(reports);
    expect(reports.length).toBe(13);
    expect(reports.every((r) => r.blocks > 0)).toBe(true);
  });

  it("preserves images and prose on under-which-i-spoke-to-mom", () => {
    const doc = tiptapBySlug.get("under-which-i-spoke-to-mom");
    expect(doc).toBeDefined();

    const counts = countNodeTypes(doc!.content);
    expect(counts.paragraph).toBeGreaterThan(0);
    expect(counts.image).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).toContain("MoccasinCreek_w_1045.jpg");
  });

  it("unwraps layout scaffolding into prose blocks (no layout nodes in Tiptap)", () => {
    for (const post of bundle.posts) {
      const doc = tiptapBySlug.get(post.slug)!;
      const counts = countNodeTypes(doc.content);
      expect(counts.section).toBeUndefined();
      expect(counts.row).toBeUndefined();
      expect(counts.column).toBeUndefined();
    }
  });

  it("rewrites gateway asset URLs to public origin", () => {
    expect(bundle.media.some((a) => a.sourceUrl.includes("execute-api"))).toBe(false);
    expect(bundle.media.some((a) => a.sourceUrl.startsWith(`${PUBLIC}/wp-content/`))).toBe(true);
  });
});
