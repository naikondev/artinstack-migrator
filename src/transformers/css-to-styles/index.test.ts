import { describe, expect, it } from "vitest";

import { cssToStyles } from "./index.js";

describe("cssToStyles", () => {
  it("parses class rules into Grapes style entries", () => {
    expect(cssToStyles(".hero { color: red; font-size: 24px; }")).toEqual([
      {
        selectors: [".hero"],
        style: { color: "red", "font-size": "24px" },
      },
    ]);
  });

  it("splits comma-separated selectors", () => {
    expect(cssToStyles(".a, .b { margin: 0; }")).toEqual([
      {
        selectors: [".a", ".b"],
        style: { margin: "0" },
      },
    ]);
  });

  it("strips comments and ignores at-rules", () => {
    const css = `
      /* theme */
      .card { padding: 1rem; }
      @media (min-width: 768px) { .card { padding: 2rem; } }
    `;
    expect(cssToStyles(css)).toEqual([
      {
        selectors: [".card"],
        style: { padding: "1rem" },
      },
    ]);
  });
});
