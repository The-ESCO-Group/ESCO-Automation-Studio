import type { PlcProject } from "@esco/core";
import {
  addBranchLeg,
  addInstruction,
  addInstructionToBranch,
  addParallelBranch,
  addRung,
  addRungFromText,
  createRoutine,
  createTag,
  deleteRung,
  deleteTag,
  removeInstruction,
  renameTag,
  setRungComment,
  setTagDescription,
  updateInstructionOperand,
  validateProject,
  type AddInstructionInput,
  type AddInstructionToBranchInput,
  type AddRungFromTextInput,
  type AddRungInput,
  type BranchInput,
  type CreateRoutineInput,
  type CreateTagInput,
  type DeleteRungInput,
  type DeleteTagInput,
  type ProjectActionResult,
  type RemoveInstructionInput,
  type RenameTagInput,
  type SetRungCommentInput,
  type SetTagDescriptionInput,
  type UpdateOperandInput,
} from "@esco/project-actions";
import type { ApplyResult, AssistantPlan, ProposedProjectAction } from "./types";

export interface ActionOutcome {
  ok: boolean;
  project: PlcProject;
  warnings?: string[];
  error?: string;
}

/**
 * Dispatch ONE proposed action through the controlled project-action layer.
 * This is the single whitelist: any `kind` not handled here is rejected, so the
 * AI can never reach an action outside `@esco/project-actions`. Never throws for
 * expected failures; never mutates the input project.
 */
export function applyAction(project: PlcProject, action: ProposedProjectAction): ActionOutcome {
  const input = (action.input ?? {}) as Record<string, unknown>;
  const wrap = (r: ProjectActionResult): ActionOutcome => ({
    ok: r.ok,
    project: r.project,
    warnings: r.warnings,
    error: r.error,
  });

  switch (action.kind) {
    case "createTag": {
      const r = createTag(project, input as unknown as CreateTagInput);
      // Treat "already exists" as reuse — not a hard failure.
      if (!r.ok && /already exists/i.test(r.error ?? "")) return { ok: true, project };
      return wrap(r);
    }
    case "renameTag":
      return wrap(renameTag(project, input as unknown as RenameTagInput));
    case "deleteTag":
      return wrap(deleteTag(project, input as unknown as DeleteTagInput));
    case "setTagDescription":
      return wrap(setTagDescription(project, input as unknown as SetTagDescriptionInput));
    case "createRoutine":
      return wrap(createRoutine(project, input as unknown as CreateRoutineInput));
    case "addRung":
      return wrap(addRung(project, input as unknown as AddRungInput));
    case "addRungFromText":
      return wrap(addRungFromText(project, input as unknown as AddRungFromTextInput));
    case "deleteRung":
      return wrap(deleteRung(project, input as unknown as DeleteRungInput));
    case "addInstruction":
      return wrap(addInstruction(project, input as unknown as AddInstructionInput));
    case "removeInstruction":
      return wrap(removeInstruction(project, input as unknown as RemoveInstructionInput));
    case "updateInstructionOperand":
      return wrap(updateInstructionOperand(project, input as unknown as UpdateOperandInput));
    case "setRungComment":
      return wrap(setRungComment(project, input as unknown as SetRungCommentInput));
    case "addParallelBranch":
      return wrap(addParallelBranch(project, input as unknown as BranchInput));
    case "addBranchLeg":
      return wrap(addBranchLeg(project, input as unknown as BranchInput));
    case "addInstructionToBranch":
      return wrap(addInstructionToBranch(project, input as unknown as AddInstructionToBranchInput));
    default:
      return { ok: false, project, error: `Unknown or blocked action kind: ${action.kind}` };
  }
}

/**
 * Apply a plan through the controlled project-action layer, one action at a time.
 * Never mutates the input project. Stops at the first hard failure. Validation is
 * always run over the final project (no AI edit bypasses validation).
 */
export function applyPlan(project: PlcProject, plan: AssistantPlan): ApplyResult {
  let current = project;
  const applied: string[] = [];

  for (const action of plan.actions) {
    const outcome = applyAction(current, action);
    if (!outcome.ok) return finish(current, applied, outcome.error);
    current = outcome.project;
    applied.push(action.id);
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
