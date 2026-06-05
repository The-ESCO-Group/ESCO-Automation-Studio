import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { isNumericLiteral } from "./operands";
import { evaluateExpression } from "./expression";

/**
 * Studio 5000 sequencer instructions.
 *
 * SQO and SQL advance the CONTROL.POS member on a false-to-true enable edge,
 * then use the current position to write the output/table value. SQI/SQC compare
 * a source value with the array value at CONTROL.POS. This is deterministic
 * offline execution of the documented DINT/mask behavior; it does not model
 * controller faults beyond setting CONTROL.ER for invalid lengths/positions.
 */

const DINTISH = ["SINT", "INT", "DINT"];
const CONTROL = ["CONTROL"];
const POSITION_LIMIT = 100_000;

type OperandNode = { operands: { value: string }[] };

function op(node: OperandNode, index: number): string {
  return node.operands[index]?.value?.trim() ?? "";
}

function requireOperands(names: string[]) {
  return (node: OperandNode): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

function startIndex(ctx: InstructionRuntimeContext, raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const result = evaluateExpression(trimmed, (path) => ctx.readNumber(path));
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : result.ok ? result.value : ctx.readNumber(trimmed);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Resolve an operand like `Seq`, `Seq[3]`, or `Seq[Index]` to a base + start. */
function elementBase(ctx: InstructionRuntimeContext, operand: string): { base: string; start: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?$/);
  if (!match) return { base: operand.trim(), start: 0 };
  return { base: match[1]!, start: startIndex(ctx, match[2]) };
}

function elementPath(ctx: InstructionRuntimeContext, operand: string, position: number): string {
  const { base, start } = elementBase(ctx, operand);
  return `${base}[${start + position}]`;
}

function boundedDint(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value) | 0;
}

function boundedLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.trunc(value), POSITION_LIMIT);
}

function member(control: string, name: string): string {
  return `${control}.${name}`;
}

function positionOperand(node: OperandNode, index: number): string {
  return op(node, index);
}

function readPosition(ctx: InstructionRuntimeContext, control: string, fallbackOperand: string): number {
  let position = boundedDint(ctx.readNumber(member(control, "POS")));
  if (position === 0 && fallbackOperand) position = boundedDint(ctx.numeric(fallbackOperand));
  return position;
}

function writePosition(
  ctx: InstructionRuntimeContext,
  control: string,
  fallbackOperand: string,
  position: number,
): void {
  ctx.writeNumber(member(control, "POS"), position);
  if (fallbackOperand && !isNumericLiteral(fallbackOperand)) ctx.writeNumber(fallbackOperand, position);
}

interface SequencerAdvance {
  active: boolean;
  position: number;
  length: number;
}

function advanceSequencer(
  node: OperandNode,
  ctx: InstructionRuntimeContext,
  controlIndex: number,
  lengthIndex: number,
  positionIndex: number,
): SequencerAdvance {
  const control = op(node, controlIndex);
  const fallbackPosition = positionOperand(node, positionIndex);
  if (!control) return { active: false, position: 0, length: 0 };

  if (!ctx.rungIn) {
    ctx.writeBool(member(control, "EN"), false);
    return { active: false, position: readPosition(ctx, control, fallbackPosition), length: 0 };
  }

  const wasEnabled = ctx.readBool(member(control, "EN"));
  const length = boundedLength(ctx.numeric(op(node, lengthIndex)));
  ctx.writeNumber(member(control, "LEN"), length);
  ctx.writeBool(member(control, "EN"), true);

  if (length <= 0) {
    ctx.writeBool(member(control, "ER"), true);
    ctx.writeBool(member(control, "DN"), false);
    return { active: false, position: 0, length };
  }

  let position = readPosition(ctx, control, fallbackPosition);
  if (!wasEnabled) {
    position += 1;
    if (position < 1 || position > length) position = 1;
  }

  writePosition(ctx, control, fallbackPosition, position);
  ctx.writeBool(member(control, "ER"), false);
  ctx.writeBool(member(control, "DN"), position >= length);
  return { active: true, position, length };
}

function readComparePosition(
  node: OperandNode,
  ctx: InstructionRuntimeContext,
  controlIndex: number,
  lengthIndex: number,
  positionIndex: number,
): SequencerAdvance {
  const control = op(node, controlIndex);
  if (!ctx.rungIn || !control) return { active: false, position: 0, length: 0 };

  const length = boundedLength(ctx.numeric(op(node, lengthIndex)));
  const fallbackPosition = positionOperand(node, positionIndex);
  const position = readPosition(ctx, control, fallbackPosition);
  ctx.writeNumber(member(control, "LEN"), length);
  writePosition(ctx, control, fallbackPosition, position);

  const active = length > 0 && position >= 0 && position <= length;
  ctx.writeBool(member(control, "ER"), !active);
  ctx.writeBool(member(control, "DN"), active && position >= length);
  return { active, position, length };
}

/** SQO - Sequencer Output. */
export const SQO: InstructionDefinition = {
  type: "SQO",
  displayName: "Sequencer Output",
  category: "sequencer",
  description: "Moves Array[Control.POS] through Mask into Destination on each sequencer step.",
  operands: [
    { name: "array", label: "Array", required: true, allowedTypes: ["DINT"], direction: "read" },
    { name: "mask", label: "Mask", required: true, allowedTypes: DINTISH, direction: "read" },
    { name: "dest", label: "Destination", required: true, allowedTypes: ["DINT"], direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT"], direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: ["DINT"], direction: "write" },
  ],
  validate: requireOperands(["array", "mask", "dest", "control", "length"]),
  execute: (node, ctx) => {
    const state = advanceSequencer(node, ctx, 3, 4, 5);
    if (state.active) {
      const dest = op(node, 2);
      const mask = boundedDint(ctx.numeric(op(node, 1)));
      const source = boundedDint(ctx.readNumber(elementPath(ctx, op(node, 0), state.position)));
      const current = boundedDint(ctx.readNumber(dest));
      if (dest) ctx.writeNumber(dest, (source & mask) | (current & ~mask));
    }
    return ctx.rungIn;
  },
  render: { symbol: "SQO", style: "box" },
};

function sequencerCompare(type: "SQI" | "SQC", displayName: string): InstructionDefinition {
  return {
    type,
    displayName,
    category: "sequencer",
    description: "Compares Source and Array[Control.POS] through Mask; rung-out is true when masked values match.",
    operands: [
      { name: "array", label: "Array", required: true, allowedTypes: ["DINT"], direction: "read" },
      { name: "mask", label: "Mask", required: true, allowedTypes: DINTISH, direction: "read" },
      { name: "source", label: "Source", required: true, allowedTypes: DINTISH, direction: "read" },
      { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
      { name: "length", label: "Length", required: true, allowedTypes: ["DINT"], direction: "read" },
      { name: "position", label: "Position", required: false, allowedTypes: ["DINT"], direction: "write" },
    ],
    validate: requireOperands(["array", "mask", "source", "control", "length"]),
    execute: (node, ctx) => {
      const state = readComparePosition(node, ctx, 3, 4, 5);
      if (!state.active) return false;
      const mask = boundedDint(ctx.numeric(op(node, 1)));
      const source = boundedDint(ctx.numeric(op(node, 2)));
      const expected = boundedDint(ctx.readNumber(elementPath(ctx, op(node, 0), state.position)));
      return (source & mask) === (expected & mask);
    },
    render: { symbol: type, style: "function" },
  };
}

/** SQI - Sequencer Input. */
export const SQI: InstructionDefinition = sequencerCompare("SQI", "Sequencer Input");

/** SQC - Sequencer Compare. Legacy compare form with SQI-compatible runtime behavior. */
export const SQC: InstructionDefinition = sequencerCompare("SQC", "Sequencer Compare");

/** SQL - Sequencer Load. */
export const SQL: InstructionDefinition = {
  type: "SQL",
  displayName: "Sequencer Load",
  category: "sequencer",
  description: "Loads Source into Array[Control.POS] on each sequencer step.",
  operands: [
    { name: "array", label: "Array", required: true, allowedTypes: ["DINT"], direction: "write" },
    { name: "source", label: "Source", required: true, allowedTypes: DINTISH, direction: "read" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT"], direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: ["DINT"], direction: "write" },
  ],
  validate: requireOperands(["array", "source", "control", "length"]),
  execute: (node, ctx) => {
    const state = advanceSequencer(node, ctx, 2, 3, 4);
    if (state.active) {
      ctx.writeNumber(
        elementPath(ctx, op(node, 0), state.position),
        boundedDint(ctx.numeric(op(node, 1))),
      );
    }
    return ctx.rungIn;
  },
  render: { symbol: "SQL", style: "box" },
};
