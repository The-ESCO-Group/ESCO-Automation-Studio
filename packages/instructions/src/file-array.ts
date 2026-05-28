import type { InstructionDefinition, InstructionOperandDefinition, InstructionRuntimeContext } from "./types";
import { operandValue } from "./operands";

/**
 * File / array instructions. AVE (average), STD (sample standard deviation), and
 * SRT (in-place ascending sort) are executed offline element-wise over `Length`
 * elements addressed as `base[index]` against tag memory (a missing element
 * reads as 0); element counts are bounded so a bad Length can never hang a scan.
 * SIZE and the FIFO/LIFO stack instructions (FFL/FFU/LFL/LFU) are model-only:
 * they parse, render, preserve operands, and pass the rung condition through, but
 * are not simulated (their exact Logix semantics — element-size lookups and
 * Control-structure position tracking — are not modelled here). Offline numeric
 * approximations, not byte-for-byte Logix.
 */

const NUMERIC = ["DINT", "REAL"];
const ELEMENT_LIMIT = 100_000;

/** Resolve an operand like `Arr` or `Arr[3]` to a base name + starting index. */
function elementBase(operand: string): { base: string; start: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/);
  if (!match) return { base: operand.trim(), start: 0 };
  return { base: match[1]!, start: match[2] ? Number(match[2]) : 0 };
}

function clampLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), ELEMENT_LIMIT);
}

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

function readElements(ctx: InstructionRuntimeContext, operand: string, length: number): number[] {
  const { base, start } = elementBase(operand);
  const values: number[] = [];
  for (let i = 0; i < length; i += 1) values.push(ctx.readNumber(`${base}[${start + i}]`));
  return values;
}

/** AVE - File Average. Dest = mean of Length elements of Array while the rung is true. */
export const AVE: InstructionDefinition = {
  type: "AVE",
  displayName: "File Average",
  category: "file",
  description: "Dest = average of Length elements of Array (offline element-wise) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "control", label: "Control", required: true, direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "dest", "control", "length"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const length = clampLength(ctx.numeric(operandValue(node, 3)));
      const dest = operandValue(node, 1);
      if (dest && length > 0) {
        const values = readElements(ctx, operandValue(node, 0), length);
        ctx.writeNumber(dest, values.reduce((sum, v) => sum + v, 0) / length);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "AVE", style: "box" },
};

/** STD - File Standard Deviation (sample, divides by N-1). */
export const STD: InstructionDefinition = {
  type: "STD",
  displayName: "File Standard Deviation",
  category: "file",
  description: "Dest = sample standard deviation of Length elements of Array (offline) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "control", label: "Control", required: true, direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "dest", "control", "length"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const length = clampLength(ctx.numeric(operandValue(node, 3)));
      const dest = operandValue(node, 1);
      if (dest && length > 0) {
        const values = readElements(ctx, operandValue(node, 0), length);
        const mean = values.reduce((sum, v) => sum + v, 0) / length;
        const variance = length > 1
          ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (length - 1)
          : 0;
        ctx.writeNumber(dest, Math.sqrt(variance));
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "STD", style: "box" },
};

/** SRT - File Sort. Sorts Length elements of Array ascending, in place. */
export const SRT: InstructionDefinition = {
  type: "SRT",
  displayName: "File Sort",
  category: "file",
  description: "Sorts Length elements of Array into ascending order (offline, in place) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "control", "length"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const length = clampLength(ctx.numeric(operandValue(node, 2)));
      if (length > 0) {
        const { base, start } = elementBase(operandValue(node, 0));
        const values: number[] = [];
        for (let i = 0; i < length; i += 1) values.push(ctx.readNumber(`${base}[${start + i}]`));
        values.sort((a, b) => a - b);
        for (let i = 0; i < length; i += 1) ctx.writeNumber(`${base}[${start + i}]`, values[i]!);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "SRT", style: "box" },
};

/** A registered-but-not-simulated file/array instruction: passes the rung condition through. */
function modelOnlyFile(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "file",
    description,
    operands,
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

export const SIZE = modelOnlyFile(
  "SIZE",
  "Size In Elements",
  "Size In Elements (model-only): the array dimension size is not computed offline.",
  [
    { name: "source", label: "Source", required: true, direction: "read" },
    { name: "dimension", label: "Dimension", required: false, allowedTypes: NUMERIC, direction: "read" },
    { name: "size", label: "Size", required: false, allowedTypes: NUMERIC, direction: "write" },
  ],
);

export const FFL = modelOnlyFile("FFL", "FIFO Load", "FIFO Load (model-only): preserved/displayed; the queue is not simulated.", [
  { name: "source", label: "Source", required: true, direction: "read" },
  { name: "fifo", label: "FIFO", required: true, direction: "write" },
  { name: "control", label: "Control", required: true, direction: "read" },
  { name: "length", label: "Length", required: false, allowedTypes: NUMERIC, direction: "read" },
]);
export const FFU = modelOnlyFile("FFU", "FIFO Unload", "FIFO Unload (model-only): preserved/displayed; the queue is not simulated.", [
  { name: "fifo", label: "FIFO", required: true, direction: "read" },
  { name: "dest", label: "Dest", required: true, direction: "write" },
  { name: "control", label: "Control", required: true, direction: "read" },
  { name: "length", label: "Length", required: false, allowedTypes: NUMERIC, direction: "read" },
]);
export const LFL = modelOnlyFile("LFL", "LIFO Load", "LIFO Load (model-only): preserved/displayed; the stack is not simulated.", [
  { name: "source", label: "Source", required: true, direction: "read" },
  { name: "lifo", label: "LIFO", required: true, direction: "write" },
  { name: "control", label: "Control", required: true, direction: "read" },
  { name: "length", label: "Length", required: false, allowedTypes: NUMERIC, direction: "read" },
]);
export const LFU = modelOnlyFile("LFU", "LIFO Unload", "LIFO Unload (model-only): preserved/displayed; the stack is not simulated.", [
  { name: "lifo", label: "LIFO", required: true, direction: "read" },
  { name: "dest", label: "Dest", required: true, direction: "write" },
  { name: "control", label: "Control", required: true, direction: "read" },
  { name: "length", label: "Length", required: false, allowedTypes: NUMERIC, direction: "read" },
]);

/** Executable + model-only file/array instructions, for bulk registration. */
export const FILE_ARRAY_INSTRUCTIONS: InstructionDefinition[] = [
  AVE, STD, SRT, SIZE, FFL, FFU, LFL, LFU,
];
