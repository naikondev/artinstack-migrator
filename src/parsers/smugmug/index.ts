import type { AdapterContext, MigrationAdapter, ValidationResult } from "../../normalizer/types.js";
import type { SmugMugClientOptions } from "./api.js";
import {
  SmugMugApiClient,
  readSmugMugCredentialsFromEnv,
  smugMugCredentialsSchema,
} from "./api.js";
import {
  enumerateSmugMugEntities,
  summarizeSmugMugExport,
  validateSmugMugExportFile,
} from "./parse-node.js";
import type { SmugMugExportDocument } from "./types.js";

interface SmugMugParseInput {
  path?: string;
  data?: SmugMugExportDocument;
  credentials?: ReturnType<typeof smugMugCredentialsSchema.parse>;
  client?: SmugMugApiClient;
  clientOptions?: Omit<SmugMugClientOptions, "credentials">;
  /** When true, read SMUGMUG_* env vars for live API crawl (no file path required). */
  live?: boolean;
}

function resolveInput(input: unknown): SmugMugParseInput {
  if (typeof input === "string") return { path: input };
  if (input && typeof input === "object") {
    const record = input as SmugMugParseInput;
    if (record.client || record.credentials || record.live) return record;
    if (record.data) return { data: record.data };
    if (record.path) return { path: record.path };
  }
  throw new Error(
    "SmugMug adapter requires input path (string or { path }), { data }, { credentials }, { client }, or { live: true }",
  );
}

function resolveLiveCredentials(input: SmugMugParseInput) {
  if (input.credentials) return input.credentials;
  if (input.live) return readSmugMugCredentialsFromEnv();
  return undefined;
}

export const smugmugAdapter: MigrationAdapter = {
  platform: "smugmug",

  async validateInput(input: unknown): Promise<ValidationResult> {
    try {
      const resolved = resolveInput(input);
      const credentials = resolveLiveCredentials(resolved);

      if (resolved.data) {
        const summary = summarizeSmugMugExport(resolved.data);
        return {
          ok: true,
          issues: [],
          summary: {
            portfolios: summary.portfolios,
            assets: summary.assets,
            categories: summary.folders,
            posts: 0,
            pages: 0,
            tags: 0,
          },
        };
      }

      if (resolved.client || credentials) {
        const client =
          resolved.client ??
          new SmugMugApiClient({ credentials: credentials!, ...resolved.clientOptions });
        await client.validateCredentials();
        const doc = await client.crawlExport();
        const summary = summarizeSmugMugExport(doc);
        return {
          ok: true,
          issues: [],
          summary: {
            portfolios: summary.portfolios,
            assets: summary.assets,
            categories: summary.folders,
            posts: 0,
            pages: 0,
            tags: 0,
          },
        };
      }

      const result = await validateSmugMugExportFile(resolved.path!);
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
    const credentials = resolveLiveCredentials(resolved);
    return enumerateSmugMugEntities({
      filePath: resolved.path,
      data: resolved.data,
      client: resolved.client,
      credentials,
      clientOptions: resolved.clientOptions,
    });
  },
};

export type { SmugMugExportDocument, SmugMugFlatExport, SmugMugMockExport } from "./types.js";
export {
  SmugMugApiClient,
  SMUGMUG_API_BASE,
  SMUGMUG_OAUTH_ENDPOINTS,
  buildSmugMugAuthorizeUrl,
  buildSmugMugAuthorizationHeader,
  createSmugMugOAuthSession,
  getSmugMugAccessToken,
  getSmugMugRequestToken,
  oauthPercentEncode,
  parseSmugMugOAuthFormBody,
  readSmugMugCredentialsFromEnv,
  resolveSmugMugUriLink,
  asSmugMugList,
  signSmugMugOAuthRequest,
  smugMugConsumerCredentialsSchema,
  smugMugCredentialsSchema,
} from "./api.js";
export type {
  SmugMugAccessLevel,
  SmugMugAuthorizeUrlOptions,
  SmugMugClientOptions,
  SmugMugConsumerCredentials,
  SmugMugCredentials,
  SmugMugOAuthSession,
  SmugMugOAuthSigningMaterial,
  SmugMugOAuthTokenPair,
  SmugMugPermissionLevel,
  SmugMugRequestTokenResult,
} from "./api.js";
export {
  enumerateSmugMugEntities,
  isSmugMugFlatExport,
  loadSmugMugExport,
  summarizeSmugMugExport,
  validateSmugMugExportFile,
  validateSmugMugMockFile,
} from "./parse-node.js";
