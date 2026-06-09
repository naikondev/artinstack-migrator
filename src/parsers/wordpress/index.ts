import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import type { OriginUrlRewriteConfig } from "../../lib/origin-url-rewrite.js";
import { enumerateWxrEntities, validateWxrFile, type WxrParseOptions } from "./parse-wxr.js";

export { flattenWordPressBuilders, extractQuotedParam } from "./builders/flatten.js";
export { WORDPRESS_BUILDER_REGISTRY, UNRESOLVABLE_SHORTCODE_PREFIXES } from "./builders/registry.js";
export {
  findWordPressShortcodeMarkers,
  hasUnresolvableShortcodes,
} from "./builders/shortcode-conflicts.js";
export type { BuilderThemeConfig, BuilderContentRule, BuilderUrlRule, BuilderTextRule } from "./builders/registry.js";
export type { WxrParseOptions } from "./parse-wxr.js";

export interface WordPressParseInput {
  path: string;
  originUrlRewrite?: OriginUrlRewriteConfig;
  flattenBuilders?: boolean;
  skipWooCommerceStubPages?: boolean;
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
    };
  }
  throw new Error(
    "WordPress adapter requires input path (string or { path, originUrlRewrite?, flattenBuilders?, skipWooCommerceStubPages? })",
  );
}

export const wordpressAdapter: MigrationAdapter = {
  platform: "wordpress",

  async validateInput(input: unknown): Promise<ValidationResult> {
    const { filePath } = resolveWxrOptions(input);
    const result = await validateWxrFile(filePath);
    return {
      ok: result.ok,
      issues: result.issues,
      summary: result.summary,
    };
  },

  enumerateEntities(ctx: AdapterContext) {
    return enumerateWxrEntities(resolveWxrOptions(ctx.input));
  },
};
