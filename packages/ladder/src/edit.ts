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

const MAX_BRANCHES_PER_EDIT = 2_000;
const MAX_NODES_PER_EDIT = 20_000;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInstructionOperand(value: unknown): value is InstructionOperand {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    typeof value.value === "string" &&
    (value.dataType === undefined || typeof value.dataType === "string")
  );
}

function isValidNodeShape(value: unknown): value is LadderNode {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || typeof value.instructionType !== "string") {
    return false;
  }
  if (!Array.isArray(value.operands) || !value.operands.every(isInstructionOperand)) {
    return false;
  }
  if (value.position !== undefined) {
    if (!isRecord(value.position)) return false;
    if (typeof value.position.row !== "number" || typeof value.position.column !== "number") {
      return false;
    }
  }
  return true;
}

function isBranchShape(value: unknown): value is LadderBranch {
  return isRecord(value) && isNonEmptyString(value.id) && Array.isArray(value.nodes);
}

interface BranchValidationState {
  branchIds: Set<string>;
  branchObjects: WeakSet<object>;
  nodeIds: Set<string>;
  branchCount: number;
  nodeCount: number;
}

function validateBranchTree(value: unknown, state: BranchValidationState): value is LadderBranch {
  if (!isRecord(value)) return false;
  if (state.branchObjects.has(value)) return false;
  state.branchObjects.add(value);

  if (!isNonEmptyString(value.id) || state.branchIds.has(value.id)) {
    return false;
  }
  state.branchIds.add(value.id);
  state.branchCount += 1;
  if (state.branchCount > MAX_BRANCHES_PER_EDIT) return false;

  if (!Array.isArray(value.nodes)) return false;
  for (const node of value.nodes) {
    if (!isValidNodeShape(node) || state.nodeIds.has(node.id)) {
      return false;
    }
    state.nodeIds.add(node.id);
    state.nodeCount += 1;
    if (state.nodeCount > MAX_NODES_PER_EDIT) return false;
  }

  if (value.parallelBranches !== undefined) {
    if (!Array.isArray(value.parallelBranches)) return false;
    for (const leg of value.parallelBranches) {
      if (!validateBranchTree(leg, state)) return false;
    }
  }

  return value.next === undefined || validateBranchTree(value.next, state);
}

function createBranchValidationState(): BranchValidationState {
  return {
    branchIds: new Set<string>(),
    branchObjects: new WeakSet<object>(),
    nodeIds: new Set<string>(),
    branchCount: 0,
    nodeCount: 0,
  };
}

function isValidBranchRootForEdit(root: unknown): root is LadderBranch {
  try {
    return validateBranchTree(root, createBranchValidationState());
  } catch {
    return false;
  }
}

function isValidRoutineForEdit(routine: unknown): routine is LadderRoutine {
  if (!isRecord(routine) || !isNonEmptyString(routine.id) || !Array.isArray(routine.rungs)) {
    return false;
  }

  const rungIds = new Set<string>();
  const state = createBranchValidationState();
  try {
    for (const rung of routine.rungs) {
      if (!isRecord(rung) || !isNonEmptyString(rung.id) || rungIds.has(rung.id)) {
        return false;
      }
      if (typeof rung.routineId !== "string" || typeof rung.number !== "number") {
        return false;
      }
      rungIds.add(rung.id);
      if (!validateBranchTree(rung.root, state)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function cloneNodePreservingId(node: LadderNode): LadderNode {
  return {
    id: node.id,
    instructionType: node.instructionType,
    operands: node.operands.map((operand) => ({ ...operand })),
    ...(node.position ? { position: { ...node.position } } : {}),
  };
}

/** Deep-clone a node with a brand-new id (operands copied). */
function cloneNodeWithNewId(node: LadderNode): LadderNode {
  return { ...cloneNodePreservingId(node), id: createId("node") };
}

function cloneBranchPreservingIds(branch: LadderBranch): LadderBranch {
  const result: LadderBranch = {
    id: branch.id,
    nodes: branch.nodes.map(cloneNodePreservingId),
  };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map(cloneBranchPreservingIds);
  }
  if (branch.next) result.next = cloneBranchPreservingIds(branch.next);
  return result;
}

function cloneRoutinePreservingIds(routine: LadderRoutine): LadderRoutine {
  return {
    ...routine,
    rungs: routine.rungs.map((rung) => ({
      ...rung,
      root: cloneBranchPreservingIds(rung.root),
    })),
  };
}

function withEditTransaction(
  routine: LadderRoutine,
  edit: (draft: LadderRoutine) => LadderRoutine | undefined,
): LadderRoutine {
  if (!isValidRoutineForEdit(routine)) return routine;

  try {
    const draft = cloneRoutinePreservingIds(routine);
    const next = edit(draft);
    if (!next) return routine;
    return isValidRoutineForEdit(next) ? next : routine;
  } catch {
    return routine;
  }
}

/** Deep-clone a branch tree with brand-new ids throughout. */
export function cloneBranchWithNewIds(branch: LadderBranch): LadderBranch {
  if (!isValidBranchRootForEdit(branch)) {
    throw new Error("Cannot clone a malformed ladder branch root.");
  }
  const result: LadderBranch = {
    id: createId("branch"),
    nodes: branch.nodes.map(cloneNodeWithNewId),
  };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map(cloneBranchWithNewIds);
  }
  if (branch.next) result.next = cloneBranchWithNewIds(branch.next);
  return result;
}

/** Append a new empty rung. */
export function addRung(routine: LadderRoutine): LadderRoutine {
  return withEditTransaction(routine, (draft) => insertRungAtUnchecked(draft, draft.rungs.length, createBranch([])));
}

/** Duplicate a rung in place: a fresh-id copy is inserted right after it. */
export function duplicateRung(routine: LadderRoutine, rungId: string): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const index = draft.rungs.findIndex((rung) => rung.id === rungId);
    if (index < 0) return undefined;
    const source = draft.rungs[index]!;
    const copy: LadderRung = {
      id: createId("rung"),
      routineId: draft.id,
      number: index + 1,
      comment: source.comment,
      root: cloneBranchWithNewIds(source.root),
    };
    const rungs = [...draft.rungs];
    rungs.splice(index + 1, 0, copy);
    return { ...draft, rungs: renumber(rungs) };
  });
}

/** Append a rung built from a (cloned) branch root — used for paste. */
export function insertRungFromRoot(
  routine: LadderRoutine,
  root: LadderBranch,
  comment?: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => insertRungAtUnchecked(draft, draft.rungs.length, root, comment));
}

/** Append a rung with a pre-built branch root (e.g. parsed from rung text). */
export function appendRungWithRoot(
  routine: LadderRoutine,
  root: LadderBranch,
  comment?: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => insertRungAtUnchecked(draft, draft.rungs.length, root, comment));
}

function insertRungAtUnchecked(
  routine: LadderRoutine,
  index: number,
  root: LadderBranch,
  comment?: string,
): LadderRoutine {
  const at = Number.isFinite(index) ? Math.max(0, Math.min(index, routine.rungs.length)) : routine.rungs.length;
  const rung: LadderRung = {
    id: createId("rung"),
    routineId: routine.id,
    number: at,
    comment,
    root: cloneBranchWithNewIds(root),
  };
  const rungs = [...routine.rungs];
  rungs.splice(at, 0, rung);
  return { ...routine, rungs: renumber(rungs) };
}

/**
 * Insert a rung at an explicit position. `index` is clamped to `[0, length]`, so
 * `0` prepends and `length` appends. The branch root defaults to a fresh empty
 * series and is cloned when provided. Used by the Insert Rung Above/Below
 * and relative-paste editor actions.
 */
export function insertRungAt(
  routine: LadderRoutine,
  index: number,
  root: LadderBranch = createBranch([]),
  comment?: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => insertRungAtUnchecked(draft, index, root, comment));
}

/**
 * Insert a rung directly above or below an existing rung (by id). The new rung's
 * root is a deep copy of `root` when provided (so a paste source keeps its own
 * identity), otherwise a fresh empty series. No-op if `rungId` is unknown.
 */
export function insertRungRelative(
  routine: LadderRoutine,
  rungId: string,
  position: "above" | "below",
  root?: LadderBranch,
  comment?: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const index = draft.rungs.findIndex((rung) => rung.id === rungId);
    if (index < 0) return undefined;
    return insertRungAtUnchecked(
      draft,
      position === "above" ? index : index + 1,
      root ?? createBranch([]),
      comment,
    );
  });
}

/** Remove a rung by id and renumber the remainder. */
export function removeRung(routine: LadderRoutine, rungId: string): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const index = draft.rungs.findIndex((rung) => rung.id === rungId);
    if (index < 0) return undefined;
    const rungs = [...draft.rungs];
    rungs.splice(index, 1);
    return { ...draft, rungs: renumber(rungs) };
  });
}

function mapRung(
  routine: LadderRoutine,
  rungId: string,
  fn: (rung: LadderRung) => LadderRung,
): LadderRoutine | undefined {
  const index = routine.rungs.findIndex((rung) => rung.id === rungId);
  if (index < 0) return undefined;
  const rungs = [...routine.rungs];
  rungs[index] = fn(rungs[index]!);
  return {
    ...routine,
    rungs,
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

export function countNodeIdInBranch(branch: LadderBranch, nodeId: string): number {
  return countNodeIdInBranchSafe(branch, nodeId, new WeakSet<object>());
}

export function countBranchIdInRoot(branch: LadderBranch, branchId: string): number {
  return countBranchIdInRootSafe(branch, branchId, new WeakSet<object>());
}

export function isValidOperandIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index <= 255;
}

function countNodeIdInBranchSafe(value: unknown, nodeId: string, seen: WeakSet<object>): number {
  if (!isRecord(value) || seen.has(value)) return 0;
  seen.add(value);
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const here = nodes.filter((node) => isRecord(node) && node.id === nodeId).length;
  const parallelBranches = Array.isArray(value.parallelBranches) ? value.parallelBranches : [];
  const parallel = parallelBranches.reduce((sum, leg) => sum + countNodeIdInBranchSafe(leg, nodeId, seen), 0);
  return here + parallel + countNodeIdInBranchSafe(value.next, nodeId, seen);
}

function countBranchIdInRootSafe(value: unknown, branchId: string, seen: WeakSet<object>): number {
  if (!isRecord(value) || seen.has(value)) return 0;
  seen.add(value);
  const here = value.id === branchId ? 1 : 0;
  const parallelBranches = Array.isArray(value.parallelBranches) ? value.parallelBranches : [];
  const parallel = parallelBranches.reduce((sum, leg) => sum + countBranchIdInRootSafe(leg, branchId, seen), 0);
  return here + parallel + countBranchIdInRootSafe(value.next, branchId, seen);
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
  return withEditTransaction(routine, (draft) =>
    mapRung(draft, rungId, (rung) => ({
      ...rung,
      root: appendToTerminalSeries(rung.root, cloneNodePreservingId(node)),
    })),
  );
}

/**
 * Insert `node` immediately before or after an existing node (by id) within
 * whichever series segment of the rung's branch tree contains it. This keeps the
 * insertion local to the node's branch leg, so inserting next to an instruction
 * inside a parallel branch stays inside that branch. No-op if `targetNodeId` is
 * not found anywhere in the rung.
 */
export function insertNodeRelativeToNode(
  routine: LadderRoutine,
  rungId: string,
  targetNodeId: string,
  node: LadderNode,
  position: "before" | "after",
): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung || countNodeIdInBranch(rung.root, targetNodeId) !== 1) return undefined;
    const inserted = cloneNodePreservingId(node);
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: insertNodeIntoTree(current.root, targetNodeId, inserted, position),
    }));
  });
}

function insertNodeIntoTree(
  branch: LadderBranch,
  targetNodeId: string,
  node: LadderNode,
  position: "before" | "after",
): LadderBranch {
  const targetIndex = branch.nodes.findIndex((candidate) => candidate.id === targetNodeId);
  let nodes = branch.nodes;
  if (targetIndex >= 0) {
    nodes = [...branch.nodes];
    nodes.splice(position === "before" ? targetIndex : targetIndex + 1, 0, node);
  }
  const result: LadderBranch = { id: branch.id, nodes };
  if (branch.parallelBranches) {
    result.parallelBranches = branch.parallelBranches.map((leg) =>
      insertNodeIntoTree(leg, targetNodeId, node, position),
    );
  }
  if (branch.next) {
    result.next = insertNodeIntoTree(branch.next, targetNodeId, node, position);
  }
  return result;
}

/** Remove a single instruction from a rung by node id. */
export function removeInstruction(
  routine: LadderRoutine,
  rungId: string,
  nodeId: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung || countNodeIdInBranch(rung.root, nodeId) !== 1) return undefined;
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: mapBranch(current.root, (node) => (node.id === nodeId ? null : node)),
    }));
  });
}

/** Set (or clear) a rung's comment. */
export function setRungComment(
  routine: LadderRoutine,
  rungId: string,
  comment: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) =>
    mapRung(draft, rungId, (rung) => ({ ...rung, comment: comment || undefined })),
  );
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
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung) return undefined;
    const targetBranchId = branchId ?? rung.root.id;
    if (countBranchIdInRoot(rung.root, targetBranchId) !== 1) return undefined;
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: mapBranchById(current.root, targetBranchId, (branch) => ({
        ...branch,
        parallelBranches: [...(branch.parallelBranches ?? []), createBranch([])],
        next: branch.next ?? createBranch([]),
      })),
    }));
  });
}

/** Add another empty alternate leg to a target branch that already has a parallel group. */
export function addBranchLeg(
  routine: LadderRoutine,
  rungId: string,
  branchId?: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung) return undefined;
    const targetBranchId = branchId ?? rung.root.id;
    const branch = findBranchInRoot(rung.root, targetBranchId);
    if (!branch || countBranchIdInRoot(rung.root, targetBranchId) !== 1) return undefined;
    if (!branch.parallelBranches || branch.parallelBranches.length === 0) return undefined;
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: mapBranchById(current.root, targetBranchId, (target) => ({
        ...target,
        parallelBranches: [...target.parallelBranches!, createBranch([])],
      })),
    }));
  });
}

/** Remove a parallel leg (by id) from anywhere in a rung's branch tree. */
export function removeBranchLeg(
  routine: LadderRoutine,
  rungId: string,
  branchId: string,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung || countBranchIdInRoot(rung.root, branchId) !== 1 || !isParallelLeg(rung.root, branchId)) {
      return undefined;
    }
    return mapRung(draft, rungId, (current) => ({ ...current, root: removeLegFromTree(current.root, branchId) }));
  });
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
  const seen = new WeakSet<object>();
  const visit = (branch: unknown): boolean => {
    if (!isRecord(branch) || seen.has(branch)) return false;
    seen.add(branch);
    const legs = branch.parallelBranches ?? [];
    if (!Array.isArray(legs)) return false;
    if (legs.some((leg) => isRecord(leg) && leg.id === legId)) return true;
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
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung || countBranchIdInRoot(rung.root, branchId) !== 1) return undefined;
    const inserted = cloneNodePreservingId(node);
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: appendNodeToBranchTree(current.root, branchId, inserted),
    }));
  });
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
  return findBranchInRootSafe(root, branchId, new WeakSet<object>());
}

function findBranchInRootSafe(
  root: unknown,
  branchId: string,
  seen: WeakSet<object>,
): LadderBranch | undefined {
  if (!isRecord(root) || seen.has(root)) return undefined;
  seen.add(root);
  if (root.id === branchId) return isBranchShape(root) ? root : undefined;
  const parallelBranches = Array.isArray(root.parallelBranches) ? root.parallelBranches : [];
  for (const leg of parallelBranches) {
    const found = findBranchInRootSafe(leg, branchId, seen);
    if (found) return found;
  }
  return findBranchInRootSafe(root.next, branchId, seen);
}

/** Apply `fn` to every node across every rung of the routine (immutably). */
export function mapRoutineNodes(
  routine: LadderRoutine,
  fn: (node: LadderNode) => LadderNode,
): LadderRoutine {
  return withEditTransaction(routine, (draft) => ({
    ...draft,
    rungs: draft.rungs.map((rung) => ({ ...rung, root: mapBranch(rung.root, fn) })),
  }));
}

function withOperandValueAt(
  node: LadderNode,
  index: number,
  value: string,
): InstructionOperand[] {
  if (!isValidOperandIndex(index)) return node.operands;
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
  if (!isValidOperandIndex(index)) return routine;
  return withEditTransaction(routine, (draft) => {
    const rung = draft.rungs.find((candidate) => candidate.id === rungId);
    if (!rung || countNodeIdInBranch(rung.root, nodeId) !== 1) return undefined;
    return mapRung(draft, rungId, (current) => ({
      ...current,
      root: mapBranch(current.root, (node) =>
        node.id === nodeId
          ? { ...node, operands: withOperandValueAt(node, index, value) }
          : node,
      ),
    }));
  });
}
