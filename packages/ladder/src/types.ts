/**
 * Semantic ladder model. Ladder logic is stored as a structured AST, not as
 * plain text, so it can be rendered, validated, simulated, and round-tripped.
 */

export type OperandKind = "tag" | "literal" | "expression" | "routine";

export interface InstructionOperand {
  name: string;
  kind: OperandKind;
  value: string;
  dataType?: string;
}

export interface LadderNode {
  id: string;
  instructionType: string;
  operands: InstructionOperand[];
  position?: {
    row: number;
    column: number;
  };
}

export interface LadderBranch {
  id: string;
  /** Instructions wired in series within this segment, left to right. */
  nodes: LadderNode[];
  /** Parallel paths OR-ed around this segment's series (e.g. a seal-in branch). */
  parallelBranches?: LadderBranch[];
  /**
   * Series continuation evaluated after this segment (and its parallel merge).
   * Lets a parallel group be followed by more series instructions on one rung,
   * e.g. (StartPB ‖ MotorRun) → StopPB → MotorRun coil.
   */
  next?: LadderBranch;
}

export interface LadderRung {
  id: string;
  routineId: string;
  number: number;
  comment?: string;
  root: LadderBranch;
  sourceText?: string;
  normalizedText?: string;
}

export interface LadderRoutine {
  id: string;
  rungs: LadderRung[];
}
