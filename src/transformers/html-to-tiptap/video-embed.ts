import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

import { normalizeVideoEmbedUrl } from "../../parsers/wordpress/builders/flatten.js";
import type { TiptapNode } from "./types.js";

type CheerioSelection = Cheerio<AnyNode>;

const VIDEO_WIDGET = "video";

const VIDEO_IFRAME_SRC =
  /youtube\.com\/embed|youtube-nocookie\.com\/embed|youtu\.be|player\.vimeo\.com\/video/i;

export function isVideoWidgetElement($el: CheerioSelection): boolean {
  return $el.attr("data-wp-widget")?.toLowerCase() === VIDEO_WIDGET;
}

function buildVideoEmbedNode(input: {
  embedUrl: string;
  provider: string;
}): TiptapNode {
  return {
    type: "embed",
    attrs: {
      src: input.embedUrl,
      provider: input.provider,
      dataWpWidget: VIDEO_WIDGET,
      dataEmbedUrl: input.embedUrl,
      dataVideoProvider: input.provider,
    },
  };
}

export function videoEmbedNodeFromWidget($el: CheerioSelection): TiptapNode | null {
  const embedUrl = $el.attr("data-embed-url")?.trim();
  if (!embedUrl) return null;

  const provider = $el.attr("data-video-provider")?.trim() || "external";
  return buildVideoEmbedNode({ embedUrl, provider });
}

export function videoEmbedNodeFromIframe($el: CheerioSelection): TiptapNode | null {
  const src = $el.attr("src")?.trim();
  if (!src || !VIDEO_IFRAME_SRC.test(src)) return null;

  const normalized = normalizeVideoEmbedUrl(src);
  return buildVideoEmbedNode({
    embedUrl: normalized?.embedUrl ?? src,
    provider: normalized?.provider ?? "external",
  });
}

export function isPreservedVideoIframe($el: CheerioSelection, tagName: string | undefined): boolean {
  if (tagName !== "iframe") return false;
  const src = $el.attr("src")?.trim() ?? "";
  return VIDEO_IFRAME_SRC.test(src);
}
