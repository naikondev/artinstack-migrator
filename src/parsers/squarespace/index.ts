import type { AdapterContext, MigrationAdapter, NormalizedEntity } from "../../normalizer/types.js";

/** Squarespace export → normalizer DTOs (Phase 2). */
export const squarespaceAdapter: MigrationAdapter = {
  platform: "squarespace",

  validateInput(_input: unknown) {
    return {
      ok: false,
      issues: [
        {
          code: "not_implemented",
          message: "Squarespace adapter is not implemented yet",
        },
      ],
    };
  },

  async *enumerateEntities(_ctx: AdapterContext): AsyncIterable<NormalizedEntity> {
    yield* [];
  },
};
