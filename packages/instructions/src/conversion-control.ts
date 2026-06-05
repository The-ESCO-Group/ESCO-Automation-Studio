import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Conversion / bit-field instructions (TOD, FRD, BTD, SWPB) and
 * program-control flow. TND ends the routine scan; JMP requests a bounded
 * routine jump to an LBL target; FOR executes a sibling routine as a bounded
 * loop and BRK exits it; MCR opens/closes a bounded reset zone.
 */

const NUMERIC = ["DINT", "REAL"];
const i32 = (n: number): number => n | 0;
type SwpbMode = "REVERSE" | "WORD" | "HIGHLOW";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/** Encode a non-negative integer as packed BCD (each decimal digit → one nibble). */
function toBcd(value: number): number {
  let n = Math.trunc(Math.abs(value));
  let result = 0;
  let shift = 0;
  while (n > 0 && shift < 32) {
    result |= (n % 10) << shift;
    n = Math.floor(n / 10);
    shift += 4;
  }
  return result | 0;
}

/** Decode packed BCD back to an integer (nibbles read low to high). */
function fromBcd(value: number): number {
  let bcd = Math.trunc(value) >>> 0;
  let result = 0;
  let mult = 1;
  while (bcd > 0) {
    result += (bcd & 0xf) * mult;
    mult *= 10;
    bcd >>>= 4;
  }
  return result | 0;
}

function parseSwpbMode(raw: string): SwpbMode | undefined {
  const mode = raw.trim().toUpperCase().replace(/[\s_/-]/g, "");
  if (mode === "0" || mode === "REVERSE") return "REVERSE";
  if (mode === "1" || mode === "WORD") return "WORD";
  if (mode === "2" || mode === "HIGHLOW") return "HIGHLOW";
  return undefined;
}

function swpbDint(source: number, mode: SwpbMode): number {
  const value = i32(source) >>> 0;
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  const d = value & 0xff;
  const bytes =
    mode === "REVERSE"
      ? [d, c, b, a]
      : mode === "WORD"
        ? [c, d, a, b]
        : [b, a, d, c];
  return (((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) | 0);
}

/** Single-source conversion box: Dest = fn(Source) while the rung is true. */
function convertBox(
  type: string,
  displayName: string,
  description: string,
  fn: (source: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "move",
    description,
    operands: [
      { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["source", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 1);
        if (dest) ctx.writeNumber(dest, fn(ctx.numeric(operandValue(node, 0))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

export const TOD = convertBox("TOD", "Integer to BCD", "Dest = BCD encoding of Source while the rung is true.", toBcd);
export const FRD = convertBox("FRD", "BCD to Integer", "Dest = integer value of the BCD in Source while the rung is true.", fromBcd);

/*
 * Studio-style long-name BCD conversions. TO_BCD is the long name for TOD
 * (integer → packed BCD) and BCD_TO is the long name for FRD (packed BCD →
 * integer); each shares the exact offline encoding/decoding of its RLL box.
 */
export const TO_BCD = convertBox("TO_BCD", "Integer to BCD", "Dest = BCD encoding of Source while the rung is true (alias of TOD).", toBcd);
export const BCD_TO = convertBox("BCD_TO", "BCD to Integer", "Dest = integer value of the BCD in Source while the rung is true (alias of FRD).", fromBcd);

/**
 * BTD - Bit Field Distribute. Copies Length bits from Source starting at
 * SourceBit into Dest starting at DestBit (32-bit, bounded), leaving the other
 * Dest bits unchanged.
 */
export const BTD: InstructionDefinition = {
  type: "BTD",
  displayName: "Bit Field Distribute",
  category: "move",
  description: "Copies Length bits from Source[SourceBit] into Dest[DestBit] (32-bit) while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "sourceBit", label: "Source Bit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "destBit", label: "Dest Bit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["source", "sourceBit", "dest", "destBit", "length"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const destPath = operandValue(node, 2);
    if (!destPath) return true;
    const source = i32(ctx.numeric(operandValue(node, 0)));
    const sourceBit = Math.trunc(ctx.numeric(operandValue(node, 1)));
    const destBit = Math.trunc(ctx.numeric(operandValue(node, 3)));
    const length = Math.trunc(ctx.numeric(operandValue(node, 4)));
    let result = i32(ctx.readNumber(destPath));
    for (let k = 0; k < length; k += 1) {
      const from = sourceBit + k;
      const to = destBit + k;
      if (from < 0 || from > 31 || to < 0 || to > 31) break;
      const bit = (source >>> from) & 1;
      result = bit ? result | (1 << to) : result & ~(1 << to);
    }
    ctx.writeNumber(destPath, result | 0);
    return true;
  },
  render: { symbol: "BTD", style: "box" },
};

/**
 * BTDT - Bit Field Distribute with Target. Function-block spelling whose output
 * operand is Target and whose Length precedes Dest Bit. Copies Length bits from
 * Source[SourceBit] into Target[DestBit] while preserving other Target bits.
 */
export const BTDT: InstructionDefinition = {
  type: "BTDT",
  displayName: "Bit Field Distribute with Target",
  category: "move",
  description: "Copies Length bits from Source[SourceBit] into Target[DestBit] (32-bit) while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "sourceBit", label: "Source Bit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "destBit", label: "Dest Bit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "target", label: "Target", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "sourceBit", "length", "destBit", "target"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const targetPath = operandValue(node, 4);
    if (!targetPath) return true;
    const source = i32(ctx.numeric(operandValue(node, 0)));
    const sourceBit = Math.trunc(ctx.numeric(operandValue(node, 1)));
    const length = Math.trunc(ctx.numeric(operandValue(node, 2)));
    const destBit = Math.trunc(ctx.numeric(operandValue(node, 3)));
    let result = i32(ctx.readNumber(targetPath));
    for (let k = 0; k < length; k += 1) {
      const from = sourceBit + k;
      const to = destBit + k;
      if (from < 0 || from > 31 || to < 0 || to > 31) break;
      const bit = (source >>> from) & 1;
      result = bit ? result | (1 << to) : result & ~(1 << to);
    }
    ctx.writeNumber(targetPath, result | 0);
    return true;
  },
  render: { symbol: "BTDT", style: "box" },
};

/** SWPB - Swap Byte. Rearranges the bytes of a DINT source into Dest. */
export const SWPB: InstructionDefinition = {
  type: "SWPB",
  displayName: "Swap Byte",
  category: "move",
  description: "Rearranges the bytes of Source into Dest using REVERSE, WORD, or HIGHLOW order mode.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "orderMode", label: "Order Mode", required: true, isLabelRef: true },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: (node) => {
    const missing = requireOperands(["source", "orderMode", "dest"])(node);
    const mode = operandValue(node, 1);
    return mode && !parseSwpbMode(mode)
      ? [...missing, "Operand 'orderMode' must be REVERSE, WORD, HIGHLOW, 0, 1, or 2."]
      : missing;
  },
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const mode = parseSwpbMode(operandValue(node, 1));
    const dest = operandValue(node, 2);
    if (mode && dest) ctx.writeNumber(dest, swpbDint(ctx.numeric(operandValue(node, 0)), mode));
    return true;
  },
  render: { symbol: "SWPB", style: "box" },
};

// --- Program control flow ---

/** TND - Temporary End. Ends the current routine's scan when the rung is true. */
export const TND: InstructionDefinition = {
  type: "TND",
  displayName: "Temporary End",
  category: "program-control",
  description: "Ends the current routine's scan when the rung is true (the rest of the routine is skipped this scan).",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => {
    if (ctx.rungIn) ctx.requestReturn?.();
    return ctx.rungIn;
  },
  render: { symbol: "TND", style: "box" },
};

/** JMP - Jump to Label. The routine executor resolves the target LBL. */
export const JMP: InstructionDefinition = {
  type: "JMP",
  displayName: "Jump to Label",
  category: "program-control",
  description: "Requests a bounded offline jump to the named LBL when the rung is true.",
  operands: [{ name: "label", label: "Label", required: true, isLabelRef: true }],
  validate: requireOperands(["label"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const label = operandValue(node, 0).trim();
      if (label) ctx.requestJump?.(label);
    }
    return ctx.rungIn;
  },
  render: { symbol: "JMP", style: "box" },
};

/** LBL - Label. Marks a bounded JMP target and otherwise passes through. */
export const LBL: InstructionDefinition = {
  type: "LBL",
  displayName: "Label",
  category: "program-control",
  description: "Marks a JMP target; passes the rung condition through during simulation.",
  operands: [{ name: "label", label: "Label", required: true, isLabelRef: true }],
  validate: requireOperands(["label"]),
  execute: (_node, ctx) => ctx.rungIn,
  render: { symbol: "LBL", style: "box" },
};

export const MCR: InstructionDefinition = {
  type: "MCR",
  displayName: "Master Control Reset",
  category: "program-control",
  description: "Opens or closes a bounded offline MCR zone. Disabled zone rungs scan with false power.",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => {
    if (ctx.mcrActive?.()) ctx.exitMcr?.();
    else ctx.enterMcr?.(ctx.rungIn);
    return ctx.rungIn;
  },
  render: { symbol: "MCR", style: "box" },
};

export const BRK: InstructionDefinition = {
  type: "BRK",
  displayName: "Break",
  category: "program-control",
  description: "Exits the active bounded FOR loop when the rung is true.",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => {
    if (ctx.rungIn) ctx.requestBreak?.();
    return ctx.rungIn;
  },
  render: { symbol: "BRK", style: "box" },
};

export const FOR: InstructionDefinition = {
  type: "FOR",
  displayName: "For",
  category: "program-control",
  description: "Executes the named routine as a bounded offline FOR loop while the rung is true.",
  operands: [
    { name: "routine", label: "Routine", required: true, isRoutineRef: true },
    { name: "index", label: "Index", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "initial", label: "Initial", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "terminal", label: "Terminal", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "step", label: "Step", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["routine", "index", "initial", "terminal", "step"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const routine = operandValue(node, 0);
    const index = operandValue(node, 1);
    const initial = ctx.numeric(operandValue(node, 2));
    const terminal = ctx.numeric(operandValue(node, 3));
    const step = ctx.numeric(operandValue(node, 4));
    ctx.runFor?.(routine, index, initial, terminal, step);
    return true;
  },
  render: { symbol: "FOR", style: "box" },
};
