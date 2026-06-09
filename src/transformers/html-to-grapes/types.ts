export type LayoutKind = "section" | "row" | "column";

/** Map OSS-2 `data-layout` markers to Grapes component types (host may override). */
export interface LayoutTypeMap {
  section?: string;
  row?: string;
  column?: string;
}

export interface HtmlToGrapesOptions {
  /** Map source class names to Grapes component types. */
  componentMap?: Record<string, string>;
  /** Map HTML tag names to Grapes component types (e.g. `h2` → `heading`). */
  tagMap?: Record<string, string>;
  /** Map `data-layout` section/row/column markers to Grapes component types. */
  layoutTypeMap?: LayoutTypeMap;
}

export interface GrapesStyleRule {
  selectors: string[];
  style: Record<string, string>;
}

export interface GrapesComponent {
  type: string;
  tagName?: string;
  attributes?: Record<string, string>;
  classes?: string[];
  components?: GrapesComponent[];
  content?: string;
  void?: boolean;
}

export interface GrapesProjectSnapshot {
  content: GrapesComponent[];
  styles: GrapesStyleRule[];
  contentHtml?: string;
  contentCss?: string;
}
