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

/**
 * Add a parallel branch group to a rung. The rung's existing main-line series
 * (`root.nodes`) becomes the first leg; a new empty alternate leg is added
 * beside it, and a downstream series continuation (`root.next`) is ensured so
 * the normal palette appends instructions *after* the parallel merge rather than
 * into a leg. Single-level parallels only — the MVP scope.
 */
export function addParallelBranch(routine: LadderRoutine, rungId: string): LadderRoutine {
  return mapRung(routine, rungId, (rung) => {
    const root = rung.root;
    return {
      ...rung,
      root: {
        ...root,
        parallelBranches: [...(root.parallelBranches ?? []), createBranch([])],
        next: root.next ?? createBranch([]),
      },
    };
  });
}

/** Add another empty alternate leg to a rung that already has a parallel group. */
export function addBranchLeg(routine: LadderRoutine, rungId: string): LadderRoutine {
  return mapRung(routine, rungId, (rung) => {
    const root = rung.root;
    if (!root.parallelBranches || root.parallelBranches.length === 0) return rung;
    return {
      ...rung,
      root: { ...root, parallelBranches: [...root.parallelBranches, createBranch([])] },
    };
  });
}

/** Remove an alternate leg from a rung's parallel group by branch id. */
export function removeBranchLeg(
  routine: LadderRoutine,
  rungId: string,
  branchId: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => {
    const root = rung.root;
    if (!root.parallelBranches) return rung;
    const filtered = root.parallelBranches.filter((leg) => leg.id !== branchId);
    if (filtered.length === root.parallelBranches.length) return rung; // id not found
    const nextRoot: LadderBranch = { ...root };
    if (filtered.length > 0) nextRoot.parallelBranches = filtered;
    else delete nextRoot.parallelBranches;
    return { ...rung, root: nextRoot };
  });
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
