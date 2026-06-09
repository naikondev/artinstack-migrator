import { z } from "zod";

import type { ValidationIssue, ValidationResult } from "../normalizer/types.js";
import type { TiptapDoc, TiptapNode } from "./html-to-tiptap/types.js";

export const tiptapMarkSchema = z.object({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.string()).optional(),
});

export const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("text"),
      text: z.string(),
      marks: z.array(tiptapMarkSchema).optional(),
    }),
    z.object({
      type: z.string().min(1),
      attrs: z.record(z.unknown()).optional(),
      content: z.array(tiptapNodeSchema).optional(),
      marks: z.array(tiptapMarkSchema).optional(),
    }),
  ]),
);

export const tiptapDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(tiptapNodeSchema),
});

export interface ValidateTiptapDocOptions {
  /** When set, every node `type` in the tree must be in this allowlist. */
  allowedNodeTypes?: string[];
  /** When set, every mark `type` must be in this allowlist. */
  allowedMarkTypes?: string[];
}

function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.length > 0 ? issue.path.join(".") : undefined,
  }));
}

function collectNodeTypes(nodes: TiptapNode[]): string[] {
  const types: string[] = [];
  for (const node of nodes) {
    types.push(node.type);
    if (node.content?.length) {
      types.push(...collectNodeTypes(node.content));
    }
  }
  return types;
}

function collectMarkTypes(nodes: TiptapNode[]): string[] {
  const types: string[] = [];
  for (const node of nodes) {
    if (node.marks?.length) {
      types.push(...node.marks.map((mark) => mark.type));
    }
    if (node.content?.length) {
      types.push(...collectMarkTypes(node.content));
    }
  }
  return types;
}

function validateAllowedTypes(
  doc: TiptapDoc,
  allowedNodeTypes: string[] | undefined,
  allowedMarkTypes: string[] | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (allowedNodeTypes) {
    const allowlist = new Set(allowedNodeTypes);
    for (const nodeType of collectNodeTypes(doc.content)) {
      if (!allowlist.has(nodeType)) {
        issues.push({
          code: "invalid_node_type",
          message: `Node type "${nodeType}" is not in allowedNodeTypes`,
          path: "content",
        });
      }
    }
  }

  if (allowedMarkTypes) {
    const allowlist = new Set(allowedMarkTypes);
    for (const markType of collectMarkTypes(doc.content)) {
      if (!allowlist.has(markType)) {
        issues.push({
          code: "invalid_mark_type",
          message: `Mark type "${markType}" is not in allowedMarkTypes`,
          path: "content",
        });
      }
    }
  }

  return issues;
}

/** Opt-in structural check for a Tiptap / ProseMirror document. */
export function validateTiptapDoc(
  doc: unknown,
  options: ValidateTiptapDocOptions = {},
): ValidationResult {
  const parsed = tiptapDocSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToValidationIssues(parsed.error.issues) };
  }

  const typeIssues = validateAllowedTypes(
    parsed.data,
    options.allowedNodeTypes,
    options.allowedMarkTypes,
  );
  if (typeIssues.length > 0) {
    return { ok: false, issues: typeIssues };
  }

  return { ok: true, issues: [] };
}
