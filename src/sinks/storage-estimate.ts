import type { NormalizedAsset } from "../normalizer/types.js";

export const FALLBACK_ASSET_BYTES = 4 * 1024 * 1024; // 4 MB

export interface AssetSizeResult {
  sourceId: string;
  url: string;
  bytes: number;
  source: "head" | "fallback";
  error?: string;
}

export interface StorageEstimate {
  totalBytes: number;
  assets: AssetSizeResult[];
}

export interface EstimateStorageOptions {
  assets: NormalizedAsset[];
  /** When true, skip network and use fallback for all assets. */
  offline?: boolean;
  fetchFn?: typeof fetch;
}

export async function estimateStorage(
  options: EstimateStorageOptions,
): Promise<StorageEstimate> {
  const fetchFn = options.fetchFn ?? fetch;
  const results: AssetSizeResult[] = [];

  for (const asset of options.assets) {
    if (options.offline) {
      results.push({
        sourceId: asset.sourceId,
        url: asset.sourceUrl,
        bytes: FALLBACK_ASSET_BYTES,
        source: "fallback",
        error: "offline_mode",
      });
      continue;
    }

    try {
      const response = await fetchFn(asset.sourceUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const length = response.headers.get("content-length");
        const bytes = length ? Number.parseInt(length, 10) : FALLBACK_ASSET_BYTES;
        results.push({
          sourceId: asset.sourceId,
          url: asset.sourceUrl,
          bytes: Number.isFinite(bytes) ? bytes : FALLBACK_ASSET_BYTES,
          source: "head",
        });
      } else {
        results.push({
          sourceId: asset.sourceId,
          url: asset.sourceUrl,
          bytes: FALLBACK_ASSET_BYTES,
          source: "fallback",
          error: `http_${response.status}`,
        });
      }
    } catch (error) {
      results.push({
        sourceId: asset.sourceId,
        url: asset.sourceUrl,
        bytes: FALLBACK_ASSET_BYTES,
        source: "fallback",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  return { totalBytes, assets: results };
}

export function staleUrlsFromEstimate(estimate: StorageEstimate) {
  return estimate.assets
    .filter((a) => a.source === "fallback" && a.error && a.error !== "offline_mode")
    .map((a) => ({
      sourceId: a.sourceId,
      url: a.url,
      reason: a.error ?? "unknown",
    }));
}
