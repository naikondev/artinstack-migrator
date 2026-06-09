import {
  UNRESOLVABLE_SHORTCODE_PREFIXES,
} from "./registry.js";

export interface WordPressShortcodeMarker {
  shortcode: string;
  unresolvable: boolean;
}

const SHORTCODE_PATTERN = /\[(\/?)([a-z][a-z0-9_-]*)\b[^\]]*\]/gi;

function isUnresolvable(name: string): boolean {
  const lower = name.toLowerCase();
  if (UNRESOLVABLE_SHORTCODE_PREFIXES.includes(lower as (typeof UNRESOLVABLE_SHORTCODE_PREFIXES)[number])) {
    return true;
  }
  return lower.startsWith("woocommerce_");
}

/** Collect remaining WordPress shortcode tokens after builder flattening. */
export function findWordPressShortcodeMarkers(contentHtml: string): WordPressShortcodeMarker[] {
  if (!contentHtml.trim()) return [];

  const seen = new Set<string>();
  const markers: WordPressShortcodeMarker[] = [];

  for (const match of contentHtml.matchAll(SHORTCODE_PATTERN)) {
    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    if (!name || closing) continue;

    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);

    markers.push({
      shortcode: name,
      unresolvable: isUnresolvable(name),
    });
  }

  return markers.sort((a, b) => a.shortcode.localeCompare(b.shortcode));
}

export function hasUnresolvableShortcodes(contentHtml: string): boolean {
  return findWordPressShortcodeMarkers(contentHtml).some((m) => m.unresolvable);
}

export { UNRESOLVABLE_SHORTCODE_PREFIXES };
