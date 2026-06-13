import type { AdapterContext, MigrationAdapter, ValidationResult, WxrImportSummary } from "../../normalizer/types.js";
import type { OriginUrlRewriteConfig } from "../../lib/media-urls.js";
import {
  DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS,
  enumerateWxrEntities,
  summarizeWxrImportFromFile,
  validateWxrFile,
  type WxrParseOptions,
} from "./parse-wxr.js";

export {
  flattenWordPressBuilders,
  extractQuotedParam,
  normalizeVideoEmbedUrl,
} from "./builders/flatten.js";
export {
  WORDPRESS_BUILDER_REGISTRY,
  WORDPRESS_WIDGET_REGISTRY,
  UNRESOLVABLE_SHORTCODE_PREFIXES,
} from "./builders/registry.js";
export {
  findWordPressShortcodeMarkers,
  hasUnresolvableShortcodes,
} from "./builders/shortcode-conflicts.js";
export type {
  BuilderThemeConfig,
  BuilderContentRule,
  BuilderUrlRule,
  BuilderTextRule,
  WordPressWidgetRegistry,
  WordPressContactFormWidgetRule,
} from "./builders/registry.js";
export {
  DEFAULT_WORDPRESS_PORTFOLIO_CPT_SLUGS,
  summarizeWxrImport,
  summarizeWxrImportFromFile,
  validateWxrFile,
} from "./parse-wxr.js";
export type { WxrImportSummary, WxrParseOptions } from "./parse-wxr.js";

export interface WordPressParseInput {
  path: string;
  originUrlRewrite?: OriginUrlRewriteConfig;
  flattenBuilders?: boolean;
  skipWooCommerceStubPages?: boolean;
  portfolioCptSlugs?: readonly string[];
}

function resolveWxrOptions(input: unknown): WxrParseOptions {
  if (typeof input === "string") {
    return { filePath: input };
  }
  if (input && typeof input === "object" && "path" in input) {
    const obj = input as WordPressParseInput;
    return {
      filePath: String(obj.path),
      originUrlRewrite: obj.originUrlRewrite,
      flattenBuilders: obj.flattenBuilders,
      skipWooCommerceStubPages: obj.skipWooCommerceStubPages,
      portfolioCptSlugs: obj.portfolioCptSlugs,
    };
  }
  throw new Error(
    "WordPress adapter requires input path (string or { path, originUrlRewrite?, flattenBuilders?, skipWooCommerceStubPages?, portfolioCptSlugs? })",
  );
}

export const wordpressAdapter: MigrationAdapter = {
  platform: "wordpress",

  async validateInput(input: unknown): Promise<ValidationResult> {
    const options = resolveWxrOptions(input);
    const result = await validateWxrFile(options.filePath, options);
    return {
      ok: result.ok,
      issues: result.issues,
      summary: {
        ...result.summary,
        unsupportedOnly: result.importSummary.unsupportedOnly,
        skippedPostTypes: result.importSummary.skippedPostTypes,
      },
    };
  },

  async getImportSummary(input: unknown): Promise<WxrImportSummary> {
    const options = resolveWxrOptions(input);
    return summarizeWxrImportFromFile(options.filePath, options);
  },

  enumerateEntities(ctx: AdapterContext) {
    return enumerateWxrEntities(resolveWxrOptions(ctx.input));
  },
};
