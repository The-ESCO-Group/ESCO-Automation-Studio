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

/** OTL - Output Latch. Sets the BOOL tag true when the rung is true; never clears it. */
export const OTL: InstructionDefinition = {
  type: "OTL",
  displayName: "Output Latch",
  category: "bit",
  description: "Latches the BOOL tag true while the rung is true (retentive).",
  operands: [
    { name: "tag", label: "Tag", required: true, allowedTypes: ["BOOL"], direction: "write" },
  ],
  validate: requireTag,
  execute: (node, ctx) => {
    if (ctx.rungIn) ctx.writeBool(operandValue(node, 0), true);
    return ctx.rungIn;
  },
  render: { symbol: "--(L)--", style: "coil" },
};

/**
 * ONS - One Shot. Operand: a BOOL storage bit.
 * Passes for exactly one scan on a false→true transition of the rung condition.
 * The storage bit records the rung condition seen on the previous scan, so the
 * rising edge is detected deterministically across scanOnce calls and survives
 * export/import (the state lives in the project's tag memory, not a hidden map).
 */
export const ONS: InstructionDefinition = {
  type: "ONS",
  displayName: "One Shot",
  category: "bit",
  description: "Passes for one scan on a false→true edge of the rung; stores the prior rung state in its bit.",
  operands: [
    { name: "storage", label: "Storage Bit", required: true, allowedTypes: ["BOOL"], direction: "write" },
  ],
  validate: (node) => (node.operands[0]?.value ? [] : ["Operand 'storage' is required."]),
  execute: (node, ctx) => {
    const storage = operandValue(node, 0);
    const previous = ctx.readBool(storage);
    ctx.writeBool(storage, ctx.rungIn);
    return ctx.rungIn && !previous;
  },
  render: { symbol: "ONS", style: "box" },
};

/** OTU - Output Unlatch. Clears the BOOL tag when the rung is true; never sets it. */
export const OTU: InstructionDefinition = {
  type: "OTU",
  displayName: "Output Unlatch",
  category: "bit",
  description: "Unlatches the BOOL tag (sets false) while the rung is true.",
  operands: [
    { name: "tag", label: "Tag", required: true, allowedTypes: ["BOOL"], direction: "write" },
  ],
  validate: requireTag,
  execute: (node, ctx) => {
    if (ctx.rungIn) ctx.writeBool(operandValue(node, 0), false);
    return ctx.rungIn;
  },
  render: { symbol: "--(U)--", style: "coil" },
};
