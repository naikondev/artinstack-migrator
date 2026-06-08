import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import type { OriginUrlRewriteConfig } from "../../lib/origin-url-rewrite.js";
import { enumerateWxrEntities, validateWxrFile, type WxrParseOptions } from "./parse-wxr.js";

export { flattenWordPressBuilders } from "./builders/flatten.js";
export { WORDPRESS_BUILDER_REGISTRY } from "./builders/registry.js";
export type { BuilderThemeConfig, BuilderContentRule } from "./builders/registry.js";
export type { WxrParseOptions } from "./parse-wxr.js";

export interface WordPressParseInput {
  path: string;
  originUrlRewrite?: OriginUrlRewriteConfig;
  flattenBuilders?: boolean;
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
    };
  }
  throw new Error("WordPress adapter requires input path (string or { path, originUrlRewrite?, flattenBuilders? })");
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
