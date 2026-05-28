import { createId } from "@esco/shared";
import { createBranch, createNode, tagOperand } from "./factory";
import type {
  InstructionOperand,
  LadderBranch,
  LadderNode,
  LadderRoutine,
  LadderRung,
} from "./types";

/**
 * Immutable edit operations on the ladder AST. Every function returns a new
 * routine; the input is never mutated, so callers (e.g. React state) can rely
 * on fresh object identities.
 */

function renumber(rungs: LadderRung[]): LadderRung[] {
  return rungs.map((rung, index) =>
    rung.number === index ? rung : { ...rung, number: index },
  );
}

/** Deep-clone a node with a brand-new id (operands copied). */
function cloneNode(node: LadderNode): LadderNode {
  return {
    id: createId("node"),
    instructionType: node.instructionType,
    operands: node.operands.map((operand) => ({ ...operand })),
    ...(node.position ? { position: { ...node.position } } : {}),
  };
}

/** Deep-clone a branch tree with brand-new ids throughout. */
export function cloneBranchWithNewIds(branch: LadderBranch): LadderBranch {
  const result: LadderBranch = { id: createId("branch"), nodes: branch.nodes.map(cloneNode) };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map(cloneBranchWithNewIds);
  }
  if (branch.next) result.next = cloneBranchWithNewIds(branch.next);
  return result;
}

/** Append a new empty rung. */
export function addRung(routine: LadderRoutine): LadderRoutine {
  return appendRungWithRoot(routine, createBranch([]));
}

/** Duplicate a rung in place: a fresh-id copy is inserted right after it. */
export function duplicateRung(routine: LadderRoutine, rungId: string): LadderRoutine {
  const index = routine.rungs.findIndex((rung) => rung.id === rungId);
  if (index < 0) return routine;
  const source = routine.rungs[index]!;
  const copy: LadderRung = {
    id: createId("rung"),
    routineId: routine.id,
    number: index + 1,
    comment: source.comment,
    root: cloneBranchWithNewIds(source.root),
  };
  const rungs = [...routine.rungs];
  rungs.splice(index + 1, 0, copy);
  return { ...routine, rungs: renumber(rungs) };
}

/** Append a rung built from a (cloned) branch root — used for paste. */
export function insertRungFromRoot(
  routine: LadderRoutine,
  root: LadderBranch,
  comment?: string,
): LadderRoutine {
  const rung: LadderRung = {
    id: createId("rung"),
    routineId: routine.id,
    number: routine.rungs.length,
    comment,
    root: cloneBranchWithNewIds(root),
  };
  return { ...routine, rungs: renumber([...routine.rungs, rung]) };
}

/** Append a rung with a pre-built branch root (e.g. parsed from rung text). */
export function appendRungWithRoot(
  routine: LadderRoutine,
  root: LadderBranch,
  comment?: string,
): LadderRoutine {
  const rung: LadderRung = {
    id: createId("rung"),
    routineId: routine.id,
    number: routine.rungs.length,
    comment,
    root,
  };
  return { ...routine, rungs: renumber([...routine.rungs, rung]) };
}

/** Remove a rung by id and renumber the remainder. */
export function removeRung(routine: LadderRoutine, rungId: string): LadderRoutine {
  return {
    ...routine,
    rungs: renumber(routine.rungs.filter((rung) => rung.id !== rungId)),
  };
}

function mapRung(
  routine: LadderRoutine,
  rungId: string,
  fn: (rung: LadderRung) => LadderRung,
): LadderRoutine {
  return {
    ...routine,
    rungs: routine.rungs.map((rung) => (rung.id === rungId ? fn(rung) : rung)),
  };
}

/** Append a node to the rung's terminal series segment (following `next`). */
function appendToTerminalSeries(branch: LadderBranch, node: LadderNode): LadderBranch {
  if (branch.next) {
    return { ...branch, next: appendToTerminalSeries(branch.next, node) };
  }
  return { ...branch, nodes: [...branch.nodes, node] };
}

/** Rebuild a branch tree, applying `fn` to each node (return null to drop it). */
function mapBranch(
  branch: LadderBranch,
  fn: (node: LadderNode) => LadderNode | null,
): LadderBranch {
  const nodes: LadderNode[] = [];
  for (const node of branch.nodes) {
    const mapped = fn(node);
    if (mapped) nodes.push(mapped);
  }
  const result: LadderBranch = { id: branch.id, nodes };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map((b) => mapBranch(b, fn));
  }
  if (branch.next) {
    result.next = mapBranch(branch.next, fn);
  }
  return result;
}

/** Add a single-operand instruction (with an optional tag) to the end of a rung. */
export function appendInstruction(
  routine: LadderRoutine,
  rungId: string,
  instructionType: string,
  tagName = "",
): LadderRoutine {
  return appendNode(routine, rungId, createNode(instructionType, [tagOperand("tag", tagName)]));
}

/** Append a pre-built node (e.g. a multi-operand instruction) to the end of a rung. */
export function appendNode(
  routine: LadderRoutine,
  rungId: string,
  node: LadderNode,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: appendToTerminalSeries(rung.root, node),
  }));
}

/** Remove a single instruction from a rung by node id. */
export function removeInstruction(
  routine: LadderRoutine,
  rungId: string,
  nodeId: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: mapBranch(rung.root, (node) => (node.id === nodeId ? null : node)),
  }));
}

/** Set (or clear) a rung's comment. */
export function setRungComment(
  routine: LadderRoutine,
  rungId: string,
  comment: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({ ...rung, comment: comment || undefined }));
}

/** Rebuild a branch tree, applying `fn` to the branch whose id matches `id`. */
function mapBranchById(
  branch: LadderBranch,
  id: string,
  fn: (b: LadderBranch) => LadderBranch,
): LadderBranch {
  if (branch.id === id) return fn(branch);
  const result: LadderBranch = { ...branch };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map((leg) => mapBranchById(leg, id, fn));
  }
  if (branch.next) result.next = mapBranchById(branch.next, id, fn);
  return result;
}

/**
 * Add a parallel branch group to a target branch (defaults to the rung root).
 * The target's existing series becomes the first leg; a new empty alternate leg
 * is added beside it, and a downstream continuation (`next`) is ensured so the
 * palette appends *after* the merge. Targeting a leg creates a nested parallel.
 */
export function addParallelBranch(
  routine: LadderRoutine,
  rungId: string,
  branchId?: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: mapBranchById(rung.root, branchId ?? rung.root.id, (branch) => ({
      ...branch,
      parallelBranches: [...(branch.parallelBranches ?? []), createBranch([])],
      next: branch.next ?? createBranch([]),
    })),
  }));
}

/** Add another empty alternate leg to a target branch that already has a parallel group. */
export function addBranchLeg(
  routine: LadderRoutine,
  rungId: string,
  branchId?: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: mapBranchById(rung.root, branchId ?? rung.root.id, (branch) =>
      branch.parallelBranches && branch.parallelBranches.length > 0
        ? { ...branch, parallelBranches: [...branch.parallelBranches, createBranch([])] }
        : branch,
    ),
  }));
}

/** Remove a parallel leg (by id) from anywhere in a rung's branch tree. */
export function removeBranchLeg(
  routine: LadderRoutine,
  rungId: string,
  branchId: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({ ...rung, root: removeLegFromTree(rung.root, branchId) }));
}

function removeLegFromTree(branch: LadderBranch, legId: string): LadderBranch {
  const result: LadderBranch = { ...branch };
  if (branch.parallelBranches) {
    const filtered = branch.parallelBranches
      .filter((leg) => leg.id !== legId)
      .map((leg) => removeLegFromTree(leg, legId));
    if (filtered.length > 0) result.parallelBranches = filtered;
    else delete result.parallelBranches;
  }
  if (branch.next) result.next = removeLegFromTree(branch.next, legId);
  return result;
}

/** True when `legId` is a parallel leg (in some branch's parallelBranches) of the rung. */
export function isParallelLeg(root: LadderBranch, legId: string): boolean {
  const visit = (branch: LadderBranch): boolean => {
    const legs = branch.parallelBranches ?? [];
    if (legs.some((leg) => leg.id === legId)) return true;
    return legs.some(visit) || (branch.next ? visit(branch.next) : false);
  };
  return visit(root);
}

/** Append `node` to the series of a specific branch (by id) within a rung's tree. */
export function appendNodeToBranch(
  routine: LadderRoutine,
  rungId: string,
  branchId: string,
  node: LadderNode,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: appendNodeToBranchTree(rung.root, branchId, node),
  }));
}

function appendNodeToBranchTree(
  branch: LadderBranch,
  branchId: string,
  node: LadderNode,
): LadderBranch {
  if (branch.id === branchId) {
    return { ...branch, nodes: [...branch.nodes, node] };
  }
  const result: LadderBranch = { ...branch };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map((leg) =>
      appendNodeToBranchTree(leg, branchId, node),
    );
  }
  if (branch.next) {
    result.next = appendNodeToBranchTree(branch.next, branchId, node);
  }
  return result;
}

/** Find a branch by id anywhere in a rung's branch tree (read-only lookup). */
export function findBranchInRoot(root: LadderBranch, branchId: string): LadderBranch | undefined {
  if (root.id === branchId) return root;
  for (const leg of root.parallelBranches ?? []) {
    const found = findBranchInRoot(leg, branchId);
    if (found) return found;
  }
  return root.next ? findBranchInRoot(root.next, branchId) : undefined;
}

/** Apply `fn` to every node across every rung of the routine (immutably). */
export function mapRoutineNodes(
  routine: LadderRoutine,
  fn: (node: LadderNode) => LadderNode,
): LadderRoutine {
  return {
    ...routine,
    rungs: routine.rungs.map((rung) => ({ ...rung, root: mapBranch(rung.root, fn) })),
  };
}

function withOperandValueAt(
  node: LadderNode,
  index: number,
  value: string,
): InstructionOperand[] {
  const operands = node.operands.slice();
  if (index < operands.length) {
    operands[index] = { ...operands[index], value };
    return operands;
  }
  while (operands.length < index) {
    operands.push(tagOperand(`op${operands.length}`, ""));
  }
  operands.push(tagOperand(`op${index}`, value));
  return operands;
}

/** Set the value of a node's operand at `index` (defaults to the first operand). */
export function setOperandValue(
  routine: LadderRoutine,
  rungId: string,
  nodeId: string,
  value: string,
  index = 0,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: mapBranch(rung.root, (node) =>
      node.id === nodeId
        ? { ...node, operands: withOperandValueAt(node, index, value) }
        : node,
    ),
  }));
}
