import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Conversion / bit-field instructions (TOD, FRD, BTD execute; SWPB is
 * model-only) and program-control flow (TND ends the routine scan; JMP, LBL,
 * FOR, BRK, MCR are registered model-only so real imports parse, render, and
 * validate without crashing). Flow that would require jumping or looping over
 * rungs is intentionally NOT simulated — those instructions pass the rung
 * condition through so a scan can never hang.
 */

const NUMERIC = ["DINT", "REAL"];
const i32 = (n: number): number => n | 0;

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
 * SWPB - Swap Byte. Registered model-only: preserved, rendered, and validated
 * (Source required), but byte reordering is not simulated because the order-mode
 * operand position varies by export. Declares only Source so a model-only SWPB
 * never raises a false undefined-tag for its mode keyword or destination.
 */
export const SWPB: InstructionDefinition = {
  type: "SWPB",
  displayName: "Swap Byte",
  category: "move",
  description: "Swap Byte (model-only): preserved and displayed; byte reordering is not simulated offline.",
  operands: [{ name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" }],
  validate: requireOperands(["source"]),
  execute: (_node, ctx) => ctx.rungIn,
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

/** A registered-but-not-simulated flow instruction: passes the rung condition through. */
function modelOnlyFlow(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionDefinition["operands"] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "program-control",
    description,
    operands,
    validate: requireOperands(operands.filter((o) => o.required).map((o) => o.name)),
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

export const JMP = modelOnlyFlow(
  "JMP",
  "Jump to Label",
  "Jump to Label (model-only): the jump is not simulated, so rungs are not skipped offline.",
  [{ name: "label", label: "Label", required: true, isLabelRef: true }],
);

export const LBL = modelOnlyFlow(
  "LBL",
  "Label",
  "Label (model-only): marks a jump target; pass-through in simulation.",
  [{ name: "label", label: "Label", required: true, isLabelRef: true }],
);

export const MCR = modelOnlyFlow(
  "MCR",
  "Master Control Reset",
  "Master Control Reset (model-only): zone control is not simulated; pass-through.",
);

export const BRK = modelOnlyFlow(
  "BRK",
  "Break",
  "Break (model-only): FOR-loop break is not simulated; pass-through.",
);

export const FOR = modelOnlyFlow(
  "FOR",
  "For",
  "For (model-only): the loop is not executed offline (guards against runaway loops); pass-through.",
  [
    { name: "routine", label: "Routine", required: true, isRoutineRef: true },
    { name: "index", label: "Index", required: false, allowedTypes: NUMERIC, direction: "write" },
    { name: "initial", label: "Initial", required: false, allowedTypes: NUMERIC, direction: "read" },
    { name: "terminal", label: "Terminal", required: false, allowedTypes: NUMERIC, direction: "read" },
    { name: "step", label: "Step", required: false, allowedTypes: NUMERIC, direction: "read" },
  ],
);
