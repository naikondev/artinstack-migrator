import { normalizeAssetUrl } from "./content-asset-urls.js";

function urlPathname(url: string): string | undefined {
  try {
    return new URL(url, "http://migration.local").pathname;
  } catch {
    return undefined;
  }
}

/**
 * Map normalized upload URLs (and pathnames) → normalizer `sourceId`.
 * Attachment ids are WXR `post_id` strings; inline discoveries use `url:{src}`.
 */
export function buildMigrationMediaUrlIndex(
  entries: Iterable<{ sourceUrl: string; sourceId: string }>,
): Map<string, string> {
  const index = new Map<string, string>();

  for (const entry of entries) {
    index.set(entry.sourceUrl, entry.sourceId);
    const normalized = normalizeAssetUrl(entry.sourceUrl);
    if (normalized) index.set(normalized, entry.sourceId);
    const pathname = urlPathname(entry.sourceUrl);
    if (pathname) index.set(pathname, entry.sourceId);
  }

  return index;
}

export function resolveMigrationMediaSourceId(
  src: string,
  urlIndex: Map<string, string>,
): string | undefined {
  const normalized = normalizeAssetUrl(src);
  if (!normalized) return undefined;

  return (
    urlIndex.get(normalized) ??
    urlIndex.get(src) ??
    (urlPathname(normalized) ? urlIndex.get(urlPathname(normalized)!) : undefined)
  );
}
