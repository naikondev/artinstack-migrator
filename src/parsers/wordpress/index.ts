import type { AdapterContext, MigrationAdapter, NormalizedEntity } from "../../normalizer/types.js";

/** WordPress WXR → normalizer DTOs (Phase 1 priority). */
export const wordpressAdapter: MigrationAdapter = {
  platform: "wordpress",

  validateInput(_input: unknown) {
    return {
      ok: false,
      issues: [
        {
          code: "not_implemented",
          message: "WordPress WXR parser is not implemented yet",
        },
      ],
    };
  },

  async *enumerateEntities(_ctx: AdapterContext): AsyncIterable<NormalizedEntity> {
    yield* [];
  },
};
