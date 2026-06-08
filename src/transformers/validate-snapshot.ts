import { z } from "zod";

import type { ValidationIssue, ValidationResult } from "../normalizer/types.js";
import type { GrapesComponent, GrapesProjectSnapshot } from "./html-to-grapes/types.js";

export const grapesStyleRuleSchema = z.object({
  selectors: z.array(z.string().min(1)).min(1),
  style: z.record(z.string(), z.string()),
});

export const grapesComponentSchema: z.ZodType<GrapesComponent> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    tagName: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    classes: z.array(z.string()).optional(),
    components: z.array(grapesComponentSchema).optional(),
    content: z.string().optional(),
    void: z.boolean().optional(),
  }),
);

export const grapesProjectSnapshotSchema = z.object({
  content: z.array(grapesComponentSchema),
  styles: z.array(grapesStyleRuleSchema),
  contentHtml: z.string().optional(),
  contentCss: z.string().optional(),
});

export interface ValidateGrapesProjectSnapshotOptions {
  /** When set, every component `type` in the tree must be in this allowlist. */
  allowedComponentTypes?: string[];
}

function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.length > 0 ? issue.path.join(".") : undefined,
  }));
}

function collectComponentTypes(components: GrapesComponent[]): string[] {
  const types: string[] = [];
  for (const component of components) {
    types.push(component.type);
    if (component.components?.length) {
      types.push(...collectComponentTypes(component.components));
    }
  }
  return types;
}

function validateAllowedComponentTypes(
  snapshot: GrapesProjectSnapshot,
  allowedComponentTypes: string[],
): ValidationIssue[] {
  const allowlist = new Set(allowedComponentTypes);
  const issues: ValidationIssue[] = [];

  for (const componentType of collectComponentTypes(snapshot.content)) {
    if (!allowlist.has(componentType)) {
      issues.push({
        code: "invalid_component_type",
        message: `Component type "${componentType}" is not in allowedComponentTypes`,
        path: "content",
      });
    }
  }

  return issues;
}

/**
 * Opt-in structural check for a Grapes project snapshot (not a full Grapes editor project file).
 * Does not validate host-specific component registries unless `allowedComponentTypes` is passed.
 */
export function validateGrapesProjectSnapshot(
  snapshot: unknown,
  options: ValidateGrapesProjectSnapshotOptions = {},
): ValidationResult {
  const result = grapesProjectSnapshotSchema.safeParse(snapshot);
  if (!result.success) {
    return { ok: false, issues: zodIssuesToValidationIssues(result.error.issues) };
  }

  if (options.allowedComponentTypes?.length) {
    const typeIssues = validateAllowedComponentTypes(result.data, options.allowedComponentTypes);
    if (typeIssues.length > 0) {
      return { ok: false, issues: typeIssues };
    }
  }

  return { ok: true, issues: [] };
}
