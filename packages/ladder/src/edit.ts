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

/** Add an instruction (with an optional tag operand) to the end of a rung. */
export function appendInstruction(
  routine: LadderRoutine,
  rungId: string,
  instructionType: string,
  tagName = "",
): LadderRoutine {
  const node = createNode(instructionType, [tagOperand("tag", tagName)]);
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

function withFirstOperandValue(node: LadderNode, value: string): InstructionOperand[] {
  if (node.operands.length === 0) {
    return [tagOperand("tag", value)];
  }
  const [first, ...rest] = node.operands;
  return [{ ...first, value }, ...rest];
}

/** Set the first operand's value (tag name) of a node. */
export function setOperandValue(
  routine: LadderRoutine,
  rungId: string,
  nodeId: string,
  value: string,
): LadderRoutine {
  return mapRung(routine, rungId, (rung) => ({
    ...rung,
    root: mapBranch(rung.root, (node) =>
      node.id === nodeId
        ? { ...node, operands: withFirstOperandValue(node, value) }
        : node,
    ),
  }));
}
