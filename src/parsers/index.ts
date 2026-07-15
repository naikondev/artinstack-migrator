export { wordpressAdapter } from "./wordpress/index.js";
export {
  SmugMugApiClient,
  SMUGMUG_API_BASE,
  SMUGMUG_OAUTH_ENDPOINTS,
  buildSmugMugAuthorizeUrl,
  buildSmugMugAuthorizationHeader,
  createSmugMugOAuthSession,
  getSmugMugAccessToken,
  getSmugMugRequestToken,
  parseSmugMugOAuthFormBody,
  readSmugMugCredentialsFromEnv,
  resolveSmugMugUriLink,
  asSmugMugList,
  signSmugMugOAuthRequest,
  smugmugAdapter,
  smugMugConsumerCredentialsSchema,
  smugMugCredentialsSchema,
} from "./smugmug/index.js";
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
} from "./smugmug/index.js";
export { squarespaceAdapter } from "./squarespace/index.js";
export { wixAdapter, WixCollectionClient, WixPageSnapshotCollector } from "./wix/index.js";
export {
  SquarespaceCollectionClient,
  SQUARESPACE_JSON_FORMAT,
  buildJsonPrettyUrl,
  mapJsonPrettyWire,
} from "./squarespace/index.js";
export type { SquarespaceClientOptions, SquarespaceCollectTarget } from "./squarespace/index.js";

import type { MigrationPlatform } from "../normalizer/types.js";
import { smugmugAdapter } from "./smugmug/index.js";
import { squarespaceAdapter } from "./squarespace/index.js";
import { wordpressAdapter } from "./wordpress/index.js";

import { wixAdapter } from "./wix/index.js";

const adapters = {
  wordpress: wordpressAdapter,
  smugmug: smugmugAdapter,
  squarespace: squarespaceAdapter,
  wix: wixAdapter,
} as const;

export function getAdapter(platform: MigrationPlatform) {
  return adapters[platform];
}
