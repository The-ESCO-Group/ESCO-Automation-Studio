import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

const NUMERIC = ["DINT", "REAL"];

/** MOV - Move. Copies Source to Dest while the rung is true. */
export const MOV: InstructionDefinition = {
  type: "MOV",
  displayName: "Move",
  category: "move",
  description: "Copies Source into Dest when the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 1);
      if (dest) ctx.writeNumber(dest, ctx.numeric(operandValue(node, 0)));
    }
    return ctx.rungIn;
  },
  render: { symbol: "MOV", style: "box" },
};

function compare(
  type: string,
  displayName: string,
  description: string,
  test: (a: number, b: number) => boolean,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "compare",
    description,
    operands: [
      { name: "sourceA", label: "Source A", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "sourceB", label: "Source B", required: true, allowedTypes: NUMERIC, direction: "read" },
    ],
    validate: requireOperands(["sourceA", "sourceB"]),
    execute: (node, ctx) => {
      if (!ctx.rungIn) return false;
      return test(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1)));
    },
    render: { symbol: type, style: "function" },
  };
}

/** EQU - Equal. Passes when Source A == Source B. */
export const EQU = compare("EQU", "Equal", "Passes when Source A equals Source B.", (a, b) => a === b);

/** GRT - Greater Than. Passes when Source A > Source B. */
export const GRT = compare("GRT", "Greater Than", "Passes when Source A is greater than Source B.", (a, b) => a > b);

/** LES - Less Than. Passes when Source A < Source B. */
export const LES = compare("LES", "Less Than", "Passes when Source A is less than Source B.", (a, b) => a < b);

/** NEQ - Not Equal. Passes when Source A != Source B. */
export const NEQ = compare("NEQ", "Not Equal", "Passes when Source A does not equal Source B.", (a, b) => a !== b);

/** LEQ - Less Than or Equal. */
export const LEQ = compare("LEQ", "Less Than or Equal", "Passes when Source A <= Source B.", (a, b) => a <= b);

/** GEQ - Greater Than or Equal. */
export const GEQ = compare("GEQ", "Greater Than or Equal", "Passes when Source A >= Source B.", (a, b) => a >= b);
