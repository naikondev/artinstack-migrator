import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { flattenWordPressBuilders } from "../../parsers/wordpress/builders/flatten.js";
import { htmlToTiptap } from "../../transformers/html-to-tiptap/index.js";
import { validateTiptapDoc } from "../../transformers/validate-tiptap-doc.js";

const TIPTAP_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/tiptap",
);
const WP_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/wordpress",
);

describe("htmlToTiptap", () => {
  it("maps inline marks inside paragraphs", () => {
    const result = htmlToTiptap("<p>Hello <strong>world</strong></p>");

    expect(result).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
  });

  it("maps headings with level attrs", () => {
    const result = htmlToTiptap("<h2>Section title</h2>");

    expect(result.content[0]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section title" }],
    });
  });

  it("creates block-level image nodes", () => {
    const result = htmlToTiptap('<img src="https://example.com/a.jpg" alt="Hero" />');

    expect(result.content[0]).toEqual({
      type: "image",
      attrs: { src: "https://example.com/a.jpg", alt: "Hero" },
    });
  });

  it("preserves video widget stubs as embed blocks", () => {
    const html =
      '<div data-wp-widget="video" data-video-provider="youtube" data-embed-url="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ">&#8203;</div>';
    const result = htmlToTiptap(html);

    expect(result.content[0]).toEqual({
      type: "embed",
      attrs: {
        src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        provider: "youtube",
        dataWpWidget: "video",
        dataEmbedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        dataVideoProvider: "youtube",
      },
    });
  });

  it("preserves YouTube iframes as embed blocks", () => {
    const result = htmlToTiptap(
      '<iframe src="https://www.youtube.com/embed/ABC123xyz" width="560" height="315"></iframe>',
    );

    expect(result.content[0]).toEqual({
      type: "embed",
      attrs: {
        src: "https://www.youtube-nocookie.com/embed/ABC123xyz",
        provider: "youtube",
        dataWpWidget: "video",
        dataEmbedUrl: "https://www.youtube-nocookie.com/embed/ABC123xyz",
        dataVideoProvider: "youtube",
      },
    });
  });

  it("unwraps data-layout scaffolding into prose blocks", () => {
    const html = readFileSync(join(TIPTAP_FIXTURES, "html/data-layout-unwrap.html"), "utf8");
    const result = htmlToTiptap(html);

    expect(JSON.stringify(result)).not.toContain("data-layout");
    expect(result.content.some((node) => node.type === "image")).toBe(true);
    expect(result.content.filter((node) => node.type === "paragraph")).toHaveLength(2);
  });

  it("splits paragraph around inline images", () => {
    const result = htmlToTiptap('<p>Before<img src="https://example.com/a.jpg" alt="" />After</p>');

    expect(result.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "image", attrs: { src: "https://example.com/a.jpg", alt: "" } },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
  });

  it("returns empty paragraph for blank input", () => {
    expect(htmlToTiptap("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("passes validateTiptapDoc structural check", () => {
    const html = readFileSync(join(TIPTAP_FIXTURES, "html/editorial-post.html"), "utf8");
    const doc = htmlToTiptap(html);
    const result = validateTiptapDoc(doc);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  });

  it("converts flattened naikonpixels post excerpt to editable prose", () => {
    const xml = readFileSync(
      join(WP_FIXTURES, "naikonpixels.WordPress.Posts.2026-06-07.xml"),
      "utf8",
    );
    const match = xml.match(
      /<wp:post_name><!\[CDATA\[under-which-i-spoke-to-mom\]\]><\/wp:post_name>[\s\S]*?<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/,
    );
    if (!match?.[1]) throw new Error("under-which-i-spoke-to-mom post not found");

    const { html } = flattenWordPressBuilders(match[1]);
    const doc = htmlToTiptap(html);

    expect(doc.type).toBe("doc");
    expect(doc.content.length).toBeGreaterThan(0);
    expect(doc.content.some((node) => node.type === "image")).toBe(true);
    expect(doc.content.some((node) => node.type === "paragraph")).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("data-layout");
    expect(JSON.stringify(doc)).not.toMatch(/\[tatsu_/);
  });
});
