import { createRoutine as makeRoutine, type PlcProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import {
  addBranchLeg as ladderAddBranchLeg,
  addParallelBranch as ladderAddParallelBranch,
  addRung as ladderAddRung,
  appendNode,
  appendNodeToBranch as ladderAppendNodeToBranch,
  appendRungWithRoot,
  createLadderRoutine,
  createNode,
  duplicateRung as ladderDuplicateRung,
  findBranchInRoot,
  insertRungFromRoot,
  removeBranchLeg as ladderRemoveBranchLeg,
  removeInstruction as ladderRemoveInstruction,
  removeRung as ladderRemoveRung,
  rungNodes,
  setOperandValue as ladderSetOperandValue,
  setRungComment as ladderSetRungComment,
  tagOperand,
} from "@esco/ladder";
import { parseRungText } from "@esco/parser-l5x";
import { fail, findRoutine, getLadder, ok, withProgramRoutines, withRoutineLadder } from "./helpers";
import type {
  AddInstructionInput,
  AddInstructionToBranchInput,
  AddRungFromTextInput,
  AddRungInput,
  BranchInput,
  CreateRoutineInput,
  DeleteRungInput,
  DuplicateRungInput,
  PasteRungInput,
  ProjectActionResult,
  RemoveBranchLegInput,
  RemoveInstructionInput,
  SetRungCommentInput,
  UpdateOperandInput,
} from "./types";

const registry = createDefaultRegistry();

function rungExists(project: PlcProject, routineId: string, rungId: string): boolean {
  const ladder = getLadder(findRoutine(project, routineId));
  return !!ladder?.rungs.some((rung) => rung.id === rungId);
}

/** Create a new (ladder) routine in a program. */
export function createRoutine(
  project: PlcProject,
  input: CreateRoutineInput,
): ProjectActionResult<{ routineId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Routine name is required.");

  let found = false;
  let duplicate = false;
  for (const controller of project.controllers) {
    const program = controller.programs.find((p) => p.id === input.programId);
    if (program) {
      found = true;
      duplicate = program.routines.some((r) => r.name === name);
    }
  }
  if (!found) return fail(project, `Program "${input.programId}" not found.`);
  if (duplicate) return fail(project, `Routine "${name}" already exists in that program.`);

  const routine = makeRoutine(input.programId, name, input.language ?? "ladder");
  routine.ladder = createLadderRoutine();
  const next = withProgramRoutines(project, input.programId, (routines) => [...routines, routine]);
  return ok(next, { routineId: routine.id });
}

/** Append an empty rung to a routine. */
export function addRung(
  project: PlcProject,
  input: AddRungInput,
): ProjectActionResult<{ rungId: string }> {
  const routine = findRoutine(project, input.routineId);
  if (!routine) return fail(project, `Routine "${input.routineId}" not found.`);

  const ladder = getLadder(routine) ?? createLadderRoutine();
  const nextLadder = ladderAddRung(ladder);
  const rungId = nextLadder.rungs[nextLadder.rungs.length - 1]?.id ?? "";
  return ok(withRoutineLadder(project, input.routineId, () => nextLadder), { rungId });
}

/**
 * Append a rung built from Logix neutral text (e.g. a seal-in branch). The text
 * is parsed into the semantic AST via the L5X parser, so branches and all
 * supported instructions work. Unsupported instructions are preserved + warned.
 */
export function addRungFromText(
  project: PlcProject,
  input: AddRungFromTextInput,
): ProjectActionResult<{ rungId: string }> {
  const routine = findRoutine(project, input.routineId);
  if (!routine) return fail(project, `Routine "${input.routineId}" not found.`);
  if (!input.text?.trim()) return fail(project, "Rung text is required.");

  const parsed = parseRungText(input.text, registry);
  const ladder = getLadder(routine) ?? createLadderRoutine();
  const nextLadder = appendRungWithRoot(ladder, parsed.root, input.comment);
  const newRung = nextLadder.rungs[nextLadder.rungs.length - 1];
  if (newRung) newRung.sourceText = input.text;
  const rungId = newRung?.id ?? "";

  const warnings = [
    ...parsed.unsupportedTypes.map((type) => `Unsupported instruction "${type}" preserved.`),
    ...(parsed.complexBranch ? ["Nested/complex branch flattened to a series."] : []),
  ];
  return ok(
    withRoutineLadder(project, input.routineId, () => nextLadder),
    { rungId },
    warnings.length > 0 ? warnings : undefined,
  );
}

/** Delete a rung from a routine. */
export function deleteRung(
  project: PlcProject,
  input: DeleteRungInput,
): ProjectActionResult<{ rungId: string }> {
  if (!rungExists(project, input.routineId, input.rungId)) {
    return fail(project, `Rung "${input.rungId}" not found.`);
  }
  return ok(
    withRoutineLadder(project, input.routineId, (ladder) => ladderRemoveRung(ladder, input.rungId)),
    { rungId: input.rungId },
  );
}

/** Duplicate a rung in place (a fresh-id copy is inserted right after it). */
export function duplicateRung(
  project: PlcProject,
  input: DuplicateRungInput,
): ProjectActionResult<{ rungId: string }> {
  const ladder = getLadder(findRoutine(project, input.routineId));
  if (!ladder?.rungs.some((rung) => rung.id === input.rungId)) {
    return fail(project, `Rung "${input.rungId}" not found.`);
  }
  const before = new Set(ladder.rungs.map((rung) => rung.id));
  const next = withRoutineLadder(project, input.routineId, (current) =>
    ladderDuplicateRung(current, input.rungId),
  );
  const newId =
    getLadder(findRoutine(next, input.routineId))?.rungs.find((rung) => !before.has(rung.id))?.id ?? "";
  return ok(next, { rungId: newId });
}

/** Append a new rung cloned from a branch root (paste). The root is deep-copied. */
export function pasteRung(
  project: PlcProject,
  input: PasteRungInput,
): ProjectActionResult<{ rungId: string }> {
  const routine = findRoutine(project, input.routineId);
  if (!routine) return fail(project, `Routine "${input.routineId}" not found.`);
  if (!input.root) return fail(project, "Nothing to paste.");

  const ladder = getLadder(routine) ?? createLadderRoutine();
  const before = new Set(ladder.rungs.map((rung) => rung.id));
  const nextLadder = insertRungFromRoot(ladder, input.root, input.comment);
  const next = withRoutineLadder(project, input.routineId, () => nextLadder);
  const newId =
    getLadder(findRoutine(next, input.routineId))?.rungs.find((rung) => !before.has(rung.id))?.id ?? "";
  return ok(next, { rungId: newId });
}

/** Append an instruction to a rung. Operands come from the registry definition. */
export function addInstruction(
  project: PlcProject,
  input: AddInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  if (!rungExists(project, input.routineId, input.rungId)) {
    return fail(project, `Rung "${input.rungId}" not found.`);
  }
  const type = input.instructionType.toUpperCase();
  const definition = registry.get(type);
  const operandDefs = definition ? definition.operands : [{ name: "tag" }];
  const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));

  const warnings = definition
    ? undefined
    : [`Instruction "${type}" is not registered; added as an unsupported box.`];
  return ok(
    withRoutineLadder(project, input.routineId, (ladder) => appendNode(ladder, input.rungId, node)),
    { nodeId: node.id },
    warnings,
  );
}

/** Remove a single instruction from a rung. */
export function removeInstruction(
  project: PlcProject,
  input: RemoveInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const routine = findRoutine(project, input.routineId);
  const ladder = getLadder(routine);
  const rung = ladder?.rungs.find((r) => r.id === input.rungId);
  if (!rung) return fail(project, `Rung "${input.rungId}" not found.`);
  if (!rungNodes(rung).some((node) => node.id === input.nodeId)) {
    return fail(project, `Instruction "${input.nodeId}" not found.`);
  }
  return ok(
    withRoutineLadder(project, input.routineId, (current) =>
      ladderRemoveInstruction(current, input.rungId, input.nodeId),
    ),
    { nodeId: input.nodeId },
  );
}

/** Set or clear a rung's comment. */
export function setRungComment(
  project: PlcProject,
  input: SetRungCommentInput,
): ProjectActionResult<{ rungId: string }> {
  if (!rungExists(project, input.routineId, input.rungId)) {
    return fail(project, `Rung "${input.rungId}" not found.`);
  }
  return ok(
    withRoutineLadder(project, input.routineId, (ladder) =>
      ladderSetRungComment(ladder, input.rungId, input.comment),
    ),
    { rungId: input.rungId },
  );
}

/** Update one operand value of an instruction. */
export function updateInstructionOperand(
  project: PlcProject,
  input: UpdateOperandInput,
): ProjectActionResult<{ nodeId: string }> {
  const routine = findRoutine(project, input.routineId);
  const ladder = getLadder(routine);
  const rung = ladder?.rungs.find((r) => r.id === input.rungId);
  if (!rung) return fail(project, `Rung "${input.rungId}" not found.`);
  if (!rungNodes(rung).some((node) => node.id === input.nodeId)) {
    return fail(project, `Instruction "${input.nodeId}" not found.`);
  }
  return ok(
    withRoutineLadder(project, input.routineId, (current) =>
      ladderSetOperandValue(current, input.rungId, input.nodeId, input.value, input.index ?? 0),
    ),
    { nodeId: input.nodeId },
  );
}

/**
 * Add a parallel (OR) branch to a rung — e.g. to build a seal-in by hand. The
 * existing main-line series becomes the first leg; a new empty alternate leg is
 * added and a downstream continuation ensured. Single-level parallels (MVP).
 */
export function addParallelBranch(
  project: PlcProject,
  input: BranchInput,
): ProjectActionResult<{ rungId: string }> {
  if (!rungExists(project, input.routineId, input.rungId)) {
    return fail(project, `Rung "${input.rungId}" not found.`);
  }
  return ok(
    withRoutineLadder(project, input.routineId, (ladder) =>
      ladderAddParallelBranch(ladder, input.rungId),
    ),
    { rungId: input.rungId },
  );
}

/** Add another empty leg to a rung's existing parallel branch group. */
export function addBranchLeg(
  project: PlcProject,
  input: BranchInput,
): ProjectActionResult<{ rungId: string }> {
  const ladder = getLadder(findRoutine(project, input.routineId));
  const rung = ladder?.rungs.find((r) => r.id === input.rungId);
  if (!rung) return fail(project, `Rung "${input.rungId}" not found.`);
  if (!rung.root.parallelBranches || rung.root.parallelBranches.length === 0) {
    return fail(project, "Add a parallel branch before adding a leg.");
  }
  return ok(
    withRoutineLadder(project, input.routineId, (current) =>
      ladderAddBranchLeg(current, input.rungId),
    ),
    { rungId: input.rungId },
  );
}

/** Remove an empty alternate leg from a rung's parallel group. */
export function removeBranchLeg(
  project: PlcProject,
  input: RemoveBranchLegInput,
): ProjectActionResult<{ branchId: string }> {
  const ladder = getLadder(findRoutine(project, input.routineId));
  const rung = ladder?.rungs.find((r) => r.id === input.rungId);
  if (!rung) return fail(project, `Rung "${input.rungId}" not found.`);
  const leg = (rung.root.parallelBranches ?? []).find((b) => b.id === input.branchId);
  if (!leg) return fail(project, "Branch leg not found (only alternate legs can be removed).");
  if (leg.nodes.length > 0 || leg.parallelBranches?.length || leg.next) {
    return fail(project, "Only an empty branch leg can be removed.");
  }
  return ok(
    withRoutineLadder(project, input.routineId, (current) =>
      ladderRemoveBranchLeg(current, input.rungId, input.branchId),
    ),
    { branchId: input.branchId },
  );
}

/** Append an instruction to a specific branch leg (by branch id) of a rung. */
export function addInstructionToBranch(
  project: PlcProject,
  input: AddInstructionToBranchInput,
): ProjectActionResult<{ nodeId: string }> {
  const ladder = getLadder(findRoutine(project, input.routineId));
  const rung = ladder?.rungs.find((r) => r.id === input.rungId);
  if (!rung) return fail(project, `Rung "${input.rungId}" not found.`);
  if (!findBranchInRoot(rung.root, input.branchId)) {
    return fail(project, `Branch "${input.branchId}" not found in the rung.`);
  }
  const type = input.instructionType.toUpperCase();
  const definition = registry.get(type);
  const operandDefs = definition ? definition.operands : [{ name: "tag" }];
  const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));

  const warnings = definition
    ? undefined
    : [`Instruction "${type}" is not registered; added as an unsupported box.`];
  return ok(
    withRoutineLadder(project, input.routineId, (current) =>
      ladderAppendNodeToBranch(current, input.rungId, input.branchId, node),
    ),
    { nodeId: node.id },
    warnings,
  );
}
