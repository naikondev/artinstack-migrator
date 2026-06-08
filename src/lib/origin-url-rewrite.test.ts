import { describe, expect, it } from "vitest";

import {
  createWpContentGatewayRewrite,
  rewriteOriginUrlsInText,
} from "./origin-url-rewrite.js";

describe("rewriteOriginUrlsInText", () => {
  it("replaces gateway wp-content paths with public origin", () => {
    const config = createWpContentGatewayRewrite(
      "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod",
      "https://naikonpixels.com",
    );
    const raw =
      '[tatsu_image image= "https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod/wp-content/uploads/2022/05/photo.jpg"]';
    expect(rewriteOriginUrlsInText(raw, config)).toContain(
      "https://naikonpixels.com/wp-content/uploads/2022/05/photo.jpg",
    );
  });

  it("supports regex rules", () => {
    const result = rewriteOriginUrlsInText("https://staging.example/a.jpg", {
      rules: [{ match: /staging\.example/, replace: "cdn.example" }],
    });
    expect(result).toBe("https://cdn.example/a.jpg");
  });
});
