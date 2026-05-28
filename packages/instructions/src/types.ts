import type { LadderNode } from "@esco/ladder";

export type InstructionCategory =
  | "bit"
  | "timer"
  | "counter"
  | "compare"
  | "math"
  | "move"
  | "program-control";

export type InstructionStyle = "contact" | "coil" | "box" | "function";

export interface InstructionOperandDefinition {
  name: string;
  label: string;
  required: boolean;
  allowedTypes?: string[];
}

/** Read/write access an instruction needs against the tag memory during a scan. */
export interface InstructionRuntimeContext {
  rungIn: boolean;
  readBool(path: string): boolean;
  writeBool(path: string, value: boolean): void;
}

export type InstructionValidator = (node: LadderNode) => string[];
export type InstructionExecutor = (
  node: LadderNode,
  ctx: InstructionRuntimeContext,
) => boolean;

export interface InstructionDefinition {
  type: string;
  displayName: string;
  category: InstructionCategory;
  description: string;
  operands: InstructionOperandDefinition[];
  validate: InstructionValidator;
  execute: InstructionExecutor;
  render: {
    symbol: string;
    style: InstructionStyle;
  };
}
