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
  /** Whether the instruction reads or writes this operand's tag (defaults to "read"). */
  direction?: "read" | "write";
  /** True when the operand names a routine (e.g. JSR), not a tag — skips tag validation. */
  isRoutineRef?: boolean;
}

/** Read/write access an instruction needs against the tag memory during a scan. */
export interface InstructionRuntimeContext {
  rungIn: boolean;
  /** Milliseconds elapsed since the previous scan; drives timers like TON. */
  deltaMs: number;
  readBool(path: string): boolean;
  writeBool(path: string, value: boolean): void;
  readNumber(path: string): number;
  writeNumber(path: string, value: number): void;
  /**
   * Resolve an operand string to a number: a numeric literal (e.g. "3000")
   * yields its value; anything else is read as a tag/member path.
   */
  numeric(operandValue: string): number;
  /**
   * Execute another routine by name against the same tag memory (JSR). Provided
   * by the executor when sibling routines are known; a no-op otherwise. The
   * executor enforces a call-depth limit to prevent infinite recursion.
   */
  callRoutine?(name: string): void;
  /** Request an early return from the current routine (RET). */
  requestReturn?(): void;
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
