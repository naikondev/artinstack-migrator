export { wordpressAdapter } from "./wordpress/index.js";
export { smugmugAdapter } from "./smugmug/index.js";
export { squarespaceAdapter } from "./squarespace/index.js";

import type { MigrationPlatform } from "../normalizer/types.js";
import { smugmugAdapter } from "./smugmug/index.js";
import { squarespaceAdapter } from "./squarespace/index.js";
import { wordpressAdapter } from "./wordpress/index.js";

const adapters = {
  wordpress: wordpressAdapter,
  smugmug: smugmugAdapter,
  squarespace: squarespaceAdapter,
} as const;

export function getAdapter(platform: MigrationPlatform) {
  return adapters[platform];
}
