import { createRoutine as makeRoutine, type PlcProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import {
  addRung as ladderAddRung,
  appendNode,
  createLadderRoutine,
  createNode,
  removeInstruction as ladderRemoveInstruction,
  removeRung as ladderRemoveRung,
  rungNodes,
  setOperandValue as ladderSetOperandValue,
  tagOperand,
} from "@esco/ladder";
import { fail, findRoutine, getLadder, ok, withProgramRoutines, withRoutineLadder } from "./helpers";
import type {
  AddInstructionInput,
  AddRungInput,
  CreateRoutineInput,
  DeleteRungInput,
  ProjectActionResult,
  RemoveInstructionInput,
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
