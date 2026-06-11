import { normalizeAssetUrl } from "../../../lib/media-urls.js";
import type {
  BuilderIconImageRule,
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

function openSectionDiv(params: string, bgParamName?: string): string {
  const attrs = ['data-layout="section"'];
  const bgImage = extractQuotedParam(params, bgParamName ?? "bg_image");
  if (bgImage?.startsWith("http")) {
    attrs.push(`data-bg-image="${escapeLayoutAttr(bgImage)}"`);
  }
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

function convertIconImageRule(content: string, rule: BuilderIconImageRule): string {
  const prefix = escapeRegExp(rule.shortcodePrefix);
  const pattern = new RegExp(
    `\\[${prefix}\\b([^\\]]*)\\]\\s*(?:\\[\\/${prefix}\\b[^\\]]*\\])?`,
    "gi",
  );

  return content.replace(pattern, (_, params: string) => {
    const iconImage = extractQuotedParam(params, rule.imageParam);
    if (!iconImage?.startsWith("http") || iconImage.includes("placehold")) {
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

/** OSS-16 — normalize YouTube/Vimeo share URLs to canonical embed URLs. */
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

function flattenMapShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  let html = content;
  for (const prefix of widgetRegistry.mapShortcodePrefixes) {
    const pattern = new RegExp(
      `\\[${escapeRegExp(prefix)}\\b([^\\]]*)\\]\\s*(?:\\[\\/${escapeRegExp(prefix)}\\b[^\\]]*\\])?`,
      "gi",
    );
    html = html.replace(pattern, (_, params: string) => {
      const embedUrl = extractShortcodeParam(params, ["embed_url", "url", "src", "map_url"]);
      const query = extractBareOrQuotedParam(params, "address") ?? extractBareOrQuotedParam(params, "q");
      return emitWidgetStub("map", {
        ...(embedUrl?.includes("google.com/maps") ? { "data-embed-url": embedUrl } : {}),
        ...(query && !embedUrl ? { "data-wp-map-query": query } : {}),
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

function flattenGalleryShortcodes(content: string, widgetRegistry: WordPressWidgetRegistry): string {
  const tag = escapeRegExp(widgetRegistry.galleryShortcode);
  const pattern = new RegExp(`\\[${tag}\\b([^\\]]*)\\](?:\\s*\\[\\/${tag}\\])?`, "gi");
  return content.replace(pattern, (_, params: string) => {
    const ids = extractBareOrQuotedParam(params, "ids");
    const idList = ids
      ?.split(",")
      .map((part) => part.trim())
      .filter((part) => /^\d+$/.test(part));

    if (idList?.length) {
      const images = idList
        .map((id) => `<img data-wp-attachment-id="${escapeLayoutAttr(id)}" alt="" />`)
        .join("");
      return `<figure data-wp-inline-gallery>${images}</figure>`;
    }

    const category = extractBareOrQuotedParam(params, "category") ?? extractBareOrQuotedParam(params, "type");
    return emitWidgetStub("portfolio", {
      "data-wp-gallery-dynamic": "1",
      ...(category ? { "data-wp-portfolio-category": category } : {}),
    });
  });
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

/** OSS-12 / OSS-16 — cross-builder widget + video stubs (before scaffolding strip). */
function flattenWordPressWidgets(
  content: string,
  widgetRegistry: WordPressWidgetRegistry = WORDPRESS_WIDGET_REGISTRY,
): string {
  let html = content;
  html = flattenGalleryShortcodes(html, widgetRegistry);
  html = flattenPortfolioShortcodes(html, widgetRegistry);
  html = flattenMapShortcodes(html, widgetRegistry);
  html = flattenContactFormShortcodes(html, widgetRegistry);
  html = flattenVideoShortcodes(html, widgetRegistry);
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

  html = html.replace(/\n{3,}/g, "\n\n").trim();

  return {
    html,
    detectedThemes: themes.map((theme) => theme.id),
  };
}
