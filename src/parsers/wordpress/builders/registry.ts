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

/** Bucket 1 — image-based icon modules (`icon_image` param) → linked `<img>`. */
export interface BuilderIconImageRule {
  shortcodePrefix: string;
  imageParam: string;
  hrefParam?: string;
}

/** Bucket 1 — dynamic embeds replaced with a static migration placeholder. */
export interface BuilderPlaceholderRule {
  shortcodePrefix: string;
  html: string;
}

/** Profile A — prefixed namespace tokens (Tatsu, Divi, WPBakery, …). */
export interface PrefixedLayoutMap {
  kind: "prefixed";
  sectionRegex: RegExp;
  sectionCloseRegex: RegExp;
  rowRegex: RegExp;
  rowCloseRegex: RegExp;
  columnRegex: RegExp;
  columnCloseRegex: RegExp;
  bgParamName?: string;
  colsParamName?: string;
}

/** Profile B — legacy Blox fractional column tokens (`one_third`, `one_half`, …). */
export interface FractionalLayoutMap {
  kind: "fractional";
  sectionRegex: RegExp;
  sectionCloseRegex: RegExp;
  rowRegex: RegExp;
  rowCloseRegex: RegExp;
  columnTokens: string[];
  columnOpenRegexes: RegExp[];
  columnCloseRegexes: RegExp[];
  columnWidths: Record<string, string>;
  bgParamName?: string;
}

export type StructuralLayoutMap = PrefixedLayoutMap | FractionalLayoutMap;

function layoutEscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortcodeOpenRegex(token: string): RegExp {
  return new RegExp(`\\[${layoutEscapeRegExp(token)}\\b([^\\]]*)\\]`, "gi");
}

function shortcodeCloseRegex(token: string): RegExp {
  return new RegExp(`\\[\\/${layoutEscapeRegExp(token)}\\b[^\\]]*\\]`, "gi");
}

const FRACTIONAL_COLUMN_WIDTHS: Record<string, string> = {
  one_col: "100%",
  one_half: "50%",
  one_third: "33.33%",
  two_third: "66.67%",
  two_thirds: "66.67%",
  one_fourth: "25%",
  three_fourth: "75%",
  three_fourths: "75%",
};

export function parseFractionalColumnWidth(token: string): string | undefined {
  return FRACTIONAL_COLUMN_WIDTHS[token];
}

/** Profile A — section/row/column share a static namespace prefix. */
export function prefixedLayoutMap(config: {
  section: string;
  row: string;
  column: string;
  bgParamName?: string;
  colsParamName?: string;
}): PrefixedLayoutMap {
  return {
    kind: "prefixed",
    sectionRegex: shortcodeOpenRegex(config.section),
    sectionCloseRegex: shortcodeCloseRegex(config.section),
    rowRegex: shortcodeOpenRegex(config.row),
    rowCloseRegex: shortcodeCloseRegex(config.row),
    columnRegex: shortcodeOpenRegex(config.column),
    columnCloseRegex: shortcodeCloseRegex(config.column),
    bgParamName: config.bgParamName,
    colsParamName: config.colsParamName,
  };
}

/** Profile B — legacy Blox/Oshine mathematical column shortcodes. */
export function fractionalLayoutMap(config: {
  section: string;
  row: string;
  columns: string[];
  bgParamName?: string;
}): FractionalLayoutMap {
  const columnWidths: Record<string, string> = {};
  for (const token of config.columns) {
    const width = parseFractionalColumnWidth(token);
    if (width) columnWidths[token] = width;
  }

  return {
    kind: "fractional",
    sectionRegex: shortcodeOpenRegex(config.section),
    sectionCloseRegex: shortcodeCloseRegex(config.section),
    rowRegex: shortcodeOpenRegex(config.row),
    rowCloseRegex: shortcodeCloseRegex(config.row),
    columnTokens: config.columns,
    columnOpenRegexes: config.columns.map(shortcodeOpenRegex),
    columnCloseRegexes: config.columns.map(shortcodeCloseRegex),
    columnWidths,
    bgParamName: config.bgParamName,
  };
}

/** Per builder-family registry entry — declarative map executed by the flatten engine. */
export interface BuilderThemeConfig {
  id: string;
  detect: RegExp;
  layoutMap?: StructuralLayoutMap;
  urlRules?: BuilderUrlRule[];
  textRules?: BuilderTextRule[];
  wrapperRules?: BuilderWrapperRule[];
  iconImageRules?: BuilderIconImageRule[];
  placeholderRules?: BuilderPlaceholderRule[];
  scaffoldingPrefixes?: string[];
  legacyScaffoldingTokens?: string[];
}

/** @deprecated Alias — families not themes. */
export type BuilderFamilyConfig = BuilderThemeConfig;

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
    layoutMap: prefixedLayoutMap({
      section: "tatsu_section",
      row: "tatsu_row",
      column: "tatsu_column",
      bgParamName: "bg_image",
      colsParamName: "layout",
    }),
    wrapperRules: [
      { shortcodePrefix: "tatsu_text" },
      { shortcodePrefix: "tatsu_inline_text" },
      { shortcodePrefix: "tatsu_text_with_shortcodes" },
    ],
    urlRules: [
      { shortcodePrefix: "tatsu_image", urlParams: ["image", "url", "src"], tag: "img" },
      { shortcodePrefix: "tatsu_video", urlParams: ["video", "src", "url"], tag: "video" },
    ],
    iconImageRules: [
      { shortcodePrefix: "tatsu_icon", imageParam: "icon_image", hrefParam: "href" },
    ],
    scaffoldingPrefixes: ["tatsu_"],
  },
  {
    id: "divi",
    detect: /\[(?:\/)?et_pb_/i,
    layoutMap: prefixedLayoutMap({
      section: "et_pb_section",
      row: "et_pb_row",
      column: "et_pb_column",
      bgParamName: "background_image",
    }),
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
      /\[(?:special_sub_title|special_heading5|blox_\w+|grid_content|grids|testimonial\b|portfolio\b|recent_posts\b|animate_icon\w*|section\b|row\b|one_col|one_third|one_half|one_fourth|two_third|three_fourth|text\b)/i,
    layoutMap: fractionalLayoutMap({
      section: "section",
      row: "row",
      columns: [
        "one_col",
        "one_third",
        "two_third",
        "two_thirds",
        "one_half",
        "one_fourth",
        "three_fourth",
        "three_fourths",
      ],
      bgParamName: "bg_image",
    }),
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
    legacyScaffoldingTokens: ["text", "icon", "linebreak", "grids", "testimonials"],
  },
];

/** @deprecated Use urlRules on BuilderThemeConfig — kept for type migration clarity. */
export type BuilderContentRule = BuilderUrlRule;
