import type { InstructionRegistry } from "./registry";

/**
 * Infer the data type a freshly-created tag should have for a given instruction
 * operand, so "Create Tag" from a missing operand can prefill the right type.
 *
 * This is registry-driven rather than hardcoded: an operand definition that
 * accepts exactly one data type pins the inference. That covers the cases the
 * editor cares about — XIC/XIO/OTE/OTL/OTU operands accept only BOOL, TON/TOF/RTO
 * timers accept only TIMER, and CTU/CTD counters accept only COUNTER — while
 * operands that accept several types (or none) return `undefined` so the user
 * chooses. Unknown instructions also return `undefined`.
 */
export function inferOperandTagType(
  instructionType: string,
  operandIndex: number,
  registry: InstructionRegistry,
): string | undefined {
  const definition = registry.get(instructionType.toUpperCase());
  const allowed = definition?.operands[operandIndex]?.allowedTypes;
  if (allowed && allowed.length === 1) return allowed[0];
  return undefined;
}
