export interface HtmlToGrapesOptions {
  /** Map source class names to Grapes component types. */
  componentMap?: Record<string, string>;
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
