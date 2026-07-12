import { normalizeAssetUrl } from "../../../lib/media-urls.js";
import type {
  BuilderIconImageRule,
  BuilderLinkRule,
  BuilderPlaceholderRule,
  BuilderTextRule,
  BuilderThemeConfig,
  BuilderUrlRule,
  BuilderWrapperRule,
  FractionalLayoutMap,
  ExtendedPrefixedLayoutMap,
  PrefixedLayoutMap,
  StructuralLayoutMap,
  TextHtmlTag,
  BuilderHtmlTag,
} from "./registry.js";
import {
  WORDPRESS_BUILDER_REGISTRY,
  WORDPRESS_WIDGET_REGISTRY,
  WP_WIDGET_PLACEHOLDER,
  type WordPressWidgetRegistry,
} from "./registry.js";

export interface FlattenWordPressBuildersOptions {
  registry?: BuilderThemeConfig[];
  widgetRegistry?: WordPressWidgetRegistry;
  /** Serialized `_tatsu_page_content` JSON — fills blank section/column attrs (OSS-28). */
  tatsuPageContent?: string;
}

export interface TatsuPageContext {
  modulesByKey: Map<string, Record<string, unknown>>;
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

  if (params.slice(index, index + 6) === "&quot;") {
    index += 6;
    let value = "";
    while (index < params.length) {
      if (params.slice(index, index + 6) === "&quot;") break;
      value += params[index]!;
      index += 1;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  }

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

function escapeLayoutAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Parse `width="1/2"` / `columns="1/3+1/3+1/3"` style strings → percentage or column count. */
export function parseFractionWidth(fraction: string | undefined): string | undefined {
  if (!fraction?.trim()) return undefined;
  const trimmed = fraction.trim();
  const match = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  const percent = (numerator / denominator) * 100;
  const rounded = Math.round(percent * 100) / 100;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}%`;
}

/** Parse row `layout="1/2+1/2"` style strings → column count. */
export function parseRowLayoutCols(layout: string | undefined): number | undefined {
  if (!layout?.trim()) return undefined;
  const parts = layout.split("+").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.length : undefined;
}

let activeTatsuContext: TatsuPageContext | undefined;

function isBlankShortcodeAttr(value: string | undefined): boolean {
  return !value?.trim();
}

function resolveTatsuJsonScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && "d" in value) {
    return resolveTatsuJsonScalar((value as Record<string, unknown>).d);
  }
  return undefined;
}

function normalizeHttpMediaUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith("http")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return undefined;
}

interface MergedTatsuLayoutAttrs {
  bgImage?: string;
  bgVideoMp4?: string;
  bgVideoWebm?: string;
  overlayColor?: string;
  fullscreen?: boolean;
  builderLayout?: string;
}

function mergeTatsuLayoutAttrs(
  params: string,
  moduleKey: string | undefined,
  context: TatsuPageContext | undefined,
): MergedTatsuLayoutAttrs {
  const jsonAtts = moduleKey ? context?.modulesByKey.get(moduleKey) : undefined;

  const pick = (name: string, jsonName = name): string | undefined => {
    const fromShortcode = extractBareOrQuotedParam(params, name);
    if (!isBlankShortcodeAttr(fromShortcode)) return fromShortcode!.trim();
    return jsonAtts ? resolveTatsuJsonScalar(jsonAtts[jsonName]) : undefined;
  };

  const bgVideoMp4 = pick("bg_video_mp4_src");
  const bgVideoWebm = pick("bg_video_webm_src");
  const bgImage = pick("bg_image");
  const overlayColor = pick("overlay_color");

  const sectionHeight = pick("section_height_type");
  const fullScreen = pick("full_screen");
  const customHeight = pick("custom_height");
  const fullscreen =
    sectionHeight?.toLowerCase() === "full_screen" ||
    fullScreen === "1" ||
    (customHeight?.includes("100vh") ?? false);

  const builderLayout = jsonAtts ? resolveTatsuJsonScalar(jsonAtts.builderLayout) : undefined;

  return { bgImage, bgVideoMp4, bgVideoWebm, overlayColor, fullscreen, builderLayout };
}

function appendSectionHeroAttrs(attrs: string[], merged: MergedTatsuLayoutAttrs, params: string, bgParamName?: string): void {
  const paramName = bgParamName ?? "bg_image";
  const bgImage =
    normalizeHttpMediaUrl(merged.bgImage) ??
    normalizeHttpMediaUrl(extractBareOrQuotedParam(params, paramName)) ??
    normalizeHttpMediaUrl(extractQuotedParam(params, paramName));
  if (bgImage) {
    attrs.push(`data-bg-image="${escapeLayoutAttr(bgImage)}"`);
  }

  const videoUrl =
    normalizeHttpMediaUrl(merged.bgVideoMp4) ?? normalizeHttpMediaUrl(merged.bgVideoWebm);
  if (videoUrl) {
    attrs.push('data-wp-hero-type="video"');
    attrs.push(`data-video-url="${escapeLayoutAttr(videoUrl)}"`);
  }

  if (merged.fullscreen) {
    attrs.push('data-layout-mode="fullscreen"');
  }

  if (merged.overlayColor) {
    attrs.push(`data-overlay-color="${escapeLayoutAttr(merged.overlayColor)}"`);
  }
}

/** Index Tatsu modules by `key` / `id` for shortcode ↔ JSON merge (OSS-28). */
export function buildTatsuPageContext(jsonText: string): TatsuPageContext | undefined {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const modulesByKey = new Map<string, Record<string, unknown>>();
    walkTatsuModules(parsed, modulesByKey);
    return modulesByKey.size > 0 ? { modulesByKey } : undefined;
  } catch {
    return undefined;
  }
}

function walkTatsuModules(node: unknown, index: Map<string, Record<string, unknown>>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkTatsuModules(child, index);
    return;
  }
  if (typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const atts = obj.atts;
  const keyFromAtts =
    atts && typeof atts === "object"
      ? resolveTatsuJsonScalar((atts as Record<string, unknown>).key)
      : undefined;
  const keyFromId = typeof obj.id === "string" ? obj.id.trim() : undefined;
  const key = keyFromAtts || keyFromId;

  if (key && atts && typeof atts === "object") {
    index.set(key, atts as Record<string, unknown>);
  }

  if (obj.inner) walkTatsuModules(obj.inner, index);
}

function openSectionDiv(params: string, bgParamName?: string): string {
  const attrs = ['data-layout="section"'];
  const moduleKey = extractBareOrQuotedParam(params, "key");
  const merged = mergeTatsuLayoutAttrs(params, moduleKey, activeTatsuContext);
  appendSectionHeroAttrs(attrs, merged, params, bgParamName);
  return `<div ${attrs.join(" ")}>`;
}

function openRowDiv(params: string, colsParamName?: string): string {
  const attrs = ['data-layout="row"'];
  const cols = parseRowLayoutCols(extractQuotedParam(params, colsParamName ?? "layout"));
  if (cols) attrs.push(`data-cols="${cols}"`);
  return `<div ${attrs.join(" ")}>`;
}

function openColumnDiv(params: string, widthParamName?: string): string {
  const attrs = ['data-layout="column"'];
  const width = parseFractionWidth(extractQuotedParam(params, widthParamName ?? "width"));
  if (width) attrs.push(`data-col-width="${width}"`);
  return `<div ${attrs.join(" ")}>`;
}

function applyPrefixedLayoutMap(content: string, map: PrefixedLayoutMap): string {
  let html = content;
  html = html.replace(map.sectionRegex, (_, params: string) => openSectionDiv(params, map.bgParamName));
  html = html.replace(map.sectionCloseRegex, "</div>");
  html = html.replace(map.rowRegex, (_, params: string) => openRowDiv(params, map.colsParamName));
  html = html.replace(map.rowCloseRegex, "</div>");
  html = html.replace(map.columnRegex, '<div data-layout="column">');
  html = html.replace(map.columnCloseRegex, "</div>");
  return html;
}

function applyFractionalLayoutMap(content: string, map: FractionalLayoutMap): string {
  let html = content;
  html = html.replace(map.sectionRegex, (_, params: string) => openSectionDiv(params, map.bgParamName));
  html = html.replace(map.sectionCloseRegex, "</div>");
  html = html.replace(map.rowRegex, (_, params: string) => openRowDiv(params));
  html = html.replace(map.rowCloseRegex, "</div>");

  for (let index = 0; index < map.columnTokens.length; index += 1) {
    const token = map.columnTokens[index]!;
    const width = map.columnWidths[token];
    const openRegex = map.columnOpenRegexes[index]!;
    const closeRegex = map.columnCloseRegexes[index]!;
    html = html.replace(openRegex, () => {
      const attrs = ['data-layout="column"'];
      if (width) attrs.push(`data-col-width="${width}"`);
      return `<div ${attrs.join(" ")}>`;
    });
    html = html.replace(closeRegex, "</div>");
  }
  return html;
}

function applyExtendedPrefixedLayoutMap(content: string, map: ExtendedPrefixedLayoutMap): string {
  let html = content;
  const levels = [...map.levels].sort((left, right) => {
    const leftMax = Math.max(...left.tokens.map((token) => token.length));
    const rightMax = Math.max(...right.tokens.map((token) => token.length));
    return rightMax - leftMax;
  });

  for (const level of levels) {
    const tokens = [...level.tokens].sort((left, right) => right.length - left.length);
    for (const token of tokens) {
      const openRegex = new RegExp(`\\[${escapeRegExp(token)}\\b([^\\]]*)\\]`, "gi");
      const closeRegex = new RegExp(`\\[\\/${escapeRegExp(token)}\\b[^\\]]*\\]`, "gi");

      html = html.replace(openRegex, (_, params: string) => {
        switch (level.role) {
          case "section":
            return openSectionDiv(params, level.bgParamName);
          case "row":
            return openRowDiv(params, level.colsParamName);
          case "column":
            return openColumnDiv(params, level.widthParamName);
        }
      });
      html = html.replace(closeRegex, "</div>");
    }
  }

  return html;
}

/** Map builder layout shortcodes → editor-neutral `data-layout` HTML. */
export function applyStructuralLayoutMap(content: string, map: StructuralLayoutMap): string {
  switch (map.kind) {
    case "prefixed":
      return applyPrefixedLayoutMap(content, map);
    case "fractional":
      return applyFractionalLayoutMap(content, map);
    case "extended-prefixed":
      return applyExtendedPrefixedLayoutMap(content, map);
  }
}

function collectLayoutMaps(theme: BuilderThemeConfig): StructuralLayoutMap[] {
  const maps: StructuralLayoutMap[] = [];
  if (theme.layoutMap) maps.push(theme.layoutMap);
  if (theme.layoutMaps?.length) maps.push(...theme.layoutMaps);
  return maps;
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

function isPlaceholderImageUrl(url: string): boolean {
  return /placehold\.it|placeholder\.com|via\.placeholder/i.test(url);
}

function resolveLinkRuleParams(
  params: string,
  rule: BuilderLinkRule,
): { text?: string; url?: string } {
  let text =
    extractQuotedParam(params, rule.textParam) ??
    extractBareOrQuotedParam(params, rule.textParam);
  let url =
    extractQuotedParam(params, rule.urlParam) ??
    extractBareOrQuotedParam(params, rule.urlParam);

  const moduleKey = extractBareOrQuotedParam(params, "key");
  if (moduleKey && activeTatsuContext?.modulesByKey.has(moduleKey)) {
    const jsonAtts = activeTatsuContext.modulesByKey.get(moduleKey)!;
    if (!text) text = resolveTatsuJsonScalar(jsonAtts[rule.textParam]);
    if (!url) url = resolveTatsuJsonScalar(jsonAtts[rule.urlParam]);
  }

  return { text, url };
}

function convertLinkRule(content: string, rule: BuilderLinkRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gi",
  );

  return content.replace(pattern, (_, params: string) => {
    const { text, url } = resolveLinkRuleParams(params, rule);
    if (!text?.trim() && !url?.trim()) return "";
    const label = text?.trim() || "Link";
    const href = url?.trim() || "#";
    const classAttr = rule.className
      ? ` class="${escapeLayoutAttr(rule.className)}"`
      : "";
    return `<a href="${escapeLayoutAttr(href)}"${classAttr}>${escapeHtmlText(label)}</a>`;
  });
}

function convertIconImageRule(content: string, rule: BuilderIconImageRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gi",
  );

  return content.replace(pattern, (_, params: string) => {
    const iconImage =
      extractQuotedParam(params, rule.imageParam) ?? extractQuotedParam(params, "image");
    if (!iconImage?.startsWith("http") || isPlaceholderImageUrl(iconImage)) {
      return "";
    }
    const img = emitHtmlTag("img", iconImage);
    if (rule.hrefParam) {
      const href = extractQuotedParam(params, rule.hrefParam);
      if (href?.startsWith("http")) {
        const escapedHref = href
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;");
        return `<a href="${escapedHref}">${img}</a>`;
      }
    }
    return img;
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

function extractBareOrQuotedParam(params: string, name: string): string | undefined {
  const quoted = extractQuotedParam(params, name);
  if (quoted) return quoted;
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*([^\\s"'\\]]+)`, "i");
  const match = pattern.exec(params);
  return match?.[1]?.trim() || undefined;
}

export type SliderPluginId = "revslider" | "masterslider";

export interface ParsedSliderReference {
  plugin: SliderPluginId;
  alias: string;
  slidertitle?: string;
}

/** Parse `[rev_slider …]` / `[masterslider …]` markup (OSS-27 meta + in-body stubs). */
export function parseSliderShortcodeMarkup(markup: string): ParsedSliderReference | undefined {
  const trimmed = markup.trim();
  if (!trimmed) return undefined;

  const revMatch = trimmed.match(/\[rev_slider\b([^\]]*)\]/i);
  if (revMatch) {
    const params = revMatch[1] ?? "";
    const alias = extractBareOrQuotedParam(params, "alias");
    if (alias) {
      return {
        plugin: "revslider",
        alias,
        slidertitle: extractBareOrQuotedParam(params, "slidertitle"),
      };
    }
  }

  const masterMatch = trimmed.match(/\[masterslider\b([^\]]*)\]/i);
  if (masterMatch) {
    const params = masterMatch[1] ?? "";
    const alias = extractBareOrQuotedParam(params, "alias");
    if (alias) return { plugin: "masterslider", alias };
  }

  return undefined;
}

/** Parse Oshine `_slider` meta (`revslider_alias`, `masterslider_alias`, or `none`). */
export function parseSliderMetaValue(value: string): ParsedSliderReference | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("revslider_")) {
    const alias = trimmed.slice("revslider_".length).trim();
    if (alias) return { plugin: "revslider", alias };
  }
  if (lower.startsWith("masterslider_")) {
    const alias = trimmed.slice("masterslider_".length).trim();
    if (alias) return { plugin: "masterslider", alias };
  }

  return undefined;
}

function emitWidgetStub(
  widget: string,
  attrs: Record<string, string | undefined>,
  tag: "div" | "section" = "div",
): string {
  const parts = [`data-wp-widget="${escapeLayoutAttr(widget)}"`];
  for (const [key, value] of Object.entries(attrs)) {
    if (value) parts.push(`${key}="${escapeLayoutAttr(value)}"`);
  }
  return `<${tag} ${parts.join(" ")}>${WP_WIDGET_PLACEHOLDER}</${tag}>`;
}

/** Normalize YouTube/Vimeo share URLs to canonical embed URLs. */
export function normalizeVideoEmbedUrl(
  raw: string,
): { provider: "youtube" | "vimeo" | "external"; embedUrl: string } | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:")) return undefined;

  try {
    const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id) {
        return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
      }
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const embedMatch = url.pathname.match(/\/embed\/([^/?#]+)/);
      if (embedMatch?.[1]) {
        const start = url.searchParams.get("start");
        const suffix = start ? `?start=${start}` : "";
        return {
          provider: "youtube",
          embedUrl: `https://www.youtube-nocookie.com/embed/${embedMatch[1]}${suffix}`,
        };
      }
      const videoId = url.searchParams.get("v");
      if (videoId) {
        const t = url.searchParams.get("t") ?? url.searchParams.get("start");
        const startSeconds = t?.endsWith("s") ? t.slice(0, -1) : t;
        const suffix = startSeconds ? `?start=${startSeconds}` : "";
        return {
          provider: "youtube",
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}${suffix}`,
        };
      }
    }

    if (host === "vimeo.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      const id = segments[segments.length - 1];
      if (id && /^\d+$/.test(id)) {
        return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` };
      }
    }

    if (host === "player.vimeo.com") {
      const match = url.pathname.match(/\/video\/(\d+)/);
      if (match?.[1]) {
        return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${match[1]}` };
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function emitVideoWidgetFromParams(params: string, inner: string): string {
  const url =
    extractShortcodeParam(params, ["url", "src", "video", "link", "youtube_url", "vimeo_url"]) ??
    inner.trim().match(/^https?:\/\/\S+/)?.[0];

  if (!url) {
    return emitWidgetStub("video", { "data-video-provider": "external" });
  }

  const normalized = normalizeVideoEmbedUrl(url);
  if (normalized) {
    return emitWidgetStub("video", {
      "data-video-provider": normalized.provider,
      "data-embed-url": normalized.embedUrl,
    });
  }

  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) {
    return emitHtmlTag("video", url);
  }

  return emitWidgetStub("video", {
    "data-video-provider": "external",
    "data-embed-url": url,
  });
}

/** Host sanitize allowlist: iframe src must start with `https://www.google.com/maps/embed`. */
export function normalizeSanitizedGoogleMapsEmbedUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!/^(www\.)?google\.com$/i.test(parsed.hostname)) return undefined;
    if (!parsed.pathname.includes("/maps/embed")) return undefined;
    parsed.protocol = "https:";
    if (!parsed.hostname.startsWith("www.")) {
      parsed.hostname = `www.${parsed.hostname}`;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Build map widget stub fields from shortcode params (OSS-20). */
export function buildGoogleMapsEmbedUrlFromMapParams(params: string): {
  embedUrl?: string;
  lat?: string;
  lng?: string;
  zoom?: string;
  query?: string;
} {
  const direct = extractShortcodeParam(params, [
    "embed_url",
    "url",
    "src",
    "map_url",
    "iframe_url",
    "embed",
  ]);
  if (direct) {
    const embedUrl = normalizeSanitizedGoogleMapsEmbedUrl(direct);
    if (embedUrl) return { embedUrl };
  }

  const lat =
    extractBareOrQuotedParam(params, "lat") ??
    extractBareOrQuotedParam(params, "latitude") ??
    extractBareOrQuotedParam(params, "map_lat");
  const lng =
    extractBareOrQuotedParam(params, "lng") ??
    extractBareOrQuotedParam(params, "longitude") ??
    extractBareOrQuotedParam(params, "map_lng");
  const zoom = extractBareOrQuotedParam(params, "zoom") ?? "14";
  const address =
    extractBareOrQuotedParam(params, "address") ??
    extractBareOrQuotedParam(params, "map_address") ??
    extractBareOrQuotedParam(params, "location") ??
    extractBareOrQuotedParam(params, "map_location") ??
    extractBareOrQuotedParam(params, "q");

  if (lat && lng) {
    return { lat, lng, zoom };
  }

  if (address) {
    return { query: address, zoom };
  }

  return {};
}

function flattenMapShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  let html = content;
  for (const prefix of widgetRegistry.mapShortcodePrefixes) {
    const pattern = new RegExp(
      `\\[${escapeRegExp(prefix)}\\b([^\\]]*)\\]\\s*(?:\\[\\/${escapeRegExp(prefix)}\\b[^\\]]*\\])?`,
      "gi",
    );
    html = html.replace(pattern, (_, params: string) => {
      const resolved = buildGoogleMapsEmbedUrlFromMapParams(params);
      return emitWidgetStub("map", {
        ...(resolved.embedUrl ? { "data-embed-url": resolved.embedUrl } : {}),
        ...(resolved.lat ? { "data-latitude": resolved.lat } : {}),
        ...(resolved.lng ? { "data-longitude": resolved.lng } : {}),
        ...(resolved.zoom ? { "data-zoom": resolved.zoom } : {}),
        ...(resolved.query ? { "data-wp-map-query": resolved.query } : {}),
      });
    });
  }
  return html;
}

function flattenContactFormShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  let html = content;
  for (const rule of widgetRegistry.contactFormRules) {
    const pattern = new RegExp(
      `\\[${escapeRegExp(rule.tag)}\\b([^\\]]*)\\]\\s*(?:\\[\\/${escapeRegExp(rule.tag)}\\b[^\\]]*\\])?`,
      "gi",
    );
    html = html.replace(pattern, (_, params: string) => {
      const id = extractBareOrQuotedParam(params, rule.idParam);
      return emitWidgetStub(
        "contact-form",
        {
          "data-wp-form-source": rule.source,
          ...(id ? { "data-wp-form-id": id } : {}),
        },
        "section",
      );
    });
  }
  return html;
}

function emitInlineGalleryFromIds(idList: string[]): string {
  const images = idList
    .map((id) => `<img data-wp-attachment-id="${escapeLayoutAttr(id)}" alt="" />`)
    .join("");
  return `<figure data-wp-inline-gallery>${images}</figure>`;
}

function parseGalleryAttachmentIds(params: string): string[] | undefined {
  const ids = extractBareOrQuotedParam(params, "ids");
  const idList = ids
    ?.split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));
  return idList?.length ? idList : undefined;
}

function flattenIdGalleryShortcode(content: string, tag: string): string {
  const escaped = escapeRegExp(tag);
  const pattern = new RegExp(`\\[${escaped}\\b([^\\]]*)\\](?:\\s*\\[\\/${escaped}\\])?`, "gi");
  return content.replace(pattern, (fullMatch, params: string) => {
    const idList = parseGalleryAttachmentIds(params);
    if (idList?.length) {
      return emitInlineGalleryFromIds(idList);
    }
    return fullMatch;
  });
}

function flattenGalleryShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  const tag = escapeRegExp(widgetRegistry.galleryShortcode);
  const pattern = new RegExp(`\\[${tag}\\b([^\\]]*)\\](?:\\s*\\[\\/${tag}\\])?`, "gi");
  return content.replace(pattern, (_, params: string) => {
    const idList = parseGalleryAttachmentIds(params);

    if (idList?.length) {
      return emitInlineGalleryFromIds(idList);
    }

    const category = extractBareOrQuotedParam(params, "category") ?? extractBareOrQuotedParam(params, "type");
    return emitWidgetStub("portfolio", {
      "data-wp-gallery-dynamic": "1",
      ...(category ? { "data-wp-portfolio-category": category } : {}),
    });
  });
}

function flattenIdBasedGalleryShortcodes(
  content: string,
  widgetRegistry: WordPressWidgetRegistry,
): string {
  let html = content;
  for (const tag of widgetRegistry.idGalleryShortcodes) {
    html = flattenIdGalleryShortcode(html, tag);
  }
  return html;
}

const SHORTCODE_WORD_COUNTS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

function normalizeShortcodeCount(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return SHORTCODE_WORD_COUNTS[trimmed];
}

function inferBlogListingLayout(params: string): string {
  const raw =
    extractBareOrQuotedParam(params, "builderLayout") ??
    extractBareOrQuotedParam(params, "layout") ??
    extractBareOrQuotedParam(params, "style");
  if (raw) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "list" || normalized === "grid" || normalized === "featured" || normalized === "sidebar") {
      return normalized;
    }
  }

  const moduleKey = extractBareOrQuotedParam(params, "key");
  if (moduleKey && activeTatsuContext) {
    const merged = mergeTatsuLayoutAttrs(params, moduleKey, activeTatsuContext);
    const fromJson = merged.builderLayout?.trim().toLowerCase();
    if (fromJson === "list" || fromJson === "grid" || fromJson === "featured" || fromJson === "sidebar") {
      return fromJson;
    }
  }

  return "grid";
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTestimonialQuoteFromInner(inner: string): string | undefined {
  const trimmed = inner.trim();
  if (!trimmed) return undefined;

  const paragraphMatch = trimmed.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (paragraphMatch?.[1]) {
    const quote = decodeBasicHtmlEntities(stripHtmlTags(paragraphMatch[1])).trim();
    return quote || undefined;
  }

  const blockquoteMatch = trimmed.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (blockquoteMatch?.[1]) {
    const quote = decodeBasicHtmlEntities(stripHtmlTags(blockquoteMatch[1])).trim();
    return quote || undefined;
  }

  const plain = decodeBasicHtmlEntities(stripHtmlTags(trimmed)).trim();
  return plain || undefined;
}

function parseTestimonialItemAttrs(
  params: string,
  inner: string,
): Record<string, string | undefined> | null {
  const author =
    extractBareOrQuotedParam(params, "author") ??
    extractBareOrQuotedParam(params, "name");
  const role =
    extractBareOrQuotedParam(params, "author_role") ??
    extractBareOrQuotedParam(params, "role") ??
    extractBareOrQuotedParam(params, "title");
  const image =
    extractBareOrQuotedParam(params, "author_image") ??
    extractBareOrQuotedParam(params, "image") ??
    extractBareOrQuotedParam(params, "avatar");
  const quote =
    extractBareOrQuotedParam(params, "quote") ??
    extractBareOrQuotedParam(params, "content") ??
    extractTestimonialQuoteFromInner(inner);
  const rating =
    extractBareOrQuotedParam(params, "rating") ??
    extractBareOrQuotedParam(params, "stars");

  if (!author && !quote) return null;

  return {
    "data-wp-testimonial-author": author,
    "data-wp-testimonial-role": role,
    "data-wp-testimonial-image": image,
    "data-wp-testimonial-quote": quote,
    ...(rating ? { "data-wp-testimonial-rating": rating } : {}),
  };
}

function emitTestimonialItemStub(attrs: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value) parts.push(`${key}="${escapeLayoutAttr(value)}"`);
  }
  return `<div ${parts.join(" ")}>${WP_WIDGET_PLACEHOLDER}</div>`;
}

function emitTestimonialsWidgetStub(
  sectionAttrs: Record<string, string | undefined>,
  items: Array<Record<string, string | undefined>>,
): string {
  const sectionParts = ['data-wp-widget="testimonials"'];
  for (const [key, value] of Object.entries(sectionAttrs)) {
    if (value) sectionParts.push(`${key}="${escapeLayoutAttr(value)}"`);
  }
  const children = items.map((item) => emitTestimonialItemStub(item)).join("");
  return `<section ${sectionParts.join(" ")}>${children}</section>`;
}

function inferTestimonialColumns(
  wrapperParams: string,
  itemCount: number,
): string {
  const explicit =
    normalizeShortcodeCount(extractBareOrQuotedParam(wrapperParams, "columns")) ??
    normalizeShortcodeCount(extractBareOrQuotedParam(wrapperParams, "col"));
  if (explicit) return explicit;
  if (itemCount <= 1) return "1";
  if (itemCount === 2) return "2";
  if (itemCount >= 4) return "4";
  return "3";
}

function collectTestimonialItemsFromInner(
  inner: string,
  itemTag: string,
): Array<Record<string, string | undefined>> {
  const escaped = escapeRegExp(itemTag);
  const pattern = new RegExp(
    `\\[${escaped}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escaped}\\b[^\\]]*\\]`,
    "gi",
  );
  const items: Array<Record<string, string | undefined>> = [];
  inner.replace(pattern, (_, params: string, itemInner: string) => {
    const item = parseTestimonialItemAttrs(params, itemInner);
    if (item) items.push(item);
    return "";
  });
  return items;
}

function isWhitespaceOnlyHtml(html: string): boolean {
  return !decodeBasicHtmlEntities(stripHtmlTags(html)).trim();
}

function extractLeadingTitleH6(inner: string): { title?: string; remainder: string } {
  const match = inner.match(/^\s*<h6[^>]*>([\s\S]*?)<\/h6>/i);
  if (!match) return { remainder: inner.trim() };

  const h6Content = match[1] ?? "";
  if (/<img\b/i.test(h6Content)) return { remainder: inner.trim() };

  const title = decodeBasicHtmlEntities(stripHtmlTags(h6Content)).trim();
  const remainder = inner.slice(match[0]!.length).trim();
  if (!title || isWhitespaceOnlyHtml(h6Content)) {
    return { remainder: inner.trim() };
  }
  return { title, remainder };
}

function isTrackingPixelImage(imgTag: string, src: string): boolean {
  if (/amazon-adsystem\.com/i.test(src)) return true;
  const widthMatch = imgTag.match(/\bwidth\s*=\s*["']?(\d+)["']?/i);
  const heightMatch = imgTag.match(/\bheight\s*=\s*["']?(\d+)["']?/i);
  return widthMatch?.[1] === "1" && heightMatch?.[1] === "1";
}

function extractLinkedBadgeImage(inner: string): { image?: string; link?: string } {
  const linkedImg = inner.match(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<img\b([^>]*)>/i,
  );
  if (linkedImg) {
    const link = linkedImg[1]?.trim();
    const imgAttrs = linkedImg[2] ?? "";
    const srcMatch = imgAttrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = srcMatch?.[1]?.trim();
    if (src && !isTrackingPixelImage(imgAttrs, src)) {
      return { image: src, link: link || undefined };
    }
  }

  const imgMatch = inner.match(/<img\b([^>]*)>/i);
  if (imgMatch) {
    const imgAttrs = imgMatch[1] ?? "";
    const srcMatch = imgAttrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = srcMatch?.[1]?.trim();
    if (src && !isTrackingPixelImage(imgAttrs, src)) {
      return { image: src };
    }
  }

  return {};
}

function extractGridContentTitle(inner: string): string | undefined {
  const pattern = /<h6[^>]*>([\s\S]*?)<\/h6>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner)) !== null) {
    const h6Inner = match[1] ?? "";
    if (/<img\b/i.test(h6Inner)) continue;
    const title = decodeBasicHtmlEntities(stripHtmlTags(h6Inner)).trim();
    if (title) return title;
  }
  return undefined;
}

function extractGridContentBody(inner: string): string | undefined {
  const pattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner)) !== null) {
    const body = match[1]?.trim() ?? "";
    if (body && !isWhitespaceOnlyHtml(body)) return body;
  }
  return undefined;
}

function parseTitleIconFeatureCardAttrs(
  params: string,
  inner: string,
): Record<string, string | undefined> | null {
  const icon = extractBareOrQuotedParam(params, "icon");
  const iconBg = extractBareOrQuotedParam(params, "icon_bg");
  const iconColor = extractBareOrQuotedParam(params, "icon_color");
  const { title, remainder } = extractLeadingTitleH6(inner);
  const body = remainder.trim() || undefined;

  if (!title && !body) return null;

  return {
    "data-wp-feature-icon": icon,
    "data-wp-feature-icon-bg": iconBg,
    "data-wp-feature-icon-color": iconColor,
    "data-wp-feature-title": title,
    "data-wp-feature-body": body,
  };
}

function parseGridContentFeatureCardAttrs(
  _params: string,
  inner: string,
): Record<string, string | undefined> | null {
  const { image, link } = extractLinkedBadgeImage(inner);
  const title = extractGridContentTitle(inner);
  const body = extractGridContentBody(inner);

  if (!title && !body && !image) return null;

  return {
    "data-wp-feature-image": image,
    "data-wp-feature-link": link,
    "data-wp-feature-title": title,
    "data-wp-feature-body": body,
  };
}

function parseFeatureCardItemAttrs(
  tag: string,
  params: string,
  inner: string,
): Record<string, string | undefined> | null {
  if (tag.toLowerCase() === "tatsu_title_icon") {
    return parseTitleIconFeatureCardAttrs(params, inner);
  }
  if (tag.toLowerCase() === "grid_content") {
    return parseGridContentFeatureCardAttrs(params, inner);
  }
  return null;
}

function emitFeatureCardStub(attrs: Record<string, string | undefined>): string {
  const parts = ["data-wp-feature-card"];
  for (const [key, value] of Object.entries(attrs)) {
    if (value) parts.push(`${key}="${escapeLayoutAttr(value)}"`);
  }
  return `<div ${parts.join(" ")}>${WP_WIDGET_PLACEHOLDER}</div>`;
}

function emitFeaturesGridWidgetStub(
  sectionAttrs: Record<string, string | undefined>,
  items: Array<Record<string, string | undefined>>,
): string {
  const sectionParts = ['data-wp-widget="features-grid"'];
  for (const [key, value] of Object.entries(sectionAttrs)) {
    if (value) sectionParts.push(`${key}="${escapeLayoutAttr(value)}"`);
  }
  const children = items.map((item) => emitFeatureCardStub(item)).join("");
  return `<section ${sectionParts.join(" ")}>${children}</section>`;
}

function inferFeatureColumns(wrapperParams: string, itemCount: number): string {
  const explicit =
    normalizeShortcodeCount(extractBareOrQuotedParam(wrapperParams, "column")) ??
    normalizeShortcodeCount(extractBareOrQuotedParam(wrapperParams, "columns")) ??
    normalizeShortcodeCount(extractBareOrQuotedParam(wrapperParams, "col"));
  if (explicit) return explicit;
  if (itemCount <= 1) return "1";
  if (itemCount === 2) return "2";
  if (itemCount >= 4) return "4";
  return "3";
}

function collectFeatureCardItemsFromInner(
  inner: string,
  itemTags: readonly string[],
): Array<Record<string, string | undefined>> {
  const items: Array<Record<string, string | undefined>> = [];
  for (const itemTag of itemTags) {
    const escaped = escapeRegExp(itemTag);
    const pattern = new RegExp(
      `\\[${escaped}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escaped}\\b[^\\]]*\\]`,
      "gi",
    );
    inner.replace(pattern, (_, params: string, itemInner: string) => {
      const item = parseFeatureCardItemAttrs(itemTag, params, itemInner);
      if (item) items.push(item);
      return "";
    });
  }
  return items;
}

function flattenFeatureCardShortcodes(
  content: string,
  widgetRegistry: WordPressWidgetRegistry,
): string {
  const itemTags = widgetRegistry.featureCardShortcodeTags;
  let html = content;

  for (const wrapperTag of widgetRegistry.featuresGridWrapperTags) {
    const escaped = escapeRegExp(wrapperTag);
    const pattern = new RegExp(
      `\\[${escaped}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escaped}\\b[^\\]]*\\]`,
      "gi",
    );
    html = html.replace(pattern, (fullMatch, wrapperParams: string, inner: string) => {
      const items = collectFeatureCardItemsFromInner(inner, itemTags);
      if (items.length === 0) return fullMatch;

      return emitFeaturesGridWidgetStub(
        {
          "data-wp-feature-columns": inferFeatureColumns(wrapperParams, items.length),
        },
        items,
      );
    });
  }

  for (const tag of itemTags) {
    const escaped = escapeRegExp(tag);
    const pattern = new RegExp(
      `\\[${escaped}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escaped}\\b[^\\]]*\\]`,
      "gi",
    );
    html = html.replace(pattern, (fullMatch, params: string, inner: string) => {
      const item = parseFeatureCardItemAttrs(tag, params, inner);
      if (!item) return fullMatch;
      return emitFeatureCardStub(item);
    });
  }

  return html;
}

function flattenTestimonialsShortcodes(
  content: string,
  widgetRegistry: WordPressWidgetRegistry,
): string {
  const itemTag = widgetRegistry.testimonialItemTag;
  let html = content;

  for (const wrapperTag of widgetRegistry.testimonialsWrapperTags) {
    const escaped = escapeRegExp(wrapperTag);
    const pattern = new RegExp(
      `\\[${escaped}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escaped}\\b[^\\]]*\\]`,
      "gi",
    );
    html = html.replace(pattern, (fullMatch, wrapperParams: string, inner: string) => {
      const items = collectTestimonialItemsFromInner(inner, itemTag);
      if (items.length === 0) return fullMatch;

      return emitTestimonialsWidgetStub(
        {
          "data-wp-testimonial-columns": inferTestimonialColumns(wrapperParams, items.length),
          "data-wp-testimonial-show-stars": items.some((item) => item["data-wp-testimonial-rating"])
            ? "true"
            : "false",
        },
        items,
      );
    });
  }

  const itemPattern = new RegExp(
    `\\[${escapeRegExp(itemTag)}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escapeRegExp(itemTag)}\\b[^\\]]*\\]`,
    "gi",
  );
  return html.replace(itemPattern, (fullMatch, params: string, inner: string) => {
    const item = parseTestimonialItemAttrs(params, inner);
    if (!item) return fullMatch;
    return emitTestimonialsWidgetStub(
      {
        "data-wp-testimonial-columns": "1",
        "data-wp-testimonial-show-stars": item["data-wp-testimonial-rating"] ? "true" : "false",
      },
      [item],
    );
  });
}

function flattenSliderShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  let html = content;
  for (const tag of widgetRegistry.sliderShortcodeTags) {
    const escaped = escapeRegExp(tag);
    const plugin: SliderPluginId = tag.toLowerCase() === "masterslider" ? "masterslider" : "revslider";
    const pattern = new RegExp(`\\[${escaped}\\b([^\\]]*)\\](?:\\s*\\[\\/${escaped}\\b[^\\]]*\\])?`, "gi");
    html = html.replace(pattern, (_, params: string) => {
      const alias = extractBareOrQuotedParam(params, "alias");
      const slidertitle = extractBareOrQuotedParam(params, "slidertitle");
      return emitWidgetStub("slider", {
        "data-wp-slider-plugin": plugin,
        ...(alias ? { "data-wp-slider-alias": alias } : {}),
        ...(slidertitle ? { "data-wp-slider-title": slidertitle } : {}),
      });
    });
  }
  return html;
}

function flattenBlogListingShortcodes(
  content: string,
  widgetRegistry: WordPressWidgetRegistry,
): string {
  let html = content;
  for (const tag of widgetRegistry.blogShortcodeTags) {
    const escaped = escapeRegExp(tag);
    const pattern = new RegExp(`\\[${escaped}\\b([^\\]]*)\\](?:\\s*\\[\\/${escaped}\\])?`, "gi");
    html = html.replace(pattern, (_, params: string) => {
      const limit =
        normalizeShortcodeCount(extractBareOrQuotedParam(params, "number_of_posts")) ??
        normalizeShortcodeCount(extractBareOrQuotedParam(params, "count")) ??
        normalizeShortcodeCount(extractBareOrQuotedParam(params, "posts_per_page")) ??
        normalizeShortcodeCount(extractBareOrQuotedParam(params, "number"));
      const filterBy = extractBareOrQuotedParam(params, "filter_by")?.toLowerCase();
      const categories = extractBareOrQuotedParam(params, "categories");
      const tags = extractBareOrQuotedParam(params, "tags");
      const col = extractBareOrQuotedParam(params, "col");

      return emitWidgetStub(
        "blog-listing",
        {
          "data-wp-blog-layout": inferBlogListingLayout(params),
          ...(limit ? { "data-wp-blog-limit": limit } : {}),
          ...(col ? { "data-wp-blog-columns": col } : {}),
          ...(filterBy === "category" && categories ? { "data-wp-blog-category": categories } : {}),
          ...(filterBy === "tag" && tags ? { "data-wp-blog-tags": tags } : {}),
        },
        "section",
      );
    });
  }
  return html;
}

function flattenPortfolioShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  const tag = escapeRegExp(widgetRegistry.portfolioShortcode);
  const pattern = new RegExp(`\\[${tag}\\b([^\\]]*)\\](?:\\s*\\[\\/${tag}\\])?`, "gi");
  return content.replace(pattern, (_, params: string) => {
    const category = extractBareOrQuotedParam(params, "category");
    const slug = extractBareOrQuotedParam(params, "slug");
    return emitWidgetStub("portfolio", {
      ...(category ? { "data-wp-portfolio-category": category } : {}),
      ...(slug ? { "data-wp-portfolio-slug": slug } : {}),
    });
  });
}

function flattenVideoShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  let html = content;
  for (const prefix of widgetRegistry.videoShortcodePrefixes) {
    const wrapped = new RegExp(
      `\\[${escapeRegExp(prefix)}\\b([^\\]]*)\\]([\\s\\S]*?)\\[\\/${escapeRegExp(prefix)}\\b[^\\]]*\\]`,
      "gi",
    );
    html = html.replace(wrapped, (_, params: string, inner: string) =>
      emitVideoWidgetFromParams(params, inner),
    );

    const selfClosing = new RegExp(
      `\\[${escapeRegExp(prefix)}\\b([^\\]]*)\\]`,
      "gi",
    );
    html = html.replace(selfClosing, (_, params: string) => emitVideoWidgetFromParams(params, ""));
  }
  return html;
}

/** Detect embedded HTML contact forms (e.g. Tatsu `[tatsu_code]` with `<form>`). */
export function looksLikeContactFormHtml(formHtml: string): boolean {
  if (!/<form\b/i.test(formHtml)) return false;

  const lower = formHtml.toLowerCase();
  if (/searchform|wp-login-form|loginform|lostpasswordform/i.test(lower)) return false;
  if (/type\s*=\s*["']search["']/i.test(formHtml)) return false;
  if (/newsletter|subscribe/i.test(lower) && !/<textarea\b/i.test(formHtml)) return false;

  const hasEmailField =
    /type\s*=\s*["']email["']/i.test(formHtml) ||
    /name\s*=\s*["'][^"']*email/i.test(formHtml) ||
    /class\s*=\s*["'][^"']*email/i.test(formHtml);
  const hasMessageField =
    /<textarea\b/i.test(formHtml) ||
    /name\s*=\s*["'][^"']*(message|comment|body|enquiry|inquiry)/i.test(formHtml);
  const hasContactHint =
    /contact|serverless-contact|get-in-touch|request-quote|quote-request/i.test(lower);

  if (hasEmailField && hasMessageField) return true;
  if (hasContactHint && hasEmailField) return true;
  if (hasContactHint && hasMessageField) return true;

  return false;
}

function stripContactFormHelperScripts(html: string): string {
  return html.replace(
    /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:recaptcha|contact_form|contact-form)[^"']*["'][^>]*>\s*<\/script>\s*/gi,
    "",
  );
}

function flattenCustomHtmlContactForms(content: string): string {
  let html = content.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, (formHtml) => {
    if (!looksLikeContactFormHtml(formHtml)) return formHtml;

    const formId =
      formHtml.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ||
      formHtml.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();

    return emitWidgetStub(
      "contact-form",
      {
        "data-wp-form-source": "custom-html",
        ...(formId ? { "data-wp-form-id": formId } : {}),
      },
      "section",
    );
  });

  html = stripContactFormHelperScripts(html);
  return html;
}

/** Cross-builder widget + video stubs (before scaffolding strip). */
function flattenWordPressWidgets(
  content: string,
  widgetRegistry: WordPressWidgetRegistry = WORDPRESS_WIDGET_REGISTRY,
): string {
  let html = content;
  html = flattenGalleryShortcodes(html, widgetRegistry);
  html = flattenIdBasedGalleryShortcodes(html, widgetRegistry);
  html = flattenPortfolioShortcodes(html, widgetRegistry);
  html = flattenSliderShortcodes(html, widgetRegistry);
  html = flattenBlogListingShortcodes(html, widgetRegistry);
  html = flattenTestimonialsShortcodes(html, widgetRegistry);
  html = flattenFeatureCardShortcodes(html, widgetRegistry);
  html = flattenMapShortcodes(html, widgetRegistry);
  html = flattenContactFormShortcodes(html, widgetRegistry);
  html = flattenVideoShortcodes(html, widgetRegistry);
  html = flattenCustomHtmlContactForms(html);
  return html;
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

  activeTatsuContext = options.tatsuPageContent
    ? buildTatsuPageContext(options.tatsuPageContent)
    : undefined;

  try {
    const registry = options.registry ?? WORDPRESS_BUILDER_REGISTRY;
    const themes = detectThemes(content, registry);

    const widgetRegistry = options.widgetRegistry ?? WORDPRESS_WIDGET_REGISTRY;
    // Widget stubs before scaffolding strips (e.g. blox_gmap, tatsu_video, portfolio).
    let html = flattenWordPressWidgets(content, widgetRegistry);
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
      for (const rule of theme.iconImageRules ?? []) {
        html = convertIconImageRule(html, rule);
      }
      for (const rule of theme.linkRules ?? []) {
        html = convertLinkRule(html, rule);
      }
      for (const layoutMap of collectLayoutMaps(theme)) {
        html = applyStructuralLayoutMap(html, layoutMap);
      }
      for (const prefix of theme.scaffoldingPrefixes ?? []) {
        html = stripScaffoldingPrefix(html, prefix);
      }
      if (theme.legacyScaffoldingTokens?.length) {
        html = stripLegacyTokens(html, theme.legacyScaffoldingTokens);
      }
    }

    // Catch widget shortcodes revealed after wrapper unwrap (e.g. blox_gmap inside tatsu_text_with_shortcodes).
    html = flattenWordPressWidgets(html, widgetRegistry);

    html = html.replace(/\n{3,}/g, "\n\n").trim();

    return {
      html,
      detectedThemes: themes.map((theme) => theme.id),
    };
  } finally {
    activeTatsuContext = undefined;
  }
}
