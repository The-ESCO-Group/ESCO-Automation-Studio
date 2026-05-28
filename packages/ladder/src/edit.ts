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

/** Append a new empty rung. */
export function addRung(routine: LadderRoutine): LadderRoutine {
  const rung: LadderRung = {
    id: createId("rung"),
    routineId: routine.id,
    number: routine.rungs.length,
    root: createBranch([]),
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
