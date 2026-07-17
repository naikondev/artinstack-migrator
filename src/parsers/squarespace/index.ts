import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import {
  SquarespaceCollectionClient,
  type SquarespaceClientOptions,
  type SquarespaceCollectTarget,
} from "./collect.js";
import {
  enumerateSquarespaceEntities,
  summarizeSquarespaceExport,
  validateSquarespaceExportFile,
} from "./parse-export.js";
import type { SquarespaceExport } from "./types.js";

interface SquarespaceParseInput {
  path?: string;
  data?: SquarespaceExport;
  client?: SquarespaceCollectionClient;
  collectTargets?: SquarespaceCollectTarget[];
  clientOptions?: SquarespaceClientOptions;
}

function resolveInput(input: unknown): SquarespaceParseInput {
  if (typeof input === "string") return { path: input };
  if (input && typeof input === "object") {
    const record = input as SquarespaceParseInput;
    if (record.client || record.collectTargets) return record;
    if (record.data) return { data: record.data };
    if (record.path) return { path: record.path };
  }
  throw new Error(
    "Squarespace adapter requires input path (string or { path }), { data }, { client, collectTargets }, or { collectTargets }",
  );
}

export const squarespaceAdapter: MigrationAdapter = {
  platform: "squarespace",

  async validateInput(input: unknown): Promise<ValidationResult> {
    try {
      const resolved = resolveInput(input);

      if (resolved.data) {
        const summary = summarizeSquarespaceExport(resolved.data);
        return {
          ok: true,
          issues: [],
          summary: {
            pages: summary.pages,
            posts: summary.posts,
            categories: summary.categories,
            tags: summary.tags,
            portfolios: summary.portfolios,
          },
        };
      }

      if (resolved.client || resolved.collectTargets?.length) {
        if (!resolved.collectTargets?.length) {
          throw new Error("Squarespace live validation requires collectTargets");
        }
        const client =
          resolved.client ?? new SquarespaceCollectionClient(resolved.clientOptions);
        const doc = await client.collectExport(resolved.collectTargets);
        const summary = summarizeSquarespaceExport(doc);
        return {
          ok: true,
          issues: [],
          summary: {
            pages: summary.pages,
            posts: summary.posts,
            categories: summary.categories,
            tags: summary.tags,
            portfolios: summary.portfolios,
          },
        };
      }

      const result = await validateSquarespaceExportFile(resolved.path!);
      return {
        ok: result.ok,
        issues: result.issues,
        summary: result.summary,
      };
    } catch (error) {
      return {
        ok: false,
        issues: [
          {
            code: "invalid_input",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  },

  enumerateEntities(ctx: AdapterContext) {
    const resolved = resolveInput(ctx.input);
    return enumerateSquarespaceEntities({
      filePath: resolved.path,
      data: resolved.data,
      client: resolved.client,
      collectTargets: resolved.collectTargets,
      clientOptions: resolved.clientOptions,
    });
  },
};

export {
  SQUARESPACE_JSON_FORMAT,
  SquarespaceCollectionClient,
  buildJsonPrettyUrl,
  extractBlocksFromBodyHtml,
  inferBlockTypeFromClassName,
  isGalleryCollection,
  mapJsonPrettyWire,
  mapWireGalleryItem,
  mergeSquarespaceExportPartials,
  squarespaceClientOptionsSchema,
} from "./collect.js";
export type { SquarespaceClientOptions, SquarespaceCollectTarget } from "./collect.js";
export {
  SUPPORTED_BLOCK_TYPES,
  UNSUPPORTED_BLOCK_TYPES,
  emitGalleriesFromBlocks,
  emitGalleryCollections,
  enumerateSquarespaceEntities,
  findUnsupportedBlockMarkers,
  flattenSquarespaceBlock,
  flattenSquarespaceBlocks,
  galleryCollectionPortfolioSourceId,
  galleryPortfolioSourceId,
  isSquarespaceExport,
  loadSquarespaceExport,
  summarizeSquarespaceExport,
  validateSquarespaceExportFile,
} from "./parse-export.js";
export type {
  SquarespaceExport,
  SquarespaceGalleryCollection,
  SquarespaceGalleryItem,
} from "./types.js";
