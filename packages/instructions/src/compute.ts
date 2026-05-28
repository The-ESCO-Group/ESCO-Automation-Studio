import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

const NUMERIC = ["DINT", "REAL"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/** Truncate to a 32-bit signed integer for bitwise/masked operations. */
const i32 = (n: number): number => n | 0;

/** Two-source compute box: Dest = A op B while the rung is true. */
function binaryBox(
  type: string,
  displayName: string,
  description: string,
  op: (a: number, b: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "sourceA", label: "Source A", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "sourceB", label: "Source B", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["sourceA", "sourceB", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 2);
        if (dest) ctx.writeNumber(dest, op(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

/** Single-source compute box: Dest = op(Source) while the rung is true. */
function unaryBox(
  type: string,
  displayName: string,
  description: string,
  op: (a: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["source", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 1);
        if (dest) ctx.writeNumber(dest, op(ctx.numeric(operandValue(node, 0))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

// --- Bitwise (operate on 32-bit integers) ---
export const AND = binaryBox("AND", "Bitwise AND", "Dest = Source A AND Source B (bitwise).", (a, b) => i32(a) & i32(b));
export const OR = binaryBox("OR", "Bitwise OR", "Dest = Source A OR Source B (bitwise).", (a, b) => i32(a) | i32(b));
export const XOR = binaryBox("XOR", "Bitwise XOR", "Dest = Source A XOR Source B (bitwise).", (a, b) => i32(a) ^ i32(b));
export const NOT = unaryBox("NOT", "Bitwise NOT", "Dest = NOT Source (bitwise complement).", (a) => ~i32(a));

// --- Extended math ---
export const MOD = binaryBox("MOD", "Modulo", "Dest = Source A modulo Source B (0 when B = 0).", (a, b) => (b === 0 ? 0 : a % b));
export const SQR = unaryBox("SQR", "Square Root", "Dest = square root of Source (0 when negative).", (a) => (a < 0 ? 0 : Math.sqrt(a)));
export const NEG = unaryBox("NEG", "Negate", "Dest = -Source.", (a) => -a);
export const ABS = unaryBox("ABS", "Absolute Value", "Dest = |Source|.", (a) => Math.abs(a));

/** CLR - Clear. Sets Dest to 0 while the rung is true. */
export const CLR: InstructionDefinition = {
  type: "CLR",
  displayName: "Clear",
  category: "math",
  description: "Sets Dest to 0 when the rung is true.",
  operands: [{ name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" }],
  validate: requireOperands(["dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 0);
      if (dest) ctx.writeNumber(dest, 0);
    }
    return ctx.rungIn;
  },
  render: { symbol: "CLR", style: "box" },
};

/**
 * LIM - Limit Test. Passes when Test is within the limits: when Low ≤ High it is
 * the inclusive range [Low, High]; when Low > High it is the circular range
 * (Test ≥ Low OR Test ≤ High), matching Logix behaviour.
 */
export const LIM: InstructionDefinition = {
  type: "LIM",
  displayName: "Limit Test",
  category: "compare",
  description: "Passes when Test is between the Low and High limits.",
  operands: [
    { name: "low", label: "Low Limit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "test", label: "Test", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "high", label: "High Limit", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["low", "test", "high"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const low = ctx.numeric(operandValue(node, 0));
    const test = ctx.numeric(operandValue(node, 1));
    const high = ctx.numeric(operandValue(node, 2));
    return low <= high ? test >= low && test <= high : test >= low || test <= high;
  },
  render: { symbol: "LIM", style: "function" },
};

/** MEQ - Masked Equal. Passes when (Source AND Mask) == (Compare AND Mask). */
export const MEQ: InstructionDefinition = {
  type: "MEQ",
  displayName: "Masked Equal",
  category: "compare",
  description: "Passes when Source equals Compare under the Mask bits.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "mask", label: "Mask", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "compare", label: "Compare", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["source", "mask", "compare"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = i32(ctx.numeric(operandValue(node, 0)));
    const mask = i32(ctx.numeric(operandValue(node, 1)));
    const compare = i32(ctx.numeric(operandValue(node, 2)));
    return (source & mask) === (compare & mask);
  },
  render: { symbol: "MEQ", style: "function" },
};
