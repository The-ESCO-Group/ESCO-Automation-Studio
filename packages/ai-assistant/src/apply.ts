import type { PlcProject } from "@esco/core";
import {
  addRungFromText,
  createTag,
  validateProject,
  type AddRungFromTextInput,
  type CreateTagInput,
} from "@esco/project-actions";
import type { ApplyResult, AssistantPlan } from "./types";

/**
 * Apply a plan through the controlled project-action layer, one action at a
 * time. Never mutates the input project. Stops at the first hard failure (a
 * "tag already exists" createTag is treated as reuse and skipped). Validation
 * is run over the final project.
 */
export function applyPlan(project: PlcProject, plan: AssistantPlan): ApplyResult {
  let current = project;
  const applied: string[] = [];

  for (const action of plan.actions) {
    if (action.kind === "createTag") {
      const result = createTag(current, action.input as CreateTagInput);
      if (!result.ok) {
        if (/already exists/i.test(result.error ?? "")) {
          applied.push(action.id); // reuse the existing tag
          continue;
        }
        return finish(current, applied, result.error);
      }
      current = result.project;
      applied.push(action.id);
    } else if (action.kind === "addRungFromText") {
      const result = addRungFromText(current, action.input as AddRungFromTextInput);
      if (!result.ok) return finish(current, applied, result.error);
      current = result.project;
      applied.push(action.id);
    } else {
      return finish(current, applied, `Unknown action kind: ${action.kind}`);
    }
  }

  return finish(current, applied);
}

function finish(project: PlcProject, applied: string[], error?: string): ApplyResult {
  return {
    ok: !error,
    project,
    applied,
    findings: validateProject(project).findings ?? [],
    error,
  };
}
