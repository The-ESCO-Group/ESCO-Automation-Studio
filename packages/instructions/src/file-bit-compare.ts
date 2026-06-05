import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { operandValue } from "./operands";

/**
 * File bit-comparison instructions.
 *
 * FBC (File Bit Comparator) compares the Source and Reference arrays bit by bit
 * and records the bit number of every mismatch into the Result array. DDT
 * (Diagnostic Detect) does the same and then copies each mismatching Source bit
 * into Reference, so a repeated scan reports no further differences until the
 * source changes again.
 *
 * Both maintain two CONTROL structures: Cmp Control (.LEN = number of bits to
 * compare, .POS, .DN, .FD = found-a-mismatch, .ER) and Result Control (.LEN =
 * size of the Result array / maximum mismatches to record, .POS = number
 * recorded, .DN = result array full). This is a bounded offline approximation —
 * the full bit length is compared in a single scan rather than modelling the
 * controller's per-scan resumption — and it never touches a controller. Arrays
 * are addressed as DINT words (bit b lives in word b>>5, position b&31).
 */

const DINT_ARRAY = ["DINT"];
const CONTROL = ["CONTROL"];
const BIT_LIMIT = 1_000_000;

type OperandNode = { operands: { value: string }[] };

function op(node: OperandNode, index: number): string {
  return operandValue(node as Parameters<typeof operandValue>[0], index);
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

/** Resolve `Arr`, `Arr[3]`, or `Program:Main.Arr[3]` to the element path for word `start + index`. */
function elementPath(operand: string, index: number): string {
  const trimmed = operand.trim();
  if (!trimmed) return operand;
  const match = trimmed.match(/^(.+?)(?:\[(\d+)])?$/);
  if (!match) return operand;
  const base = match[1]!;
  if (base.includes("[")) return operand;
  const start = match[2] ? Number(match[2]) : 0;
  return `${base}[${start + index}]`;
}

function i32(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) | 0 : 0;
}

function clampCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.trunc(value), BIT_LIMIT);
}

function bitAt(ctx: InstructionRuntimeContext, operand: string, bit: number): number {
  const word = i32(ctx.readNumber(elementPath(operand, bit >>> 5)));
  return (word >>> (bit & 31)) & 1;
}

function setBit(ctx: InstructionRuntimeContext, operand: string, bit: number, value: number): void {
  const path = elementPath(operand, bit >>> 5);
  const word = i32(ctx.readNumber(path));
  const mask = 1 << (bit & 31);
  ctx.writeNumber(path, (value ? word | mask : word & ~mask) | 0);
}

/**
 * Shared FBC/DDT execution. `diagnostic` is true for DDT, which writes each
 * mismatching Source bit back into Reference after recording it.
 */
function compareFiles(
  node: OperandNode,
  ctx: InstructionRuntimeContext,
  diagnostic: boolean,
): boolean {
  const cmp = op(node, 3);
  const resultControl = op(node, 4);
  if (!ctx.rungIn) {
    if (cmp) ctx.writeBool(member(cmp, "EN"), false);
    return false;
  }

  const source = op(node, 0);
  const reference = op(node, 1);
  const result = op(node, 2);
  const length = clampCount(ctx.readNumber(member(cmp, "LEN")));
  const resultMax = clampCount(ctx.readNumber(member(resultControl, "LEN")));

  if (cmp) ctx.writeBool(member(cmp, "EN"), true);

  if (length <= 0) {
    if (cmp) {
      ctx.writeBool(member(cmp, "ER"), true);
      ctx.writeBool(member(cmp, "DN"), false);
      ctx.writeBool(member(cmp, "FD"), false);
    }
    return false;
  }

  let recorded = 0;
  let found = false;
  for (let bit = 0; bit < length; bit += 1) {
    const sourceBit = bitAt(ctx, source, bit);
    if (sourceBit === bitAt(ctx, reference, bit)) continue;
    found = true;
    if (recorded < resultMax) {
      if (result) ctx.writeNumber(elementPath(result, recorded), bit);
      recorded += 1;
    }
    if (diagnostic && reference) setBit(ctx, reference, bit, sourceBit);
  }

  if (cmp) {
    ctx.writeNumber(member(cmp, "POS"), length);
    ctx.writeBool(member(cmp, "DN"), true);
    ctx.writeBool(member(cmp, "FD"), found);
    ctx.writeBool(member(cmp, "ER"), false);
  }
  if (resultControl) {
    ctx.writeNumber(member(resultControl, "POS"), recorded);
    ctx.writeBool(member(resultControl, "DN"), recorded >= resultMax);
  }
  return true;
}

const OPERANDS: InstructionDefinition["operands"] = [
  { name: "source", label: "Source", required: true, allowedTypes: DINT_ARRAY, direction: "read" },
  { name: "reference", label: "Reference", required: true, allowedTypes: DINT_ARRAY, direction: "write" },
  { name: "result", label: "Result", required: true, allowedTypes: DINT_ARRAY, direction: "write" },
  { name: "cmpControl", label: "Cmp Control", required: true, allowedTypes: CONTROL, direction: "write" },
  { name: "resultControl", label: "Result Control", required: true, allowedTypes: CONTROL, direction: "write" },
];

const REQUIRED = ["source", "reference", "result", "cmpControl", "resultControl"];

/** FBC - File Bit Comparator. */
export const FBC: InstructionDefinition = {
  type: "FBC",
  displayName: "File Bit Comparator",
  category: "file",
  description:
    "Compares Cmp Control.LEN bits of Source against Reference and records each mismatching bit number into Result (bounded offline approximation).",
  operands: OPERANDS,
  validate: requireOperands(REQUIRED),
  execute: (node, ctx) => compareFiles(node, ctx, false),
  render: { symbol: "FBC", style: "box" },
};

/** DDT - Diagnostic Detect. */
export const DDT: InstructionDefinition = {
  type: "DDT",
  displayName: "Diagnostic Detect",
  category: "file",
  description:
    "Like FBC, but copies each mismatching Source bit back into Reference after recording it (bounded offline approximation).",
  operands: OPERANDS,
  validate: requireOperands(REQUIRED),
  execute: (node, ctx) => compareFiles(node, ctx, true),
  render: { symbol: "DDT", style: "box" },
};

/** File bit-comparison instructions, for bulk registration. */
export const FILE_BIT_COMPARE_INSTRUCTIONS: InstructionDefinition[] = [FBC, DDT];
