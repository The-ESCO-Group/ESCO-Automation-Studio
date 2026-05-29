import type { PlcProject } from "@esco/core";
import {
  addBranchLeg,
  addHmiElement,
  addHmiEventCommand,
  addInstruction,
  addInstructionToBranch,
  addParallelBranch,
  addRung,
  addRungFromText,
  createHmiPopup,
  createHmiScreen,
  createRoutine,
  createTag,
  deleteRung,
  deleteTag,
  ensureHmiProject,
  removeInstruction,
  renameTag,
  setRungComment,
  setHmiElementBinding,
  setTagDescription,
  updateInstructionOperand,
  updateHmiElementGeometry,
  validateProject,
  type AddHmiElementInput,
  type AddHmiEventCommandInput,
  type AddInstructionInput,
  type AddInstructionToBranchInput,
  type AddRungFromTextInput,
  type AddRungInput,
  type BranchInput,
  type CreateHmiPopupInput,
  type CreateHmiScreenInput,
  type CreateRoutineInput,
  type CreateTagInput,
  type DeleteRungInput,
  type DeleteTagInput,
  type ProjectActionResult,
  type RemoveInstructionInput,
  type RenameTagInput,
  type SetHmiElementBindingInput,
  type SetRungCommentInput,
  type SetTagDescriptionInput,
  type UpdateHmiElementGeometryInput,
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

  try {
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
      case "ensureHmiProject":
        return wrap(ensureHmiProject(project));
      case "createHmiScreen":
        return wrap(createHmiScreen(project, input as unknown as CreateHmiScreenInput));
      case "createHmiPopup":
        return wrap(createHmiPopup(project, input as unknown as CreateHmiPopupInput));
      case "addHmiElement":
        return wrap(addHmiElement(project, input as unknown as AddHmiElementInput));
      case "updateHmiElementGeometry":
        return wrap(updateHmiElementGeometry(project, input as unknown as UpdateHmiElementGeometryInput));
      case "setHmiElementBinding":
        return wrap(setHmiElementBinding(project, input as unknown as SetHmiElementBindingInput));
      case "addHmiEventCommand":
        return wrap(addHmiEventCommand(project, input as unknown as AddHmiEventCommandInput));
      default:
        return { ok: false, project, error: `Unknown or blocked action kind: ${action.kind}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return { ok: false, project, error: `Rejected invalid action "${action.kind}": ${message}` };
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
  const warnings: string[] = [...plan.warnings];

  for (const action of plan.actions) {
    const outcome = applyAction(current, action);
    if (!outcome.ok) return finish(current, applied, warnings, outcome.error);
    current = outcome.project;
    if (outcome.warnings?.length) warnings.push(...outcome.warnings);
    applied.push(action.id);
  }

  return finish(current, applied, warnings);
}

function finish(project: PlcProject, applied: string[], warnings: string[], error?: string): ApplyResult {
  return {
    ok: !error,
    project,
    applied,
    findings: validateProject(project).findings ?? [],
    warnings,
    error,
  };
}
