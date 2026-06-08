import { describe, expect, it } from "vitest";

import { htmlToGrapes } from "./index.js";

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
});
