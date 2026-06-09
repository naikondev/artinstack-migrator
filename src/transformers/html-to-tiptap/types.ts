/** ProseMirror / Tiptap mark (inline formatting). */
export interface TiptapMark {
  type: string;
  attrs?: Record<string, string>;
}

/** ProseMirror / Tiptap node — text nodes use `text`; others use `content`. */
export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

/** Root Tiptap document (`content_json` shape). */
export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

export interface HtmlToTiptapOptions {
  /**
   * Unwrap OSS-2 `data-layout` scaffolding (section/row/column divs) into prose blocks.
   * @default true
   */
  unwrapLayoutMarkers?: boolean;
}
