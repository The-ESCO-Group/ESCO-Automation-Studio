import type { InstructionDefinition } from "./types";

/**
 * Simple program-control utility instructions. JSR/RET (routine calls) are
 * intentionally not modelled yet — the offline simulator scans a single
 * routine, so an unmodelled JSR is left as an unsupported pass-through rather
 * than implying cross-routine execution that isn't really happening.
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
