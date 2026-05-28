import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Data-movement instructions: COP / CPS (copy a block of elements), FLL (fill a
 * block with one value), and MVM (masked move of a scalar). Array operands are
 * addressed element-wise as `base[index]` against tag memory (a missing element
 * reads as 0), so an offline simulation copies/fills numeric element values
 * deterministically. This is an offline approximation, not byte-for-byte Logix
 * semantics; copies are bounded by {@link COPY_LIMIT} so a bad Length can never
 * hang a scan.
 */

const COPY_LIMIT = 100_000;

/** Resolve an operand like `Arr` or `Arr[3]` to a base name + starting index. */
function elementBase(operand: string): { base: string; start: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/);
  if (!match) return { base: operand.trim(), start: 0 };
  return { base: match[1]!, start: match[2] ? Number(match[2]) : 0 };
}

/** Clamp a Length operand to a non-negative, bounded integer. */
function clampLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), COPY_LIMIT);
}

const i32 = (n: number): number => n | 0;

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/** COP / CPS — copy Length elements from Source[] to Dest[] while the rung is true. */
function copyBox(type: string, displayName: string): InstructionDefinition {
  return {
    type,
    displayName,
    category: "move",
    description: `${displayName}: copies Length consecutive elements from Source to Dest (offline element-wise numeric copy).`,
    operands: [
      { name: "source", label: "Source", required: true, direction: "read" },
      { name: "dest", label: "Dest", required: true, direction: "write" },
      { name: "length", label: "Length", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    ],
    validate: requireOperands(["source", "dest", "length"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const source = elementBase(operandValue(node, 0));
        const dest = elementBase(operandValue(node, 1));
        const length = clampLength(ctx.numeric(operandValue(node, 2)));
        for (let i = 0; i < length; i += 1) {
          ctx.writeNumber(
            `${dest.base}[${dest.start + i}]`,
            ctx.readNumber(`${source.base}[${source.start + i}]`),
          );
        }
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

export const COP = copyBox("COP", "Copy File");
export const CPS = copyBox("CPS", "Synchronous Copy File");

/** FLL — fill Length consecutive Dest elements with the Source value while the rung is true. */
export const FLL: InstructionDefinition = {
  type: "FLL",
  displayName: "Fill File",
  category: "move",
  description: "Fills Length consecutive Dest elements with the Source value while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    { name: "dest", label: "Dest", required: true, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
  ],
  validate: requireOperands(["source", "dest", "length"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const value = ctx.numeric(operandValue(node, 0));
      const dest = elementBase(operandValue(node, 1));
      const length = clampLength(ctx.numeric(operandValue(node, 2)));
      for (let i = 0; i < length; i += 1) {
        ctx.writeNumber(`${dest.base}[${dest.start + i}]`, value);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "FLL", style: "box" },
};

/** MVM — Masked Move: Dest = (Dest AND NOT Mask) OR (Source AND Mask), 32-bit. */
export const MVM: InstructionDefinition = {
  type: "MVM",
  displayName: "Masked Move",
  category: "move",
  description: "Dest = (Dest AND NOT Mask) OR (Source AND Mask), 32-bit, while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    { name: "mask", label: "Mask", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: ["DINT", "REAL"], direction: "write" },
  ],
  validate: requireOperands(["source", "mask", "dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 2);
      if (dest) {
        const source = i32(ctx.numeric(operandValue(node, 0)));
        const mask = i32(ctx.numeric(operandValue(node, 1)));
        const current = i32(ctx.readNumber(dest));
        ctx.writeNumber(dest, (current & ~mask) | (source & mask));
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "MVM", style: "box" },
};
