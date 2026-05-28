import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Offline routine-call instructions. These drive multi-routine execution within
 * a program — strictly local simulation, no controller communication. JSR runs
 * the named subroutine against the same tag memory; RET returns from it early;
 * SBR marks a subroutine's entry (parameter passing is not modelled yet).
 */

/** JSR - Jump to Subroutine. Executes the named routine, then continues. */
export const JSR: InstructionDefinition = {
  type: "JSR",
  displayName: "Jump to Subroutine",
  category: "program-control",
  description: "Executes the referenced routine against the same tags, then continues the rung.",
  operands: [{ name: "routine", label: "Routine", required: true, direction: "read", isRoutineRef: true }],
  validate: (node) => (node.operands[0]?.value ? [] : ["Operand 'routine' is required."]),
  execute: (node, ctx) => {
    if (ctx.rungIn) ctx.callRoutine?.(operandValue(node, 0));
    return ctx.rungIn;
  },
  render: { symbol: "JSR", style: "box" },
};

/** SBR - Subroutine. Marks a routine's entry point; pass-through in simulation. */
export const SBR: InstructionDefinition = {
  type: "SBR",
  displayName: "Subroutine",
  category: "program-control",
  description: "Marks a subroutine's entry point (parameter passing is not modelled).",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => ctx.rungIn,
  render: { symbol: "SBR", style: "box" },
};

/** RET - Return. Returns early from the current routine when the rung is true. */
export const RET: InstructionDefinition = {
  type: "RET",
  displayName: "Return",
  category: "program-control",
  description: "Returns from the current routine when the rung is true.",
  operands: [],
  validate: () => [],
  execute: (_node, ctx) => {
    if (ctx.rungIn) ctx.requestReturn?.();
    return ctx.rungIn;
  },
  render: { symbol: "RET", style: "box" },
};
