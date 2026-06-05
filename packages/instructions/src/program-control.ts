import type { InstructionDefinition } from "./types";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/**
 * Simple program-control utility instructions. Routine-call control (JSR/SBR/RET)
 * lives in routine-control.ts and drives multi-routine execution.
 */

/** NOP - No Operation. Passes the rung condition straight through. */
export const NOP: InstructionDefinition = {
  type: "NOP",
  displayName: "No Operation",
  category: "program-control",
  description: "Does nothing; passes the rung condition through unchanged.",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => ctx.rungIn,
  render: { symbol: "NOP", style: "box" },
};

/** AFI - Always False Instruction. Forces the rung condition false. */
export const AFI: InstructionDefinition = {
  type: "AFI",
  displayName: "Always False",
  category: "program-control",
  description: "Always evaluates false, disabling the rest of the rung (useful for commissioning).",
  operands: [],
  validate: () => [],
  execute: () => false,
  render: { symbol: "AFI", style: "box" },
};

/**
 * IOT - Immediate Output. In a controller this immediately transfers an output
 * module / produced tag image. The offline runtime has no delayed I/O image or
 * controller connection, so the tag is validated/cross-referenced and the rung
 * condition passes through without changing tag memory.
 */
export const IOT: InstructionDefinition = {
  type: "IOT",
  displayName: "Immediate Output",
  category: "program-control",
  description: "Validates an output/produced tag update request; offline scan has no delayed I/O image to flush.",
  operands: [{ name: "updateTag", label: "Update Tag", required: true, direction: "read", isLabelRef: true }],
  validate: requireOperands(["updateTag"]),
  execute: (_node, ctx) => ctx.rungIn,
  render: { symbol: "IOT", style: "box" },
};
