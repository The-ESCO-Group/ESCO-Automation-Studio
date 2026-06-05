import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Boolean logical instructions (BAND, BOR, BXOR, BNOT) — the function-block /
 * structured-text family that operates on BOOL operands and writes a BOOL Dest.
 * Unlike the bitwise AND/OR/XOR/NOT compute boxes (which fold 32-bit integers),
 * these treat every operand as a single Boolean, so they CAN be simulated exactly
 * offline and are registered executable. Each writes Dest only while the rung is
 * true and otherwise leaves Dest untouched, matching the other output boxes.
 */

const BOOLEAN = ["BOOL"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/** Two-input Boolean box: Dest = In1 op In2 while the rung is true. */
function binaryBooleanBox(
  type: string,
  displayName: string,
  description: string,
  op: (a: boolean, b: boolean) => boolean,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "bit",
    description,
    operands: [
      { name: "in1", label: "Source A", required: true, allowedTypes: BOOLEAN, direction: "read" },
      { name: "in2", label: "Source B", required: true, allowedTypes: BOOLEAN, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: BOOLEAN, direction: "write" },
    ],
    validate: requireOperands(["in1", "in2", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 2);
        if (dest) ctx.writeBool(dest, op(ctx.readBool(operandValue(node, 0)), ctx.readBool(operandValue(node, 1))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

/** BAND - Boolean AND. Dest = Source A AND Source B (Boolean). */
export const BAND = binaryBooleanBox("BAND", "Boolean AND", "Dest = Source A AND Source B (Boolean) while the rung is true.", (a, b) => a && b);

/** BOR - Boolean OR. Dest = Source A OR Source B (Boolean). */
export const BOR = binaryBooleanBox("BOR", "Boolean OR", "Dest = Source A OR Source B (Boolean) while the rung is true.", (a, b) => a || b);

/** BXOR - Boolean Exclusive OR. Dest = Source A XOR Source B (Boolean). */
export const BXOR = binaryBooleanBox("BXOR", "Boolean Exclusive OR", "Dest = Source A XOR Source B (Boolean) while the rung is true.", (a, b) => a !== b);

/** BNOT - Boolean NOT. Dest = NOT Source (Boolean complement). */
export const BNOT: InstructionDefinition = {
  type: "BNOT",
  displayName: "Boolean NOT",
  category: "bit",
  description: "Dest = NOT Source (Boolean complement) while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: BOOLEAN, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: BOOLEAN, direction: "write" },
  ],
  validate: requireOperands(["source", "dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 1);
      if (dest) ctx.writeBool(dest, !ctx.readBool(operandValue(node, 0)));
    }
    return ctx.rungIn;
  },
  render: { symbol: "BNOT", style: "box" },
};

/** Every Boolean-logic instruction, for bulk registration. */
export const BOOLEAN_LOGIC_INSTRUCTIONS: InstructionDefinition[] = [BAND, BOR, BXOR, BNOT];
