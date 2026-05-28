import { createId } from "@esco/shared";
import type {
  InstructionOperand,
  LadderBranch,
  LadderNode,
  LadderRoutine,
  LadderRung,
} from "./types";

export function createLadderRoutine(): LadderRoutine {
  return { id: createId("ladder"), rungs: [] };
}

export function createBranch(
  nodes: LadderNode[] = [],
  options: { parallelBranches?: LadderBranch[]; next?: LadderBranch } = {},
): LadderBranch {
  const branch: LadderBranch = { id: createId("branch"), nodes };
  if (options.parallelBranches) branch.parallelBranches = options.parallelBranches;
  if (options.next) branch.next = options.next;
  return branch;
}

export function createNode(
  instructionType: string,
  operands: InstructionOperand[] = [],
): LadderNode {
  return { id: createId("node"), instructionType, operands };
}

export function tagOperand(name: string, value: string): InstructionOperand {
  return { name, kind: "tag", value };
}

export function createRung(
  routineId: string,
  number: number,
  nodes: LadderNode[] = [],
  comment?: string,
): LadderRung {
  return {
    id: createId("rung"),
    routineId,
    number,
    comment,
    root: createBranch(nodes),
  };
}
