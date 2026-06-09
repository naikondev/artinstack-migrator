import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { flattenWordPressBuilders } from "../../parsers/wordpress/builders/flatten.js";
import { htmlToGrapes } from "./index.js";

const GRAPES_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/grapes",
);
const WP_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/wordpress",
);

describe("htmlToGrapes", () => {
  it("keeps inline text tags inside text components", () => {
    const result = htmlToGrapes("<p>Hello <strong>world</strong></p>");

    expect(result.content).toEqual([
      {
        type: "text",
        tagName: "p",
        content: "Hello <strong>world</strong>",
      },
    ]);
    expect(result.styles).toEqual([]);
  });

  it("extracts global CSS into root styles", () => {
    const result = htmlToGrapes(`
      <style>.hero { color: red; }</style>
      <div class="hero">Title</div>
    `);

    expect(result.styles).toEqual([
      {
        selectors: [".hero"],
        style: { color: "red" },
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "default",
        tagName: "div",
        classes: ["hero"],
        components: [{ type: "textnode", content: "Title" }],
      },
    ]);
    expect(result.contentCss).toBe(".hero { color: red; }");
    expect(result.contentHtml).toBe('<div class="hero">Title</div>');
  });

  it("maps source classes to Grapes component types", () => {
    const result = htmlToGrapes('<div class="sqs-block">Block</div>', {
      componentMap: { "sqs-block": "section" },
    });

    expect(result.content).toEqual([
      {
        type: "section",
        tagName: "div",
        classes: ["sqs-block"],
        components: [{ type: "textnode", content: "Block" }],
      },
    ]);
  });

  it("maps HTML tag names via tagMap", () => {
    const result = htmlToGrapes("<h2>Title</h2><p>Body</p><table><tr><td>Cell</td></tr></table>", {
      tagMap: {
        h2: "heading",
        p: "paragraph",
        table: "table-block",
        td: "table-cell",
      },
    });

    expect(result.content[0]).toMatchObject({ type: "heading", tagName: "h2", content: "Title" });
    expect(result.content[1]).toMatchObject({ type: "paragraph", tagName: "p", content: "Body" });
    expect(result.content[2]?.type).toBe("table-block");
    const cell = result.content[2]?.components?.[0]?.components?.[0]?.components?.[0];
    expect(cell).toMatchObject({ type: "table-cell", tagName: "td", content: "Cell" });
  });

  it("prefers componentMap over tagMap when both match", () => {
    const result = htmlToGrapes('<div class="sqs-block">Block</div>', {
      tagMap: { div: "generic-div" },
      componentMap: { "sqs-block": "section" },
    });

    expect(result.content[0]?.type).toBe("section");
  });

  it("preserves table structure as nested components", () => {
    const result = htmlToGrapes("<table><tr><td>Cell</td></tr></table>");

    expect(result.content).toEqual([
      {
        type: "default",
        tagName: "table",
        components: [
          {
            type: "default",
            tagName: "tbody",
            components: [
              {
                type: "default",
                tagName: "tr",
                components: [
                  {
                    type: "text",
                    tagName: "td",
                    content: "Cell",
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("creates image components for img tags", () => {
    const result = htmlToGrapes('<img src="https://example.com/a.jpg" alt="Hero" />');

    expect(result.content).toEqual([
      {
        type: "image",
        tagName: "img",
        attributes: {
          src: "https://example.com/a.jpg",
          alt: "Hero",
        },
        void: true,
      },
    ]);
  });

  it("maps OSS-2 data-layout markers to section/row/column components", () => {
    const html = readFileSync(join(GRAPES_FIXTURES, "html/data-layout-tree.html"), "utf8");
    const result = htmlToGrapes(html);

    expect(result.content).toHaveLength(1);
    const section = result.content[0];
    expect(section?.type).toBe("section");
    expect(section?.attributes).toEqual({ "data-bg-image": "https://example.com/hero.jpg" });
    expect(section?.attributes).not.toHaveProperty("data-layout");

    const rows = section?.components ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.type).toBe("row");
    expect(rows[0]?.attributes).toEqual({ "data-cols": "2" });
    expect(rows[1]?.attributes).toEqual({ "data-cols": "3" });

    const twoCol = rows[0]?.components ?? [];
    expect(twoCol[0]?.type).toBe("column");
    expect(twoCol[0]?.components?.[0]?.type).toBe("text");
    expect(twoCol[1]?.components?.[0]?.type).toBe("image");

    const threeCol = rows[1]?.components ?? [];
    expect(threeCol.every((col) => col.type === "column")).toBe(true);
    expect(threeCol[0]?.attributes).toEqual({ "data-col-width": "33.33%" });
  });

  it("supports host layoutTypeMap overrides for data-layout markers", () => {
    const html =
      '<div data-layout="section"><div data-layout="row" data-cols="2">' +
      '<div data-layout="column"><p>A</p></div></div></div>';
    const result = htmlToGrapes(html, {
      layoutTypeMap: {
        section: "section-wrapper",
        row: "column-row",
        column: "column-cell",
      },
    });

    expect(result.content[0]?.type).toBe("section-wrapper");
    expect(result.content[0]?.components?.[0]?.type).toBe("column-row");
    expect(result.content[0]?.components?.[0]?.components?.[0]?.type).toBe("column-cell");
  });

  it("converts flattened naikonpixels about excerpt to nested layout components", () => {
    const xml = readFileSync(
      join(WP_FIXTURES, "naikonpixels.WordPress.Pages.2026-06-09.xml"),
      "utf8",
    );
    const match = xml.match(
      /<link>[^<]*\/about\/<\/link>[\s\S]*?<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/,
    );
    if (!match?.[1]) throw new Error("about page not found");

    const { html } = flattenWordPressBuilders(match[1]);
    const snapshot = htmlToGrapes(html, {
      layoutTypeMap: {
        section: "section-wrapper",
        row: "column-row",
        column: "column-cell",
      },
    });

    const sectionCount = countComponentType(snapshot.content, "section-wrapper");
    const rowCount = countComponentType(snapshot.content, "column-row");
    const colCount = countComponentType(snapshot.content, "column-cell");

    expect(sectionCount).toBeGreaterThanOrEqual(4);
    expect(rowCount).toBeGreaterThanOrEqual(3);
    expect(colCount).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(snapshot.content)).toContain("data-cols");
    expect(JSON.stringify(snapshot.content)).not.toContain('"data-layout"');
  });
});

function countComponentType(components: { type: string; components?: unknown[] }[], type: string): number {
  let count = 0;
  for (const component of components) {
    if (component.type === type) count += 1;
    if (component.components?.length) {
      count += countComponentType(component.components as { type: string; components?: unknown[] }[], type);
    }
  }
  return count;
}
