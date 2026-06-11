import { describe, expect, it } from "vitest";

import { ricosToHtml } from "../../../parsers/wix/ricos-to-html.js";

describe("ricosToHtml", () => {
  it("renders paragraphs, headings, images, and links", () => {
    const html = ricosToHtml({
      nodes: [
        {
          type: "HEADING",
          headingData: { level: 2 },
          nodes: [{ type: "TEXT", textData: { text: "Hello" } }],
        },
        {
          type: "PARAGRAPH",
          nodes: [
            {
              type: "TEXT",
              textData: {
                text: "Visit site",
                decorations: [{ type: "LINK", linkData: { link: { url: "https://example.test" } } }],
              },
            },
          ],
        },
        {
          type: "IMAGE",
          imageData: {
            image: {
              src: { url: "https://static.wixstatic.com/media/sample.png" },
              altText: "Sample",
            },
          },
        },
      ],
    });

    expect(html).toContain("<h2>Hello</h2>");
    expect(html).toContain('<a href="https://example.test">Visit site</a>');
    expect(html).toContain('src="https://static.wixstatic.com/media/sample.png"');
  });
});
