import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

function requireTag(node: { operands: { value: string }[] }): string[] {
  return node.operands[0]?.value ? [] : ["Operand 'tag' is required."];
}

/** XIC - Examine If Closed. Passes when the BOOL tag is true. */
export const XIC: InstructionDefinition = {
  type: "XIC",
  displayName: "Examine If Closed",
  category: "bit",
  description: "Passes rung condition when the BOOL tag is true.",
  operands: [
    { name: "tag", label: "Tag", required: true, allowedTypes: ["BOOL"], direction: "read" },
  ],
  validate: requireTag,
  execute: (node, ctx) => ctx.rungIn && ctx.readBool(operandValue(node, 0)),
  render: { symbol: "--[ ]--", style: "contact" },
};

/** XIO - Examine If Open. Passes when the BOOL tag is false. */
export const XIO: InstructionDefinition = {
  type: "XIO",
  displayName: "Examine If Open",
  category: "bit",
  description: "Passes rung condition when the BOOL tag is false.",
  operands: [
    { name: "tag", label: "Tag", required: true, allowedTypes: ["BOOL"], direction: "read" },
  ],
  validate: requireTag,
  execute: (node, ctx) => ctx.rungIn && !ctx.readBool(operandValue(node, 0)),
  render: { symbol: "--[/]--", style: "contact" },
};

/** OTE - Output Energize. Writes the rung-in condition to the BOOL tag. */
export const OTE: InstructionDefinition = {
  type: "OTE",
  displayName: "Output Energize",
  category: "bit",
  description: "Sets the BOOL tag to the rung-in condition.",
  operands: [
    { name: "tag", label: "Tag", required: true, allowedTypes: ["BOOL"], direction: "write" },
  ],
  validate: requireTag,
  execute: (node, ctx) => {
    ctx.writeBool(operandValue(node, 0), ctx.rungIn);
    return ctx.rungIn;
  },
  render: { symbol: "--( )--", style: "coil" },
};
