/** Pseudo-URL scheme for portable migration asset pointers (not WordPress shortcodes). */
export const MIGRATION_MEDIA_REF_SCHEME = "artinstack-migration://asset/";

/** Build `artinstack-migration://asset/{sourceId}` (percent-encodes the normalizer source id). */
export function formatMigrationMediaRef(sourceAssetId: string): string {
  return `${MIGRATION_MEDIA_REF_SCHEME}${encodeURIComponent(sourceAssetId)}`;
}

export function isMigrationMediaRef(value: string): boolean {
  return value.trim().startsWith(MIGRATION_MEDIA_REF_SCHEME);
}

/** Parse a migration media ref back to the normalizer `sourceId`, or `undefined` if not a ref. */
export function parseMigrationMediaRef(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith(MIGRATION_MEDIA_REF_SCHEME)) return undefined;
  const encoded = trimmed.slice(MIGRATION_MEDIA_REF_SCHEME.length);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Default `replaceWith` for `rewriteInlineImages` / `stampMigrationMediaRefs` (OSS-14). */
export function createMigrationMediaRefReplaceWith(): (
  ref: { sourceAssetId?: string },
) => string {
  return (ref) => {
    if (!ref.sourceAssetId) return "";
    return formatMigrationMediaRef(ref.sourceAssetId);
  };
}
