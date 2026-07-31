import { createRoutine as makeRoutine, type PlcProject, type Routine } from "@esco/core";
import { baseTagName, createDefaultRegistry } from "@esco/instructions";
import type { LadderBranch, LadderRoutine, LadderRung, LadderNode } from "@esco/ladder";
import {
  addBranchLeg as ladderAddBranchLeg,
  addParallelBranch as ladderAddParallelBranch,
  addRung as ladderAddRung,
  appendNode,
  appendNodeToBranch as ladderAppendNodeToBranch,
  appendRungWithRoot,
  countBranchIdInRoot,
  countNodeIdInBranch,
  createLadderRoutine,
  createNode,
  duplicateRung as ladderDuplicateRung,
  findBranchInRoot,
  insertNodeRelativeToNode as ladderInsertNodeRelativeToNode,
  insertRungFromRoot,
  insertRungRelative as ladderInsertRungRelative,
  isParallelLeg,
  isValidOperandIndex,
  mapRoutineNodes,
  moveNode as ladderMoveNode,
  removeBranchLeg as ladderRemoveBranchLeg,
  removeInstruction as ladderRemoveInstruction,
  removeRung as ladderRemoveRung,
  setOperandValue as ladderSetOperandValue,
  setRungComment as ladderSetRungComment,
  tagOperand,
} from "@esco/ladder";
import { parseRungText } from "@esco/parser-l5x";
import type { ValidationFinding } from "@esco/validator";
import { collectTagReferences, type TagReference } from "./cross-reference";
import { fail, findRoutine, getLadder, ok, validate, withProgramRoutines, withRoutineLadder } from "./helpers";
import { logixIdentifierError } from "./logix-names";
import type {
  AddInstructionInput,
  AddInstructionToBranchInput,
  AddRungFromTextInput,
  AddRungInput,
  BranchInput,
  CreateRoutineInput,
  CrossReferenceRungInput,
  DeleteRungInput,
  DuplicateRungInput,
  InsertInstructionInput,
  InsertRungInput,
  MoveInstructionInput,
  PasteInstructionInput,
  PasteRungInput,
  ProjectActionResult,
  RemoveBranchLegInput,
  RemoveInstructionInput,
  SetRoutinePropertiesInput,
  SetStructuredTextInput,
  SetRungCommentInput,
  UpdateOperandInput,
  VerifyRungInput,
} from "./types";

const registry = createDefaultRegistry();

interface BranchNodeLocation {
  branch: LadderBranch;
  isParallelLeg: boolean;
}

function findNodeBranch(
  branch: LadderBranch,
  nodeId: string,
  isParallelLeg = false,
): BranchNodeLocation | undefined {
  if (branch.nodes.some((node) => node.id === nodeId)) return { branch, isParallelLeg };
  for (const leg of branch.parallelBranches ?? []) {
    const found = findNodeBranch(leg, nodeId, true);
    if (found) return found;
  }
  return branch.next ? findNodeBranch(branch.next, nodeId, false) : undefined;
}

interface RungTarget {
  ladder: LadderRoutine;
  rung: LadderRung;
}

interface LadderRoutineTarget {
  routine: Routine;
  ladder: LadderRoutine;
}

function idInputError(value: unknown, label: string): string | undefined {
  return typeof value === "string" && value.trim() ? undefined : `${label} is required.`;
}

function ladderRoutineTarget(
  project: PlcProject,
  routineId: string,
  options: { createIfMissing?: boolean } = {},
): LadderRoutineTarget | { error: string } {
  const routineIdError = idInputError(routineId, "Routine id");
  if (routineIdError) return { error: routineIdError };
  const routine = findRoutine(project, routineId);
  if (!routine) return { error: `Routine "${routineId}" not found.` };
  if (routine.language !== "ladder") {
    return { error: `Routine "${routine.name}" is ${routine.language}, not a ladder routine.` };
  }
  const ladder = getLadder(routine);
  if (ladder) return { routine, ladder };
  if (options.createIfMissing) return { routine, ladder: createLadderRoutine() };
  return { error: `Routine "${routine.name}" has no ladder data.` };
}

function uniqueRungTarget(project: PlcProject, routineId: string, rungId: string): RungTarget | { error: string } {
  const routineTarget = ladderRoutineTarget(project, routineId);
  if (isTargetError(routineTarget)) return routineTarget;
  const rungIdError = idInputError(rungId, "Rung id");
  if (rungIdError) return { error: rungIdError };
  const ladder = routineTarget.ladder;
  const matches = ladder?.rungs.filter((rung) => rung.id === rungId) ?? [];
  if (ladder && matches.length === 1) return { ladder, rung: matches[0]! };
  if (matches.length === 0) return { error: `Rung "${rungId}" not found.` };
  return { error: `Rung "${rungId}" appears ${matches.length} times in this routine. Repair duplicate ladder IDs before editing.` };
}

function isTargetError<T extends object>(target: T | { error: string }): target is { error: string } {
  return "error" in target;
}

const VARIADIC_OPERAND_INSTRUCTIONS = new Set(["JSR", "SBR", "RET"]);

function findNodeInBranch(branch: LadderBranch, nodeId: string): LadderNode | undefined {
  const local = branch.nodes.find((node) => node.id === nodeId);
  if (local) return local;
  for (const leg of branch.parallelBranches ?? []) {
    const found = findNodeInBranch(leg, nodeId);
    if (found) return found;
  }
  return branch.next ? findNodeInBranch(branch.next, nodeId) : undefined;
}

function uniqueInstructionIdError(rung: { root: LadderBranch }, nodeId: string): string | undefined {
  const count = countNodeIdInBranch(rung.root, nodeId);
  if (count === 1) return undefined;
  if (count === 0) return `Instruction "${nodeId}" not found.`;
  return `Instruction "${nodeId}" appears ${count} times in this rung. Repair duplicate ladder IDs before editing.`;
}

function uniqueBranchIdError(root: LadderBranch, branchId: string): string | undefined {
  const count = countBranchIdInRoot(root, branchId);
  if (count === 1) return undefined;
  if (count === 0) return `Branch "${branchId}" not found in the rung.`;
  return `Branch "${branchId}" appears ${count} times in this rung. Repair duplicate ladder IDs before editing.`;
}

function operandIndexError(index: number): string | undefined {
  return isValidOperandIndex(index) ? undefined : "Operand index must be a non-negative integer between 0 and 255.";
}

function operandArityError(node: LadderNode, index: number): string | undefined {
  const type = node.instructionType.toUpperCase();
  const definition = registry.get(type);
  if (!definition || definition.modelOnly || VARIADIC_OPERAND_INSTRUCTIONS.has(type)) return undefined;
  if (index < definition.operands.length) return undefined;
  return `${type} has ${definition.operands.length} operand${definition.operands.length === 1 ? "" : "s"}; operand index ${index} is outside that range.`;
}

function isRungPosition(value: unknown): value is "above" | "below" {
  return value === "above" || value === "below";
}

function rungPositionError(value: unknown): string | undefined {
  return isRungPosition(value) ? undefined : 'Rung position must be "above" or "below".';
}

function isInstructionPosition(value: unknown): value is "before" | "after" {
  return value === "before" || value === "after";
}

function instructionPositionError(value: unknown): string | undefined {
  return isInstructionPosition(value) ? undefined : 'Instruction position must be "before" or "after".';
}

function instructionTypeError(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? undefined : "Instruction type is required.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function pastedBranchRootError(root: unknown): string | undefined {
  const seen = new Set<object>();
  const branchIds = new Set<string>();
  const nodeIds = new Set<string>();
  let branchCount = 0;
  let nodeCount = 0;
  const maxBranches = 512;
  const maxNodes = 4096;
  const maxDepth = 64;

  const visit = (branch: unknown, depth: number): string | undefined => {
    if (!isRecord(branch)) return "Pasted rung root is malformed.";
    if (seen.has(branch)) return "Pasted rung root contains a cycle.";
    if (depth > maxDepth) return "Pasted rung root is too deeply nested.";
    seen.add(branch);
    branchCount += 1;
    if (branchCount > maxBranches) return "Pasted rung root is too large.";
    if (typeof branch.id !== "string" || !branch.id.trim()) return "Pasted rung branch is missing an id.";
    if (branchIds.has(branch.id)) return `Pasted rung branch id "${branch.id}" is duplicated.`;
    branchIds.add(branch.id);
    if (!Array.isArray(branch.nodes)) return "Pasted rung branch nodes are malformed.";
    nodeCount += branch.nodes.length;
    if (nodeCount > maxNodes) return "Pasted rung root has too many instructions.";
    for (const node of branch.nodes) {
      if (!isRecord(node)) return "Pasted rung instruction is malformed.";
      if (typeof node.id !== "string" || !node.id.trim()) return "Pasted rung instruction is missing an id.";
      if (nodeIds.has(node.id)) return `Pasted rung instruction id "${node.id}" is duplicated.`;
      nodeIds.add(node.id);
      if (typeof node.instructionType !== "string" || !node.instructionType.trim()) {
        return "Pasted rung instruction is missing a type.";
      }
      if (!Array.isArray(node.operands)) return "Pasted rung instruction operands are malformed.";
      for (const operand of node.operands) {
        if (
          !isRecord(operand) ||
          typeof operand.name !== "string" ||
          typeof operand.kind !== "string" ||
          typeof operand.value !== "string" ||
          (operand.dataType !== undefined && typeof operand.dataType !== "string")
        ) {
          return "Pasted rung operand is malformed.";
        }
      }
    }
    if (branch.parallelBranches !== undefined) {
      if (!Array.isArray(branch.parallelBranches)) return "Pasted rung parallel branches are malformed.";
      for (const leg of branch.parallelBranches) {
        const error = visit(leg, depth + 1);
        if (error) return error;
      }
    }
    return branch.next === undefined ? undefined : visit(branch.next, depth + 1);
  };

  return visit(root, 0);
}

function commitLadderEdit<T>(
  project: PlcProject,
  routineId: string,
  before: LadderRoutine,
  after: LadderRoutine,
  data: T,
  warnings?: string[],
): ProjectActionResult<T> {
  if (after === before) {
    return fail(project, "Ladder edit was rejected by the ladder model.");
  }
  return ok(withRoutineLadder(project, routineId, () => after), data, warnings);
}

const STRUCTURED_TEXT_SIM_WARNING =
  "Structured Text is preserved/exported and executes only a conservative Offline Simulation subset.";

/** Create a new routine in a program. */
export function createRoutine(
  project: PlcProject,
  input: CreateRoutineInput,
): ProjectActionResult<{ routineId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Routine name is required.");
  const invalidName = logixIdentifierError(name, "Routine");
  if (invalidName) return fail(project, invalidName);

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
  const routineId = input.routineId?.trim();
  if (routineId && project.controllers.some((controller) =>
    controller.programs.some((program) => program.routines.some((routine) => routine.id === routineId)),
  )) {
    return fail(project, `Routine id "${routineId}" already exists.`);
  }

  const language = input.language ?? "ladder";
  const routine = {
    ...makeRoutine(input.programId, name, language),
    ...(routineId ? { id: routineId } : {}),
  };
  if (language === "ladder") {
    routine.ladder = createLadderRoutine();
  } else if (language === "structured-text") {
    routine.structuredText = "";
  } else {
    routine.sourceText = "";
  }
  const next = withProgramRoutines(project, input.programId, (routines) => [...routines, routine]);
  return ok(next, { routineId: routine.id });
}

/**
 * Remap every routine-reference operand (JSR/FOR/SFC, flagged `isRoutineRef` in
 * the registry) that names `from` to `to`, leaving all other operands — and
 * JSR's parameter operands — untouched.
 */
function remapRoutineReferences(
  ladder: LadderRoutine,
  from: string,
  to: string,
): LadderRoutine {
  return mapRoutineNodes(ladder, (node) => {
    const operandDefs = registry.get(node.instructionType)?.operands;
    if (!operandDefs) return node;
    let changed = false;
    const operands = node.operands.map((operand, index) => {
      if (operandDefs[index]?.isRoutineRef && operand.value.trim() === from) {
        changed = true;
        return { ...operand, value: to };
      }
      return operand;
    });
    return changed ? { ...node, operands } : node;
  });
}

/**
 * Rename a routine and/or edit its description (the Studio 5000 Routine
 * Properties dialog). Renaming remaps JSR/FOR/SFC routine references within the
 * owning program; program main/fault routine ids reference by id and so are
 * unaffected. Rejects duplicate names within the program.
 */
export function setRoutineProperties(
  project: PlcProject,
  input: SetRoutinePropertiesInput,
): ProjectActionResult<{ routineId: string }> {
  const routineId = input.routineId?.trim();
  if (!routineId) return fail(project, "Routine id is required.");

  const routine = findRoutine(project, routineId);
  if (!routine) return fail(project, `Routine "${routineId}" not found.`);
  const owningProgramId = routine.programId;
  const oldName = routine.name;

  let nextName = oldName;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return fail(project, "Routine name is required.");
    const invalidName = logixIdentifierError(name, "Routine");
    if (invalidName) return fail(project, invalidName);
    if (name !== oldName) {
      const program = project.controllers
        .flatMap((controller) => controller.programs)
        .find((p) => p.id === owningProgramId);
      if (program?.routines.some((r) => r.id !== routineId && r.name === name)) {
        return fail(project, `Routine "${name}" already exists in that program.`);
      }
      nextName = name;
    }
  }
  const renamed = nextName !== oldName;

  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => {
        if (program.id !== owningProgramId) return program;
        return {
          ...program,
          routines: program.routines.map((candidate) => {
            let updated = candidate;
            if (candidate.id === routineId) {
              updated = { ...candidate, name: nextName };
              if (input.description !== undefined) updated.description = input.description;
            }
            if (renamed) {
              const ladder = getLadder(updated);
              if (ladder) {
                updated = { ...updated, ladder: remapRoutineReferences(ladder, oldName, nextName) };
              }
            }
            return updated;
          }),
        };
      }),
    })),
  };

  return ok(next, { routineId });
}

/** Replace the source of a Structured Text routine. Full Logix ST execution is still bounded offline. */
export function setStructuredTextSource(
  project: PlcProject,
  input: SetStructuredTextInput,
): ProjectActionResult<{ routineId: string }> {
  const routineId = input.routineId?.trim();
  if (!routineId) return fail(project, "Routine id is required.");
  if (typeof input.source !== "string") {
    return fail(project, "Structured Text source must be a string.");
  }
  if (input.source.includes("\0")) {
    return fail(project, "Structured Text source cannot contain null characters.");
  }

  const routine = findRoutine(project, routineId);
  if (!routine) return fail(project, `Routine "${routineId}" not found.`);
  if (routine.language !== "structured-text") {
    return fail(project, `Routine "${routine.name}" is ${routine.language}, not Structured Text.`);
  }

  const source = input.source;
  const next = {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((candidate) =>
          candidate.id === routineId
            ? { ...candidate, ladder: undefined, structuredText: source, sourceText: undefined }
            : candidate,
        ),
      })),
    })),
  };

  return ok(
    next,
    { routineId },
    [STRUCTURED_TEXT_SIM_WARNING],
  );
}

/** Append an empty rung to a routine. */
export function addRung(
  project: PlcProject,
  input: AddRungInput,
): ProjectActionResult<{ rungId: string }> {
  const target = ladderRoutineTarget(project, input.routineId, { createIfMissing: true });
  if (isTargetError(target)) return fail(project, target.error);

  const ladder = target.ladder;
  const nextLadder = ladderAddRung(ladder);
  const rungId = nextLadder.rungs[nextLadder.rungs.length - 1]?.id ?? "";
  return commitLadderEdit(project, input.routineId, ladder, nextLadder, { rungId });
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
  const target = ladderRoutineTarget(project, input.routineId, { createIfMissing: true });
  if (isTargetError(target)) return fail(project, target.error);
  if (!input.text?.trim()) return fail(project, "Rung text is required.");

  const parsed = parseRungText(input.text, registry);
  const ladder = target.ladder;
  const nextLadder = appendRungWithRoot(ladder, parsed.root, input.comment);
  const newRung = nextLadder.rungs[nextLadder.rungs.length - 1];
  if (newRung) newRung.sourceText = input.text;
  const rungId = newRung?.id ?? "";

  const warnings = [
    ...parsed.unsupportedTypes.map((type) => `Unsupported instruction "${type}" preserved.`),
    ...(parsed.complexBranch ? ["Nested/complex branch flattened to a series."] : []),
  ];
  return commitLadderEdit(
    project,
    input.routineId,
    ladder,
    nextLadder,
    { rungId },
    warnings.length > 0 ? warnings : undefined,
  );
}

/** Delete a rung from a routine. */
export function deleteRung(
  project: PlcProject,
  input: DeleteRungInput,
): ProjectActionResult<{ rungId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const nextLadder = ladderRemoveRung(target.ladder, input.rungId);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { rungId: input.rungId });
}

/** Duplicate a rung in place (a fresh-id copy is inserted right after it). */
export function duplicateRung(
  project: PlcProject,
  input: DuplicateRungInput,
): ProjectActionResult<{ rungId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const ladder = target.ladder;
  const before = new Set(ladder.rungs.map((rung) => rung.id));
  const nextLadder = ladderDuplicateRung(ladder, input.rungId);
  const newId = nextLadder.rungs.find((rung) => !before.has(rung.id))?.id ?? "";
  return commitLadderEdit(project, input.routineId, ladder, nextLadder, { rungId: newId });
}

/**
 * Paste a rung cloned from a branch root. The root is deep-copied (fresh ids).
 * By default the rung is appended to the end of the routine; pass `rungId` +
 * `position` to drop it directly above/below an existing rung instead.
 */
export function pasteRung(
  project: PlcProject,
  input: PasteRungInput,
): ProjectActionResult<{ rungId: string }> {
  const routineTarget = ladderRoutineTarget(project, input.routineId, { createIfMissing: true });
  if (isTargetError(routineTarget)) return fail(project, routineTarget.error);
  if (!input.root) return fail(project, "Nothing to paste.");
  const rootError = pastedBranchRootError(input.root);
  if (rootError) return fail(project, rootError);

  const ladder = routineTarget.ladder;
  const hasAnchor = input.rungId !== undefined || input.position !== undefined;
  let anchor: { rungId: string; position: "above" | "below" } | undefined;
  if (hasAnchor) {
    if (typeof input.rungId !== "string" || !input.rungId.trim()) {
      return fail(project, "Anchor rung id is required.");
    }
    if (!isRungPosition(input.position)) return fail(project, 'Rung position must be "above" or "below".');
    anchor = { rungId: input.rungId, position: input.position };
    const target = uniqueRungTarget(project, input.routineId, anchor.rungId);
    if (isTargetError(target)) return fail(project, target.error);
  }
  const before = new Set(ladder.rungs.map((rung) => rung.id));
  const nextLadder =
    anchor
      ? ladderInsertRungRelative(ladder, anchor.rungId, anchor.position, input.root, input.comment)
      : insertRungFromRoot(ladder, input.root, input.comment);
  const newId = nextLadder.rungs.find((rung) => !before.has(rung.id))?.id ?? "";
  return commitLadderEdit(project, input.routineId, ladder, nextLadder, { rungId: newId });
}

/** Insert a new empty rung directly above or below an existing rung. */
export function insertRung(
  project: PlcProject,
  input: InsertRungInput,
): ProjectActionResult<{ rungId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const positionError = rungPositionError(input.position);
  if (positionError) return fail(project, positionError);
  const ladder = target.ladder;
  const before = new Set(ladder.rungs.map((rung) => rung.id));
  const nextLadder = ladderInsertRungRelative(ladder, input.rungId, input.position, undefined, input.comment);
  const newId = nextLadder.rungs.find((rung) => !before.has(rung.id))?.id ?? "";
  return commitLadderEdit(project, input.routineId, ladder, nextLadder, { rungId: newId });
}

/** Append an instruction to a rung. Operands come from the registry definition. */
export function addInstruction(
  project: PlcProject,
  input: AddInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const typeError = instructionTypeError(input.instructionType);
  if (typeError) return fail(project, typeError);
  const type = input.instructionType.trim().toUpperCase();
  const definition = registry.get(type);
  const operandDefs = definition ? definition.operands : [{ name: "tag" }];
  const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));

  const warnings = definition
    ? undefined
    : [`Instruction "${type}" is not registered; added as an unsupported box.`];
  const nextLadder = appendNode(target.ladder, input.rungId, node);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: node.id }, warnings);
}

/**
 * Insert an instruction immediately before or after an existing instruction on
 * the same rung (and within the same branch leg, if the anchor is inside a
 * parallel). Operands come from the registry definition; an unregistered type is
 * added as an unsupported box with a warning, mirroring {@link addInstruction}.
 */
export function insertInstruction(
  project: PlcProject,
  input: InsertInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const positionError = instructionPositionError(input.position);
  if (positionError) return fail(project, positionError);
  const rung = target.rung;
  const instructionError = uniqueInstructionIdError(rung, input.nodeId);
  if (instructionError) return fail(project, instructionError);
  const typeError = instructionTypeError(input.instructionType);
  if (typeError) return fail(project, typeError);
  const type = input.instructionType.trim().toUpperCase();
  const definition = registry.get(type);
  const operandDefs = definition ? definition.operands : [{ name: "tag" }];
  const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));

  const warnings = definition
    ? undefined
    : [`Instruction "${type}" is not registered; added as an unsupported box.`];
  const nextLadder = ladderInsertNodeRelativeToNode(
    target.ladder,
    input.rungId,
    input.nodeId,
    node,
    input.position,
  );
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: node.id }, warnings);
}

/**
 * Reorder an instruction on a rung by moving it before/after another
 * instruction on the same rung (drag-reorder and keyboard "move" use this). The
 * moved instruction keeps its id and operands, so cross-references and undo/redo
 * stay stable. Moving in or out of a parallel leg is allowed — the instruction
 * lands wherever the target instruction lives. Rejected (no project change) when
 * source and target are the same, either id is missing/duplicated in the rung,
 * or the move would corrupt the rung structure.
 */
export function moveInstruction(
  project: PlcProject,
  input: MoveInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const positionError = instructionPositionError(input.position);
  if (positionError) return fail(project, positionError);
  if (input.nodeId === input.targetNodeId) {
    return fail(project, "An instruction cannot be moved relative to itself.");
  }
  const rung = target.rung;
  const movedError = uniqueInstructionIdError(rung, input.nodeId);
  if (movedError) return fail(project, movedError);
  const anchorError = uniqueInstructionIdError(rung, input.targetNodeId);
  if (anchorError) return fail(project, anchorError);
  const nextLadder = ladderMoveNode(target.ladder, input.rungId, input.nodeId, input.targetNodeId, input.position);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: input.nodeId });
}

/**
 * Paste a copied instruction onto a rung. The clipboard node's operands are
 * copied and a brand-new id is assigned, so pasting never collides with the
 * source instruction's id. With `nodeId`/`position` it lands before/after that
 * anchor instruction (within the anchor's branch leg); otherwise it is appended
 * to the rung's terminal series. Mirrors {@link insertInstruction}, but carries
 * the copied operands instead of starting from registry defaults.
 */
export function pasteInstruction(
  project: PlcProject,
  input: PasteInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const sourceType = typeof input.node?.instructionType === "string" ? input.node.instructionType.trim() : "";
  if (!sourceType) return fail(project, "Nothing to paste.");
  const operands = Array.isArray(input.node.operands) ? input.node.operands.map((operand) => ({ ...operand })) : [];
  const clone = createNode(sourceType, operands);

  let nextLadder: LadderRoutine;
  if (input.nodeId !== undefined) {
    const positionError = instructionPositionError(input.position);
    if (positionError) return fail(project, positionError);
    const anchorError = uniqueInstructionIdError(target.rung, input.nodeId);
    if (anchorError) return fail(project, anchorError);
    nextLadder = ladderInsertNodeRelativeToNode(target.ladder, input.rungId, input.nodeId, clone, input.position!);
  } else {
    nextLadder = appendNode(target.ladder, input.rungId, clone);
  }
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: clone.id });
}

/** Remove a single instruction from a rung. */
export function removeInstruction(
  project: PlcProject,
  input: RemoveInstructionInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const rung = target.rung;
  const instructionError = uniqueInstructionIdError(rung, input.nodeId);
  if (instructionError) return fail(project, instructionError);
  const location = findNodeBranch(rung.root, input.nodeId);
  const deletingOnlyNodeInBranch = location?.branch.nodes.length === 1 && location.branch.nodes[0]?.id === input.nodeId;
  if (deletingOnlyNodeInBranch && location.branch.parallelBranches?.length) {
    return fail(project, "Delete the parallel branch legs before removing the primary branch instruction.");
  }
  const emptyParallelLegToPrune =
    location?.isParallelLeg && deletingOnlyNodeInBranch && !location.branch.parallelBranches?.length && !location.branch.next
      ? location.branch.id
      : undefined;
  if (emptyParallelLegToPrune) {
    const branchError = uniqueBranchIdError(rung.root, emptyParallelLegToPrune);
    if (branchError) return fail(project, branchError);
  }
  const withoutInstruction = ladderRemoveInstruction(target.ladder, input.rungId, input.nodeId);
  const nextLadder = emptyParallelLegToPrune
    ? ladderRemoveBranchLeg(withoutInstruction, input.rungId, emptyParallelLegToPrune)
    : withoutInstruction;
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: input.nodeId });
}

/** Set or clear a rung's comment. */
export function setRungComment(
  project: PlcProject,
  input: SetRungCommentInput,
): ProjectActionResult<{ rungId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const nextLadder = ladderSetRungComment(target.ladder, input.rungId, input.comment);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { rungId: input.rungId });
}

/** Update one operand value of an instruction. */
export function updateInstructionOperand(
  project: PlcProject,
  input: UpdateOperandInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const rung = target.rung;
  const index = input.index ?? 0;
  const indexError = operandIndexError(index);
  if (indexError) return fail(project, indexError);
  const instructionError = uniqueInstructionIdError(rung, input.nodeId);
  if (instructionError) return fail(project, instructionError);
  const node = findNodeInBranch(rung.root, input.nodeId);
  if (node) {
    const arityError = operandArityError(node, index);
    if (arityError) return fail(project, arityError);
  }
  const nextLadder = ladderSetOperandValue(target.ladder, input.rungId, input.nodeId, input.value, index);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: input.nodeId });
}

/**
 * Add a parallel (OR) branch to a rung — e.g. to build a seal-in by hand. The
 * target branch's existing series becomes the first leg; a new empty alternate
 * leg is added and a downstream continuation ensured. Targets the rung root by
 * default; pass `branchId` to add a *nested* parallel inside an existing leg.
 */
export function addParallelBranch(
  project: PlcProject,
  input: BranchInput,
): ProjectActionResult<{ rungId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const rung = target.rung;
  if (input.branchId) {
    const branchError = uniqueBranchIdError(rung.root, input.branchId);
    if (branchError) return fail(project, branchError);
  }
  const nextLadder = ladderAddParallelBranch(target.ladder, input.rungId, input.branchId);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { rungId: input.rungId });
}

/** Add another empty leg to a target branch's existing parallel group (root by default). */
export function addBranchLeg(
  project: PlcProject,
  input: BranchInput,
): ProjectActionResult<{ rungId: string }> {
  const targetRung = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(targetRung)) return fail(project, targetRung.error);
  const rung = targetRung.rung;
  if (input.branchId) {
    const branchError = uniqueBranchIdError(rung.root, input.branchId);
    if (branchError) return fail(project, branchError);
  }
  const target = input.branchId ? findBranchInRoot(rung.root, input.branchId) : rung.root;
  if (!target) return fail(project, `Branch "${input.branchId}" not found in the rung.`);
  if (!target.parallelBranches || target.parallelBranches.length === 0) {
    return fail(project, "Add a parallel branch before adding a leg.");
  }
  const nextLadder = ladderAddBranchLeg(targetRung.ladder, input.rungId, input.branchId);
  return commitLadderEdit(project, input.routineId, targetRung.ladder, nextLadder, { rungId: input.rungId });
}

/** Remove an empty parallel leg (anywhere in the rung's branch tree, incl. nested). */
export function removeBranchLeg(
  project: PlcProject,
  input: RemoveBranchLegInput,
): ProjectActionResult<{ branchId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const rung = target.rung;
  const branchError = uniqueBranchIdError(rung.root, input.branchId);
  if (branchError) return fail(project, branchError);
  if (!isParallelLeg(rung.root, input.branchId)) {
    return fail(project, "Branch leg not found (only parallel legs can be removed).");
  }
  const leg = findBranchInRoot(rung.root, input.branchId);
  if (leg && (leg.nodes.length > 0 || leg.parallelBranches?.length || leg.next)) {
    return fail(project, "Only an empty branch leg can be removed.");
  }
  const nextLadder = ladderRemoveBranchLeg(target.ladder, input.rungId, input.branchId);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { branchId: input.branchId });
}

/** Append an instruction to a specific branch leg (by branch id) of a rung. */
export function addInstructionToBranch(
  project: PlcProject,
  input: AddInstructionToBranchInput,
): ProjectActionResult<{ nodeId: string }> {
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (isTargetError(target)) return fail(project, target.error);
  const rung = target.rung;
  const branchError = uniqueBranchIdError(rung.root, input.branchId);
  if (branchError) return fail(project, branchError);
  const typeError = instructionTypeError(input.instructionType);
  if (typeError) return fail(project, typeError);
  const type = input.instructionType.trim().toUpperCase();
  const definition = registry.get(type);
  const operandDefs = definition ? definition.operands : [{ name: "tag" }];
  const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));

  const warnings = definition
    ? undefined
    : [`Instruction "${type}" is not registered; added as an unsupported box.`];
  const nextLadder = ladderAppendNodeToBranch(target.ladder, input.rungId, input.branchId, node);
  return commitLadderEdit(project, input.routineId, target.ladder, nextLadder, { nodeId: node.id }, warnings);
}

export interface VerifyRungData {
  rungId: string;
  rungNumber: number;
  routineName: string;
  /** Validation findings attributable to this rung. */
  findings: ValidationFinding[];
  errorCount: number;
  warningCount: number;
}

/**
 * Run the validation engine and project the findings down to a single rung. A
 * finding is attributed to the rung when its message quotes a tag/operand that is
 * actually referenced on that rung, so "Verify Rung" reports the issues an
 * engineer sees on the selected rung rather than the whole routine. This is real
 * offline validation (no controller) scoped to one rung.
 */
export function verifyRung(
  project: PlcProject,
  input: VerifyRungInput,
): ProjectActionResult<VerifyRungData> {
  const routine = findRoutine(project, input.routineId);
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (!routine || isTargetError(target)) {
    return fail(project, isTargetError(target) ? target.error : `Rung "${input.rungId}" not found.`);
  }
  const rung = target.rung;

  const findings = validate(project);
  const routineFindings = findings.filter((finding) => finding.target?.split("/").includes(routine.name) ?? false);
  const rungRefs = collectTagReferences(project).filter((ref) => ref.rungId === input.rungId);
  const rungTags = new Set(rungRefs.map((ref) => ref.tag));
  const rungOperands = new Set(rungRefs.map((ref) => ref.operand));
  const rungFindings = routineFindings.filter((finding) => {
    if (new RegExp(`\\bRung ${rung.number}\\b`).test(finding.message)) return true;
    const quoted = [...finding.message.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((value): value is string => Boolean(value));
    return quoted.some(
      (token) => rungTags.has(token) || rungTags.has(baseTagName(token)) || rungOperands.has(token),
    );
  });

  return ok(project, {
    rungId: input.rungId,
    rungNumber: rung.number,
    routineName: routine.name,
    findings: rungFindings,
    errorCount: rungFindings.filter((finding) => finding.severity === "error").length,
    warningCount: rungFindings.filter((finding) => finding.severity === "warning").length,
  });
}

export interface CrossReferenceRungData {
  rungId: string;
  rungNumber: number;
  /** Distinct base tags used on the rung, in first-seen order. */
  tags: string[];
  /** Every project reference to any tag used on the rung. */
  references: TagReference[];
}

/**
 * Cross-reference a rung: gather the tags used on it and every place in the
 * project those tags are referenced. Feeds the editor's "Cross Reference Rung"
 * command so it opens real reference results rather than a placeholder.
 */
export function crossReferenceRung(
  project: PlcProject,
  input: CrossReferenceRungInput,
): ProjectActionResult<CrossReferenceRungData> {
  const routine = findRoutine(project, input.routineId);
  const target = uniqueRungTarget(project, input.routineId, input.rungId);
  if (!routine || isTargetError(target)) {
    return fail(project, isTargetError(target) ? target.error : `Rung "${input.rungId}" not found.`);
  }
  const rung = target.rung;

  const tags: string[] = [];
  for (const ref of collectTagReferences(project).filter((candidate) => candidate.rungId === input.rungId)) {
    if (!tags.includes(ref.tag)) tags.push(ref.tag);
  }
  const references = collectTagReferences(project).filter((ref) => tags.includes(ref.tag));
  return ok(project, { rungId: input.rungId, rungNumber: rung.number, tags, references });
}
