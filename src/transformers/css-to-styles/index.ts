import type { GrapesStyleRule } from "../html-to-grapes/types.js";

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const declaration of block.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const property = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!property || !value) continue;
    style[property] = value;
  }
  return style;
}

/** Parse `<style>` blocks and class rules into Grapes root `styles[]`. */
export function cssToStyles(css: string): GrapesStyleRule[] {
  const cleaned = stripCssComments(css);
  const rules: GrapesStyleRule[] = [];
  const rulePattern = /([^{]+)\{([^}]*)\}/g;

  for (const match of cleaned.matchAll(rulePattern)) {
    const selectorText = match[1]?.trim() ?? "";
    const declarationBlock = match[2] ?? "";
    if (!selectorText || selectorText.startsWith("@")) continue;

    const style = parseDeclarations(declarationBlock);
    if (Object.keys(style).length === 0) continue;

    const selectors = selectorText
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);

    if (selectors.length === 0) continue;
    rules.push({ selectors, style });
  }

  return rules;
}
