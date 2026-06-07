import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import { enumerateWxrEntities, validateWxrFile } from "./parse-wxr.js";

function resolvePath(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "path" in input) {
    return String((input as { path: string }).path);
  }
  throw new Error("WordPress adapter requires input path (string or { path })");
}

export const wordpressAdapter: MigrationAdapter = {
  platform: "wordpress",

  async validateInput(input: unknown): Promise<ValidationResult> {
    const path = resolvePath(input);
    const result = await validateWxrFile(path);
    return {
      ok: result.ok,
      issues: result.issues,
      summary: result.summary,
    };
  },

  enumerateEntities(ctx: AdapterContext) {
    const path = resolvePath(ctx.input);
    return enumerateWxrEntities({ filePath: path });
  },
};
