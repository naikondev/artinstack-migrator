import { normalizeAssetUrl } from "../../../lib/content-asset-urls.js";
import type {
  BuilderPlaceholderRule,
  BuilderTextRule,
  BuilderThemeConfig,
  BuilderUrlRule,
  BuilderWrapperRule,
  TextHtmlTag,
  BuilderHtmlTag,
} from "./registry.js";
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

/** Read a quoted shortcode attribute value (supports multiline). */
export function extractQuotedParam(params: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*`, "i");
  const match = pattern.exec(params);
  if (!match) return undefined;

  let index = match.index + match[0].length;
  while (index < params.length && /\s/.test(params[index]!)) index += 1;

  const quote = params[index];
  if (quote !== '"' && quote !== "'") return undefined;
  index += 1;

  let value = "";
  while (index < params.length) {
    const char = params[index]!;
    if (char === "\\" && index + 1 < params.length) {
      value += params[index + 1];
      index += 2;
      continue;
    }
    if (char === quote) break;
    value += char;
    index += 1;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractShortcodeParam(params: string, names: string[]): string | undefined {
  for (const name of names) {
    const value = extractQuotedParam(params, name);
    if (value) return value;
  }
  return undefined;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text: string, tag: TextHtmlTag): string {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";

  return paragraphs
    .map((paragraph) => {
      const inner = escapeHtmlText(paragraph).replace(/\n/g, "<br />");
      return `<${tag}>${inner}</${tag}>`;
    })
    .join("\n");
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

function convertUrlRule(content: string, rule: BuilderUrlRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gi",
  );

  return content.replace(pattern, (block, params: string) => {
    const url = extractShortcodeParam(params, rule.urlParams);
    if (!url) return block;
    return emitHtmlTag(rule.tag, url);
  });
}

function convertTextRule(content: string, rule: BuilderTextRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gis",
  );

  return content.replace(pattern, (block, params: string) => {
    const parts: string[] = [];
    for (const field of rule.fields) {
      const text = extractQuotedParam(params, field.param);
      if (!text) continue;
      const html = textToHtml(text, field.tag);
      if (html) parts.push(html);
    }
    return parts.length > 0 ? parts.join("\n") : block;
  });
}

function convertWrapperRule(content: string, rule: BuilderWrapperRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${prefix}\\b[^\\]]*\\]`,
    "gi",
  );

  return content.replace(pattern, (_, params: string, inner: string) => {
    const parts: string[] = [];
    if (rule.urlParams?.length) {
      const url = extractShortcodeParam(params, rule.urlParams);
      if (url) parts.push(emitHtmlTag("img", url));
    }
    parts.push(inner.trim());
    return parts.filter(Boolean).join("\n");
  });
}

function convertPlaceholderRule(content: string, rule: BuilderPlaceholderRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gi",
  );
  return content.replace(pattern, rule.html);
}

function stripScaffoldingPrefix(content: string, prefix: string): string {
  const escaped = escapeRegExp(prefix);
  const opener = new RegExp(`\\[${escaped}[a-z0-9_-]*[^\\]]*\\]`, "gi");
  const closer = new RegExp(`\\[\\/${escaped}[a-z0-9_-]*[^\\]]*\\]`, "gi");
  return content.replace(opener, "").replace(closer, "");
}

function stripLegacyTokens(content: string, tokens: string[]): string {
  let result = content;
  for (const token of tokens) {
    const escaped = escapeRegExp(token);
    const opener = new RegExp(`\\[${escaped}\\b[^\\]]*\\]`, "gi");
    const closer = new RegExp(`\\[\\/${escaped}\\b[^\\]]*\\]`, "gi");
    result = result.replace(opener, "").replace(closer, "");
  }
  return result;
}

function detectThemes(content: string, registry: BuilderThemeConfig[]): BuilderThemeConfig[] {
  return registry.filter((theme) => theme.detect.test(content));
}

/**
 * Pre-DTO WordPress builder flattening — Bucket 1 (asset/text shortcodes → HTML) then
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
    for (const rule of theme.wrapperRules ?? []) {
      html = convertWrapperRule(html, rule);
    }
    for (const rule of theme.textRules ?? []) {
      html = convertTextRule(html, rule);
    }
    for (const rule of theme.urlRules ?? []) {
      html = convertUrlRule(html, rule);
    }
    for (const rule of theme.placeholderRules ?? []) {
      html = convertPlaceholderRule(html, rule);
    }
    for (const prefix of theme.scaffoldingPrefixes ?? []) {
      html = stripScaffoldingPrefix(html, prefix);
    }
    if (theme.legacyScaffoldingTokens?.length) {
      html = stripLegacyTokens(html, theme.legacyScaffoldingTokens);
    }
  }

  html = html.replace(/\n{3,}/g, "\n\n").trim();

  return {
    html,
    detectedThemes: themes.map((theme) => theme.id),
  };
}
