export type BuilderHtmlTag = "img" | "video" | "iframe";

/** Bucket 1 — shortcodes that carry asset metadata → standard HTML. */
export interface BuilderContentRule {
  /** Opening shortcode token, e.g. `tatsu_image`, `et_pb_image`. */
  shortcodePrefix: string;
  urlParams: string[];
  tag: BuilderHtmlTag;
}

/** Per-theme registry entry — declarative map executed by the flatten engine. */
export interface BuilderThemeConfig {
  id: string;
  /** Activates this theme when the raw content matches. */
  detect: RegExp;
  contentRules: BuilderContentRule[];
  /** Bucket 2 — strip `[prefix…]` / `[/prefix…]` scaffolding shortcodes. */
  scaffoldingPrefix: string;
}

export const WORDPRESS_BUILDER_REGISTRY: BuilderThemeConfig[] = [
  {
    id: "tatsu",
    detect: /\[(?:\/)?tatsu_/i,
    contentRules: [
      { shortcodePrefix: "tatsu_image", urlParams: ["image", "url", "src"], tag: "img" },
      { shortcodePrefix: "tatsu_video", urlParams: ["video", "src", "url"], tag: "video" },
    ],
    scaffoldingPrefix: "tatsu_",
  },
  {
    id: "divi",
    detect: /\[(?:\/)?et_pb_/i,
    contentRules: [{ shortcodePrefix: "et_pb_image", urlParams: ["src", "url"], tag: "img" }],
    scaffoldingPrefix: "et_pb_",
  },
  {
    id: "elementor",
    detect: /\[(?:\/)?elementor[-_]/i,
    contentRules: [
      { shortcodePrefix: "elementor-widget", urlParams: ["url", "src", "image"], tag: "img" },
    ],
    scaffoldingPrefix: "elementor_",
  },
];
