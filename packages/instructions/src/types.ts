import type { LadderNode } from "@esco/ladder";

export type InstructionCategory =
  | "bit"
  | "timer"
  | "counter"
  | "compare"
  | "math"
  | "move"
  | "program-control"
  | "sequencer"
  | "shift"
  | "file"
  | "message"
  | "alarm"
  | "motion"
  | "process"
  | "safety";

export type InstructionStyle = "contact" | "coil" | "box" | "function";

export type InstructionFidelityStatus =
  | "executable-simulation"
  | "executable-partial"
  | "model-only"
  | "review-only"
  | "unsupported";

export interface InstructionFidelityMetadata {
  status: InstructionFidelityStatus;
  /** Short, user-facing explanation of what the offline runtime does with this instruction. */
  summary: string;
  /** Specific behaviours that are preserved only as metadata/review context. */
  limitations?: string[];
}

export interface InstructionOperandDefinition {
  name: string;
  label: string;
  required: boolean;
  allowedTypes?: string[];
  /** Whether the instruction reads or writes this operand's tag (defaults to "read"). */
  direction?: "read" | "write";
  /** True when the operand names a routine (e.g. JSR), not a tag — skips tag validation. */
  isRoutineRef?: boolean;
  /** True when the operand names a rung label or keyword (e.g. JMP/LBL), not a tag — skips tag validation. */
  isLabelRef?: boolean;
  /**
   * True when the operand is a CPT/CMP-style numeric/comparison expression rather
   * than a single tag. The validator extracts and checks every tag the expression
   * references (skipping literals and functions) instead of treating the whole
   * string as one tag path.
   */
  isExpression?: boolean;
  /**
   * True for concrete backing/control tags on model-only instructions that are
   * safe to validate even though the instruction is preserved and not simulated.
   */
  validateOnModelOnly?: boolean;
}

/** Read/write access an instruction needs against the tag memory during a scan. */
export interface InstructionRuntimeContext {
  rungIn: boolean;
  /** Milliseconds elapsed since the previous scan; drives timers like TON. */
  deltaMs: number;
  /** Read a raw scalar tag value without numeric/string/bool coercion. */
  readValue?(path: string): boolean | number | string;
  /** Write a raw scalar tag value without numeric/string/bool coercion. */
  writeValue?(path: string, value: boolean | number | string): void;
  readBool(path: string): boolean;
  writeBool(path: string, value: boolean): void;
  readNumber(path: string): number;
  writeNumber(path: string, value: number): void;
  readString(path: string): string;
  writeString(path: string, value: string): void;
  /**
   * Resolve an operand string to a number: a numeric literal (e.g. "3000")
   * yields its value; anything else is read as a tag/member path.
   */
  numeric(operandValue: string): number;
  /** Return the declared size of an array dimension when the runtime has tag metadata. */
  arrayDimension?(source: string, dimension: number): number | undefined;
  /**
   * Execute another routine by name against the same tag memory (JSR). Provided
   * by the executor when sibling routines are known; a no-op otherwise. The
   * executor enforces a call-depth limit to prevent infinite recursion.
   */
  callRoutine?(name: string, parameters?: string[]): void;
  /**
   * Execute a sibling routine as a bounded FOR loop. `index` is a writable tag
   * path; bounds/step are numeric values resolved by the FOR instruction.
   */
  runFor?(name: string, index: string, initial: number, terminal: number, step: number): void;
  /** Request an early return from the current routine (RET). */
  requestReturn?(parameters?: string[]): void;
  /** Request exit from the innermost FOR loop (BRK). */
  requestBreak?(): void;
  /** Request a jump to a rung label (JMP/LBL). The routine executor resolves it. */
  requestJump?(label: string): void;
  /** Whether the current routine scan is inside an MCR zone. */
  mcrActive?(): boolean;
  /** Open an MCR zone with the current enable state. */
  enterMcr?(enabled: boolean): void;
  /** Close the active MCR zone. */
  exitMcr?(): void;
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
  /**
   * Fine-grained support/fidelity metadata. Omitted executable instructions
   * default to "executable-simulation"; omitted modelOnly instructions default
   * to "model-only". This metadata describes ESCO's offline simulator, not
   * firmware-faithful controller execution.
   */
  fidelity?: InstructionFidelityMetadata;
  /**
   * True for instructions that are recognized (so they parse, render, and don't
   * count as "unsupported"), but are NOT simulated — their execute is a safe
   * pass-through and the validator reports them as info, never an error.
   */
  modelOnly?: boolean;
  validate: InstructionValidator;
  execute: InstructionExecutor;
  render: {
    symbol: string;
    style: InstructionStyle;
  };
}

/**
 * How fully an instruction is supported, for clear UI labelling:
 *  - "executable"  — recognized, validated, and simulated by the runtime.
 *  - "model-only"  — recognized, preserved, and displayed, but never simulated
 *                    (safe pass-through). Covers process/motion/safety/message
 *                    families that have no faithful offline execution.
 *  - "unknown"     — not in the registry at all; preserved verbatim as read-only
 *                    logic on the rung, never simulated.
 */
export type SupportLevel = "executable" | "model-only" | "unknown";

export function instructionFidelity(def: InstructionDefinition | undefined): InstructionFidelityMetadata {
  if (!def) {
    return {
      status: "unsupported",
      summary: "Not registered in the instruction catalog; preserved as unsupported logic and never simulated.",
      limitations: ["no instruction metadata", "no offline simulation"],
    };
  }
  if (def.fidelity) return def.fidelity;
  if (def.modelOnly) {
    return {
      status: "model-only",
      summary: "Recognized, rendered, and preserved, but execution is a pass-through and no instruction side effects are simulated.",
      limitations: ["no runtime tag-memory side effects", "no controller or hardware side effects"],
    };
  }
  return {
    status: "executable-simulation",
    summary: "Executed by the ESCO offline simulator using the supported deterministic instruction model.",
    limitations: ["offline simulator semantics; verify controller-specific firmware behavior in Studio/controller tools"],
  };
}

/** Classify an instruction definition (or a missing one) into a support level. */
export function supportLevel(def: InstructionDefinition | undefined): SupportLevel {
  const status = instructionFidelity(def).status;
  if (status === "unsupported") return "unknown";
  if (status === "model-only" || status === "review-only") return "model-only";
  return "executable";
}

/** Human-readable label for a support level, matching the UI badges. */
export function supportLevelLabel(level: SupportLevel): string {
  switch (level) {
    case "executable":
      return "Executable";
    case "model-only":
      return "Model-only / preserved, not simulated";
    case "unknown":
      return "Unknown unsupported";
  }
}

export function instructionFidelityLabel(status: InstructionFidelityStatus): string {
  switch (status) {
    case "executable-simulation":
      return "Executable simulation";
    case "executable-partial":
      return "Executable partial";
    case "model-only":
      return "Model-only";
    case "review-only":
      return "Review-only";
    case "unsupported":
      return "Unsupported";
  }
}
