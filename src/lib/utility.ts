/** Lowercase URL-safe slug from WordPress post_name or title. */
export function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&[^;]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/** Normalize absolute permalink to root-relative path. */
export function linkToPath(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    const path = url.pathname;
    if (!path || path === "/") return "/";
    return path.endsWith("/") ? path : `${path}/`;
  } catch {
    if (link.startsWith("/")) {
      return link.endsWith("/") ? link : `${link}/`;
    }
    return undefined;
  }
}
