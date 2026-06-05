import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { operandValue } from "./operands";
import { evaluateExpression } from "./expression";

/**
 * Data-movement instructions: COP / CPS (copy a block of elements), FLL (fill a
 * block with one value), and MVM (masked move of a scalar). Array operands are
 * addressed element-wise as `base[index]` against tag memory. COP/CPS/FLL
 * preserve scalar BOOL/number/STRING values through the offline tag image, but
 * do not claim byte-for-byte UDT/structure semantics. Copies are bounded by
 * {@link COPY_LIMIT} so a bad Length can never hang a scan.
 */

const COPY_LIMIT = 100_000;
const SIMPLE_VALUE_PATH =
  /^(?:Program:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?|\.\d+)*$/;

function startIndex(ctx: InstructionRuntimeContext, raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const result = evaluateExpression(trimmed, (path) => ctx.readNumber(path));
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : result.ok ? result.value : ctx.readNumber(trimmed);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Resolve an operand like `Arr`, `Arr[3]`, or `Arr[Index]` to a base + start. */
function elementBase(ctx: InstructionRuntimeContext, operand: string): { base: string; start: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?$/);
  if (!match) return { base: operand.trim(), start: 0 };
  return { base: match[1]!, start: startIndex(ctx, match[2]) };
}

/** Clamp a Length operand to a non-negative, bounded integer. */
function clampLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), COPY_LIMIT);
}

const i32 = (n: number): number => n | 0;
const SCALAR_TYPES = ["BOOL", "DINT", "REAL", "STRING"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

function readScalar(ctx: InstructionRuntimeContext, path: string): boolean | number | string {
  return ctx.readValue ? ctx.readValue(path) : ctx.readNumber(path);
}

function writeScalar(ctx: InstructionRuntimeContext, path: string, value: boolean | number | string): void {
  if (ctx.writeValue) {
    ctx.writeValue(path, value);
    return;
  }
  if (typeof value === "boolean") ctx.writeBool(path, value);
  else if (typeof value === "string") ctx.writeString(path, value);
  else ctx.writeNumber(path, value);
}

function sourceValue(ctx: InstructionRuntimeContext, raw: string): boolean | number | string {
  const trimmed = raw.trim();
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  const singleQuoted = trimmed.match(/^'(.*)'$/s);
  const doubleQuoted = trimmed.match(/^"(.*)"$/s);
  if (singleQuoted) return singleQuoted[1] ?? "";
  if (doubleQuoted) return doubleQuoted[1] ?? "";
  if (SIMPLE_VALUE_PATH.test(trimmed)) return readScalar(ctx, trimmed);
  const literal = evaluateExpression(trimmed, (path) => ctx.readNumber(path));
  if (/^[+\-]?\d+(?:\.\d+)?$/.test(trimmed) || literal.ok) {
    const value = literal.ok ? literal.value : Number(trimmed);
    if (Number.isFinite(value)) return value;
  }
  return readScalar(ctx, trimmed);
}

/** COP / CPS — copy Length elements from Source[] to Dest[] while the rung is true. */
function copyBox(type: string, displayName: string): InstructionDefinition {
  return {
    type,
    displayName,
    category: "move",
    description: `${displayName}: copies Length consecutive scalar elements from Source to Dest (offline value-preserving copy).`,
    operands: [
      { name: "source", label: "Source", required: true, direction: "read" },
      { name: "dest", label: "Dest", required: true, direction: "write" },
      { name: "length", label: "Length", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    ],
    validate: requireOperands(["source", "dest", "length"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const source = elementBase(ctx, operandValue(node, 0));
        const dest = elementBase(ctx, operandValue(node, 1));
        const length = clampLength(ctx.numeric(operandValue(node, 2)));
        for (let i = 0; i < length; i += 1) {
          writeScalar(ctx, `${dest.base}[${dest.start + i}]`, readScalar(ctx, `${source.base}[${source.start + i}]`));
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
    { name: "source", label: "Source", required: true, allowedTypes: SCALAR_TYPES, direction: "read" },
    { name: "dest", label: "Dest", required: true, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
  ],
  validate: requireOperands(["source", "dest", "length"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const value = sourceValue(ctx, operandValue(node, 0));
      const dest = elementBase(ctx, operandValue(node, 1));
      const length = clampLength(ctx.numeric(operandValue(node, 2)));
      for (let i = 0; i < length; i += 1) {
        writeScalar(ctx, `${dest.base}[${dest.start + i}]`, value);
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

/**
 * MVMT - Masked Move with Target. Function-block spelling of MVM where the
 * output operand is named Target. The offline runtime applies the same bounded
 * 32-bit masked write while the rung is true.
 */
export const MVMT: InstructionDefinition = {
  type: "MVMT",
  displayName: "Masked Move with Target",
  category: "move",
  description: "Target = (Target AND NOT Mask) OR (Source AND Mask), 32-bit, while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    { name: "mask", label: "Mask", required: true, allowedTypes: ["DINT", "REAL"], direction: "read" },
    { name: "target", label: "Target", required: true, allowedTypes: ["DINT", "REAL"], direction: "write" },
  ],
  validate: requireOperands(["source", "mask", "target"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const target = operandValue(node, 2);
      if (target) {
        const source = i32(ctx.numeric(operandValue(node, 0)));
        const mask = i32(ctx.numeric(operandValue(node, 1)));
        const current = i32(ctx.readNumber(target));
        ctx.writeNumber(target, (current & ~mask) | (source & mask));
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "MVMT", style: "box" },
};
