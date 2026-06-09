export type BuilderHtmlTag = "img" | "video" | "iframe";
export type TextHtmlTag = "p" | "h2" | "h3" | "h4" | "h5" | "h6";

/** Bucket 1 — shortcodes with asset URL params → standard HTML. */
export interface BuilderUrlRule {
  shortcodePrefix: string;
  urlParams: string[];
  tag: BuilderHtmlTag;
}

/** Bucket 1 — shortcodes with text params → semantic HTML. */
export interface BuilderTextRule {
  shortcodePrefix: string;
  fields: { param: string; tag: TextHtmlTag }[];
}

/** Bucket 1 — shortcodes with inner HTML (+ optional image param). */
export interface BuilderWrapperRule {
  shortcodePrefix: string;
  urlParams?: string[];
}

/** Bucket 1 — dynamic embeds replaced with a static migration placeholder. */
export interface BuilderPlaceholderRule {
  shortcodePrefix: string;
  html: string;
}

/** Per-theme registry entry — declarative map executed by the flatten engine. */
export interface BuilderThemeConfig {
  id: string;
  /** Activates this theme when the raw content matches. */
  detect: RegExp;
  urlRules?: BuilderUrlRule[];
  textRules?: BuilderTextRule[];
  wrapperRules?: BuilderWrapperRule[];
  placeholderRules?: BuilderPlaceholderRule[];
  /** Bucket 2 — strip `[prefix…]` / `[/prefix…]` scaffolding shortcodes. */
  scaffoldingPrefixes?: string[];
  /** Bucket 2 — legacy Oshine tokens without a shared prefix (section, row, text, …). */
  legacyScaffoldingTokens?: string[];
}

/** Shortcodes that cannot become static HTML — reported in conflicts, never stripped. */
export const UNRESOLVABLE_SHORTCODE_PREFIXES = [
  "portfolio",
  "recent_posts",
  "woocommerce_cart",
  "woocommerce_checkout",
  "woocommerce_my_account",
] as const;

export const WORDPRESS_BUILDER_REGISTRY: BuilderThemeConfig[] = [
  {
    id: "tatsu",
    detect: /\[(?:\/)?tatsu_/i,
    urlRules: [
      { shortcodePrefix: "tatsu_image", urlParams: ["image", "url", "src"], tag: "img" },
      { shortcodePrefix: "tatsu_video", urlParams: ["video", "src", "url"], tag: "video" },
    ],
    scaffoldingPrefixes: ["tatsu_"],
  },
  {
    id: "divi",
    detect: /\[(?:\/)?et_pb_/i,
    urlRules: [{ shortcodePrefix: "et_pb_image", urlParams: ["src", "url"], tag: "img" }],
    scaffoldingPrefixes: ["et_pb_"],
  },
  {
    id: "elementor",
    detect: /\[(?:\/)?elementor[-_]/i,
    urlRules: [
      { shortcodePrefix: "elementor-widget", urlParams: ["url", "src", "image"], tag: "img" },
    ],
    scaffoldingPrefixes: ["elementor_"],
  },
  {
    id: "oshine",
    detect:
      /\[(?:special_sub_title|special_heading5|blox_\w+|grid_content|grids|testimonial\b|portfolio\b|recent_posts\b|animate_icon\w*|section\b|row\b|one_col|text\b)/i,
    textRules: [
      {
        shortcodePrefix: "special_sub_title",
        fields: [{ param: "title_content", tag: "p" }],
      },
      {
        shortcodePrefix: "special_heading5",
        fields: [
          { param: "title_content", tag: "h2" },
          { param: "caption_content", tag: "h4" },
        ],
      },
    ],
    wrapperRules: [
      { shortcodePrefix: "grid_content" },
      { shortcodePrefix: "testimonial", urlParams: ["author_image"] },
    ],
    placeholderRules: [
      {
        shortcodePrefix: "blox_gmap",
        html: '<p data-unresolved-shortcode="blox_gmap"><!-- Map embed removed during migration --></p>',
      },
    ],
    scaffoldingPrefixes: ["blox_", "animate_icon"],
    legacyScaffoldingTokens: [
      "section",
      "row",
      "one_col",
      "one_third",
      "one_fourth",
      "one_half",
      "two_third",
      "three_fourth",
      "text",
      "icon",
      "linebreak",
      "grids",
      "testimonials",
    ],
  },
];

/** @deprecated Use urlRules on BuilderThemeConfig — kept for type migration clarity. */
export type BuilderContentRule = BuilderUrlRule;
