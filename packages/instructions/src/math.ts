import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

const NUMERIC = ["DINT", "REAL"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/**
 * A two-source math box: Dest = Source A <op> Source B while the rung is true.
 * Operands: sourceA (read), sourceB (read), dest (write).
 */
function mathBox(
  type: string,
  displayName: string,
  symbol: string,
  op: (a: number, b: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description: `Dest = Source A ${symbol} Source B when the rung is true.`,
    operands: [
      { name: "sourceA", label: "Source A", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "sourceB", label: "Source B", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["sourceA", "sourceB", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 2);
        if (dest) {
          ctx.writeNumber(dest, op(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1))));
        }
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

export const ADD = mathBox("ADD", "Add", "+", (a, b) => a + b);
export const SUB = mathBox("SUB", "Subtract", "-", (a, b) => a - b);
export const MUL = mathBox("MUL", "Multiply", "*", (a, b) => a * b);
/** DIV - Divide. Division by zero yields 0 (safe, no crash). */
export const DIV = mathBox("DIV", "Divide", "/", (a, b) => (b === 0 ? 0 : a / b));
