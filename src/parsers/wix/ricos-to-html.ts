interface RicosNode {
  type?: string;
  nodes?: RicosNode[];
  textData?: {
    text?: string;
    decorations?: Array<{ type?: string; linkData?: { link?: { url?: string } } }>;
  };
  headingData?: { level?: number };
  imageData?: {
    image?: { src?: { url?: string }; altText?: string };
    containerData?: { alignment?: string };
  };
  htmlData?: { html?: string; containerData?: unknown };
  linkData?: { link?: { url?: string } };
  buttonData?: { text?: string; link?: { url?: string } };
  blockquoteData?: unknown;
  codeBlockData?: { textStyle?: unknown };
  paragraphData?: unknown;
  bulletedListData?: unknown;
  orderedListData?: unknown;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTextNode(node: RicosNode): string {
  const text = node.textData?.text ?? "";
  let html = escapeHtml(text);
  for (const decoration of node.textData?.decorations ?? []) {
    switch (decoration.type) {
      case "BOLD":
        html = `<strong>${html}</strong>`;
        break;
      case "ITALIC":
        html = `<em>${html}</em>`;
        break;
      case "UNDERLINE":
        html = `<u>${html}</u>`;
        break;
      case "LINK": {
        const href = decoration.linkData?.link?.url;
        if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;
        break;
      }
      default:
        break;
    }
  }
  return html;
}

function renderChildren(nodes: RicosNode[] | undefined): string {
  return (nodes ?? []).map((node) => renderRicosNode(node)).join("");
}

function renderRicosNode(node: RicosNode): string {
  const type = (node.type ?? "").toUpperCase();

  switch (type) {
    case "TEXT":
      return renderTextNode(node);
    case "PARAGRAPH":
      return `<p>${renderChildren(node.nodes)}</p>`;
    case "HEADING": {
      const level = Math.min(6, Math.max(1, node.headingData?.level ?? 2));
      return `<h${level}>${renderChildren(node.nodes)}</h${level}>`;
    }
    case "BULLETED_LIST":
      return `<ul>${renderChildren(node.nodes)}</ul>`;
    case "ORDERED_LIST":
      return `<ol>${renderChildren(node.nodes)}</ol>`;
    case "LIST_ITEM":
      return `<li>${renderChildren(node.nodes)}</li>`;
    case "BLOCKQUOTE":
      return `<blockquote>${renderChildren(node.nodes)}</blockquote>`;
    case "HTML":
      return node.htmlData?.html ?? "";
    case "IMAGE": {
      const src = node.imageData?.image?.src?.url;
      if (!src) return "";
      const alt = node.imageData?.image?.altText
        ? ` alt="${escapeHtml(node.imageData.image.altText)}"`
        : "";
      return `<figure><img src="${escapeHtml(src)}"${alt} /></figure>`;
    }
    case "BUTTON": {
      const label = escapeHtml(node.buttonData?.text ?? "Link");
      const href = node.buttonData?.link?.url ?? node.linkData?.link?.url;
      if (!href) return `<span>${label}</span>`;
      return `<p><a href="${escapeHtml(href)}">${label}</a></p>`;
    }
    case "CODE_BLOCK":
      return `<pre><code>${renderChildren(node.nodes)}</code></pre>`;
    case "DIVIDER":
      return "<hr />";
    default:
      return renderChildren(node.nodes);
  }
}

/** Convert Wix Ricos rich content JSON into static HTML for NormalizedPost.contentHtml. */
export function ricosToHtml(richContent: unknown): string {
  if (!richContent || typeof richContent !== "object") return "";
  const nodes = (richContent as { nodes?: RicosNode[] }).nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return "";
  return renderChildren(nodes);
}
