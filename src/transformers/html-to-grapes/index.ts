/** Phase 2+: cheerio/jsdom HTML walk → Grapes `content` + root `styles`. */
export interface HtmlToGrapesOptions {
  /** Map source class names to Grapes component types. */
  componentMap?: Record<string, string>;
}

export interface GrapesStyleRule {
  selectors: string[];
  style: Record<string, string>;
}

export interface GrapesProjectSnapshot {
  content: unknown[];
  styles: GrapesStyleRule[];
  contentHtml?: string;
  contentCss?: string;
}

export function htmlToGrapes(_html: string, _options?: HtmlToGrapesOptions): GrapesProjectSnapshot {
  throw new Error("HtmlToGrapesParser is not implemented yet (Phase 2+)");
}
