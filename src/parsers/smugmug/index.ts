import type { AdapterContext, MigrationAdapter, NormalizedEntity } from "../../normalizer/types.js";

/** SmugMug API → normalizer DTOs (Phase 2). */
export const smugmugAdapter: MigrationAdapter = {
  platform: "smugmug",

  validateInput(_input: unknown) {
    return {
      ok: false,
      issues: [
        {
          code: "not_implemented",
          message: "SmugMug adapter is not implemented yet",
        },
      ],
    };
  },

  async *enumerateEntities(_ctx: AdapterContext): AsyncIterable<NormalizedEntity> {
    yield* [];
  },
};
