import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { parseNumericLiteral } from "./operands";
import { evaluateExpression } from "./expression";

/**
 * Studio 5000 bit shift instructions.
 *
 * BSL and BSR are transitional ladder instructions: the array changes only on
 * a false-to-true enable edge. This offline runtime models the deterministic
 * DINT-array bit movement and CONTROL status bits; it sets .ER for invalid
 * lengths but does not raise controller major faults for out-of-range arrays.
 */

const CONTROL = ["CONTROL"];
const DINT_ARRAY = ["DINT"];
const SHIFT_LIMIT = 100_000;

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

function member(control: string, name: string): string {
  return `${control}.${name}`;
}

function boundedDint(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value) | 0;
}

function shiftLength(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.trunc(value), SHIFT_LIMIT);
}

function startIndex(ctx: InstructionRuntimeContext, raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const result = evaluateExpression(trimmed, (path) => ctx.readNumber(path));
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : result.ok ? result.value : ctx.readNumber(trimmed);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function arrayBase(ctx: InstructionRuntimeContext, operand: string): { base: string; startElement: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?$/);
  if (!match) return { base: operand.trim(), startElement: 0 };
  return { base: match[1]!, startElement: startIndex(ctx, match[2]) };
}

function elementPath(base: string, element: number): string {
  return `${base}[${element}]`;
}

function bitAddress(ctx: InstructionRuntimeContext, arrayOperand: string, bitIndex: number): { path: string; bit: number } {
  const { base, startElement } = arrayBase(ctx, arrayOperand);
  const absoluteBit = startElement * 32 + bitIndex;
  const element = Math.floor(absoluteBit / 32);
  const bit = absoluteBit % 32;
  return { path: elementPath(base, element), bit };
}

function readArrayBit(ctx: InstructionRuntimeContext, arrayOperand: string, bitIndex: number): boolean {
  const { path, bit } = bitAddress(ctx, arrayOperand, bitIndex);
  return ((boundedDint(ctx.readNumber(path)) >>> bit) & 1) === 1;
}

function writeArrayBit(
  ctx: InstructionRuntimeContext,
  arrayOperand: string,
  bitIndex: number,
  value: boolean,
): void {
  const { path, bit } = bitAddress(ctx, arrayOperand, bitIndex);
  const mask = 1 << bit;
  const current = boundedDint(ctx.readNumber(path));
  ctx.writeNumber(path, value ? (current | mask) | 0 : (current & ~mask) | 0);
}

function readSourceBit(ctx: InstructionRuntimeContext, operand: string): boolean {
  const literal = parseNumericLiteral(operand);
  if (literal !== undefined) return literal !== 0;

  const arrayBit = operand.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?)\.(\d+)$/);
  if (arrayBit) {
    const bit = Number(arrayBit[2]);
    if (Number.isInteger(bit) && bit >= 0 && bit < 32) {
      return ((boundedDint(ctx.readNumber(arrayBit[1]!)) >>> bit) & 1) === 1;
    }
  }

  return ctx.readBool(operand);
}

function resetControl(ctx: InstructionRuntimeContext, control: string): void {
  if (!control) return;
  ctx.writeBool(member(control, "EN"), false);
  ctx.writeBool(member(control, "DN"), false);
  ctx.writeBool(member(control, "ER"), false);
  ctx.writeNumber(member(control, "POS"), 0);
}

function executeShift(
  node: OperandNode,
  ctx: InstructionRuntimeContext,
  direction: "left" | "right",
): boolean {
  const array = op(node, 0);
  const control = op(node, 1);
  const source = op(node, 2);
  const length = shiftLength(ctx.numeric(op(node, 3)));

  if (!ctx.rungIn) {
    resetControl(ctx, control);
    return false;
  }

  if (!control) return ctx.rungIn;

  const wasEnabled = ctx.readBool(member(control, "EN"));
  ctx.writeBool(member(control, "EN"), true);
  ctx.writeNumber(member(control, "LEN"), length);
  ctx.writeNumber(member(control, "POS"), 0);

  if (length < 0) {
    ctx.writeBool(member(control, "ER"), true);
    ctx.writeBool(member(control, "DN"), false);
    return ctx.rungIn;
  }

  if (wasEnabled || length <= 0) {
    ctx.writeBool(member(control, "ER"), false);
    ctx.writeBool(member(control, "DN"), false);
    return ctx.rungIn;
  }

  if (direction === "left") {
    const unloaded = readArrayBit(ctx, array, length - 1);
    for (let index = length - 1; index > 0; index -= 1) {
      writeArrayBit(ctx, array, index, readArrayBit(ctx, array, index - 1));
    }
    writeArrayBit(ctx, array, 0, readSourceBit(ctx, source));
    ctx.writeBool(member(control, "UL"), unloaded);
  } else {
    const unloaded = readArrayBit(ctx, array, 0);
    for (let index = 0; index < length - 1; index += 1) {
      writeArrayBit(ctx, array, index, readArrayBit(ctx, array, index + 1));
    }
    writeArrayBit(ctx, array, length - 1, readSourceBit(ctx, source));
    ctx.writeBool(member(control, "UL"), unloaded);
  }

  ctx.writeBool(member(control, "ER"), false);
  ctx.writeBool(member(control, "DN"), true);
  return ctx.rungIn;
}

export const BSL: InstructionDefinition = {
  type: "BSL",
  displayName: "Bit Shift Left",
  category: "shift",
  description: "Shifts a DINT array bit range left on an enable edge, loading Source Bit into bit 0 and storing the shifted-out bit in Control.UL.",
  operands: [
    { name: "array", label: "Array", required: true, allowedTypes: DINT_ARRAY, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "source", label: "Source Bit", required: true, allowedTypes: ["BOOL"], direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT"], direction: "read" },
  ],
  validate: requireOperands(["array", "control", "source", "length"]),
  execute: (node, ctx) => executeShift(node, ctx, "left"),
  render: { symbol: "BSL", style: "box" },
};

export const BSR: InstructionDefinition = {
  type: "BSR",
  displayName: "Bit Shift Right",
  category: "shift",
  description: "Shifts a DINT array bit range right on an enable edge, loading Source Bit into the highest selected bit and storing bit 0 in Control.UL.",
  operands: [
    { name: "array", label: "Array", required: true, allowedTypes: DINT_ARRAY, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "source", label: "Source Bit", required: true, allowedTypes: ["BOOL"], direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT"], direction: "read" },
  ],
  validate: requireOperands(["array", "control", "source", "length"]),
  execute: (node, ctx) => executeShift(node, ctx, "right"),
  render: { symbol: "BSR", style: "box" },
};
