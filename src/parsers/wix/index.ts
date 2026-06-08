import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import { WixCollectionClient, type WixClientOptions } from "./api.js";
import {
  enumerateWixEntities,
  enumerateWixExportEntities,
  isWixFeedXml,
  loadWixExport,
  summarizeWixExport,
  summarizeWixFeed,
  validateWixExportFile,
} from "./parse-export.js";
import type { WixExport, WixSnapshotTarget } from "./types.js";

interface WixParseInput {
  path?: string;
  urlsFile?: string;
  data?: WixExport;
  client?: WixCollectionClient;
  clientOptions?: WixClientOptions;
  snapshotTargets?: WixSnapshotTarget[];
}

function resolveInput(input: unknown): WixParseInput {
  if (typeof input === "string") return { path: input };
  if (input && typeof input === "object") {
    const record = input as WixParseInput & { urlsPath?: string };
    if (
      record.client ||
      record.clientOptions ||
      record.data ||
      record.snapshotTargets?.length
    ) {
      return record;
    }
    if (record.path || record.urlsFile || record.urlsPath) {
      return {
        path: record.path,
        urlsFile: record.urlsFile ?? record.urlsPath,
      };
    }
  }
  throw new Error(
    "Wix adapter requires input path (string or { path }), { data }, { client }, { clientOptions }, or snapshot targets",
  );
}

function toParseOptions(input: WixParseInput) {
  return {
    filePath: input.path,
    urlsFile: input.urlsFile,
    data: input.data,
    client: input.client,
    clientOptions: input.clientOptions,
    snapshotTargets: input.snapshotTargets,
  };
}

export const wixAdapter: MigrationAdapter = {
  platform: "wix",

  async validateInput(input: unknown): Promise<ValidationResult> {
    try {
      const resolved = resolveInput(input);
      const options = toParseOptions(resolved);

      if (resolved.data) {
        const summary = summarizeWixExport(resolved.data);
        return {
          ok: true,
          issues: [],
          summary: {
            posts: summary.posts,
            pages: summary.pages,
            assets: summary.assets,
            categories: summary.categories,
            tags: summary.tags,
          },
        };
      }

      if (resolved.client || resolved.clientOptions) {
        const doc = await loadWixExport(options);
        const summary = summarizeWixExport(doc);
        return {
          ok: true,
          issues: [],
          summary: {
            posts: summary.posts,
            pages: summary.pages,
            assets: summary.assets,
            categories: summary.categories,
            tags: summary.tags,
          },
        };
      }

      if (resolved.path?.endsWith(".json")) {
        const doc = await loadWixExport(options);
        const summary = summarizeWixExport(doc);
        return {
          ok: true,
          issues: [],
          summary: {
            posts: summary.posts,
            pages: summary.pages,
            assets: summary.assets,
            categories: summary.categories,
            tags: summary.tags,
          },
        };
      }

      if (resolved.path && !resolved.path.endsWith(".txt")) {
        const result = await validateWixExportFile(resolved.path);
        return {
          ok: result.ok,
          issues: result.issues,
          summary: {
            posts: result.summary.posts,
            pages: 0,
            assets: result.summary.assets,
            categories: result.summary.categories,
            tags: result.summary.tags,
          },
        };
      }

      if (resolved.path?.endsWith(".txt") || resolved.urlsFile) {
        return {
          ok: true,
          issues: [],
          summary: { pages: 0, posts: 0, assets: 0, categories: 0, tags: 0 },
        };
      }

      throw new Error("Wix validation requires export.xml, export.json, url list, or API client options");
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
    return enumerateWixEntities(toParseOptions(resolveInput(ctx.input)));
  },
};

export {
  WIX_API_BASE,
  WixCollectionClient,
  assertWixExport,
  isWixExport,
  mergeWixWireFixtures,
  wixAuthContextSchema,
  wixClientOptionsSchema,
} from "./api.js";
export type { WixAuthContext, WixClientOptions } from "./api.js";
export {
  detectWixFeedFormat,
  enumerateWixEntities,
  enumerateWixExportEntities,
  isWixFeedXml,
  loadWixExport,
  loadWixFeed,
  summarizeWixExport,
  summarizeWixFeed,
  validateWixExportFile,
} from "./parse-export.js";
export {
  MAIN_CONTENT_SELECTORS,
  WixPageSnapshotCollector,
  extractMainContentHtml,
  loadUrlListFile,
  parseSitemapUrls,
  parseUrlList,
  wixSnapshotClientOptionsSchema,
} from "./snapshot.js";
export type { WixSnapshotClientOptions, WixSnapshotResult } from "./snapshot.js";
export { ricosToHtml } from "./ricos-to-html.js";
export {
  buildWixPageUrl,
  mapWireCategory,
  mapWireListCategoriesResponse,
  mapWireListPostsResponse,
  mapWireListTagsResponse,
  mapWirePost,
  mapWireTag,
} from "./map-wire.js";
export type {
  WixExport,
  WixFeedFormat,
  WixPage,
  WixPost,
  WixSnapshotGap,
  WixSnapshotTarget,
} from "./types.js";
export type { WixParseOptions } from "./parse-export.js";
