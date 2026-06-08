import { normalizeAssetUrl } from "../../../lib/content-asset-urls.js";
import type { BuilderContentRule, BuilderHtmlTag, BuilderThemeConfig } from "./registry.js";
import { WORDPRESS_BUILDER_REGISTRY } from "./registry.js";

export interface FlattenWordPressBuildersOptions {
  registry?: BuilderThemeConfig[];
}

export interface FlattenWordPressBuildersResult {
  html: string;
  detectedThemes: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractShortcodeParam(params: string, names: string[]): string | undefined {
  for (const name of names) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, "i");
    const match = params.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

function emitHtmlTag(tag: BuilderHtmlTag, url: string): string {
  const normalized = normalizeAssetUrl(url) ?? url;
  const escaped = normalized
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

  switch (tag) {
    case "img":
      return `<img src="${escaped}" alt="" />`;
    case "video":
      return `<video src="${escaped}" controls></video>`;
    case "iframe":
      return `<iframe src="${escaped}" loading="lazy"></iframe>`;
  }
}

function convertContentBlocker(content: string, rule: BuilderContentRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}([^\\]]*)\\]\\s*(?:\\[\\/${prefix}[^\\]]*\\])?`,
    "gi",
  );

  return content.replace(pattern, (block, params: string) => {
    const url = extractShortcodeParam(params, rule.urlParams);
    if (!url) return block;
    return emitHtmlTag(rule.tag, url);
  });
}

function stripScaffolding(content: string, prefix: string): string {
  const escaped = escapeRegExp(prefix);
  const opener = new RegExp(`\\[${escaped}[a-z0-9_-]*[^\\]]*\\]`, "gi");
  const closer = new RegExp(`\\[\\/${escaped}[a-z0-9_-]*[^\\]]*\\]`, "gi");
  return content.replace(opener, "").replace(closer, "");
}

function detectThemes(content: string, registry: BuilderThemeConfig[]): BuilderThemeConfig[] {
  return registry.filter((theme) => theme.detect.test(content));
}

/**
 * Pre-DTO WordPress builder flattening — Bucket 1 (asset shortcodes → HTML) then
 * Bucket 2 (layout scaffolding stripped). Decoupled from sink-time rewriteInlineImages.
 */
export function flattenWordPressBuilders(
  content: string,
  options: FlattenWordPressBuildersOptions = {},
): FlattenWordPressBuildersResult {
  if (!content.trim()) {
    return { html: content, detectedThemes: [] };
  }

  const registry = options.registry ?? WORDPRESS_BUILDER_REGISTRY;
  const themes = detectThemes(content, registry);
  if (themes.length === 0) {
    return { html: content, detectedThemes: [] };
  }

  let html = content;
  for (const theme of themes) {
    for (const rule of theme.contentRules) {
      html = convertContentBlocker(html, rule);
    }
    html = stripScaffolding(html, theme.scaffoldingPrefix);
  }

  html = html.replace(/\n{3,}/g, "\n\n").trim();

  return {
    html,
    detectedThemes: themes.map((theme) => theme.id),
  };
}
