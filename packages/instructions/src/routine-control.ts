import type { InstructionDefinition } from "./types";
import { operandValue, parseNumericLiteral } from "./operands";

export const MAX_ROUTINE_PARAMETERS = 40;

export interface JsrParameterLayout {
  /** True when the JSR operand list contains Studio's explicit input-count field. */
  explicitInputCount: boolean;
  /** Raw JSR operands after the optional input-count field. */
  parameters: string[];
  /** Number of operands copied into the callee's SBR operands. */
  inputCount: number;
  /** JSR operands copied into the callee before the subroutine scan. */
  inputParameters: string[];
  /** JSR operands populated from the callee's RET operands after the scan. */
  returnParameters: string[];
  /** Human-readable syntax problem for validation, if the count is malformed. */
  inputCountError?: string;
}

/** Split JSR operands into Studio-style input and return parameter groups. */
export function parseJsrParameterLayout(
  rawOperands: string[],
  inferredInputCount = 0,
): JsrParameterLayout {
  const raw = rawOperands.map((operand) => operand.trim());
  const first = raw[0] ?? "";
  const parsedCount = first ? parseNumericLiteral(first) : undefined;
  const explicitInputCount = parsedCount !== undefined;
  const parameters = explicitInputCount ? raw.slice(1) : raw;
  let inputCount = explicitInputCount ? Math.trunc(parsedCount) : Math.max(0, inferredInputCount);
  let inputCountError: string | undefined;

  if (explicitInputCount && (!Number.isInteger(parsedCount) || parsedCount < 0 || parsedCount > MAX_ROUTINE_PARAMETERS)) {
    inputCountError = `JSR input count must be an integer from 0 to ${MAX_ROUTINE_PARAMETERS}.`;
    inputCount = Math.max(0, Math.min(MAX_ROUTINE_PARAMETERS, inputCount));
  }

  return {
    explicitInputCount,
    parameters,
    inputCount,
    inputParameters: parameters.slice(0, inputCount),
    returnParameters: parameters.slice(inputCount),
    ...(inputCountError ? { inputCountError } : {}),
  };
}

/**
 * Offline routine-call instructions. These drive multi-routine execution within
 * a program — strictly local simulation, no controller communication. JSR runs
 * the named subroutine against the same tag memory; SBR receives JSR input
 * parameters; RET returns parameter values and ends the subroutine scan early.
 */

/** JSR - Jump to Subroutine. Executes the named routine, then continues. */
export const JSR: InstructionDefinition = {
  type: "JSR",
  displayName: "Jump to Subroutine",
  category: "program-control",
  description: "Executes the referenced routine against the same tags, passing optional SBR/RET parameters.",
  operands: [{ name: "routine", label: "Routine", required: true, direction: "read", isRoutineRef: true }],
  validate: (node) => {
    const messages = node.operands[0]?.value ? [] : ["Operand 'routine' is required."];
    const layout = parseJsrParameterLayout(node.operands.slice(1).map((operand) => operand.value));
    if (layout.inputCountError) messages.push(layout.inputCountError);
    if (layout.parameters.length - layout.inputCount > MAX_ROUTINE_PARAMETERS) {
      messages.push(`JSR return parameter count must be ${MAX_ROUTINE_PARAMETERS} or fewer.`);
    }
    return messages;
  },
  execute: (node, ctx) => {
    if (ctx.rungIn) ctx.callRoutine?.(operandValue(node, 0), node.operands.slice(1).map((operand) => operand.value.trim()));
    return ctx.rungIn;
  },
  render: { symbol: "JSR", style: "box" },
};

/** SBR - Subroutine. Receives JSR input parameters into local tags. */
export const SBR: InstructionDefinition = {
  type: "SBR",
  displayName: "Subroutine",
  category: "program-control",
  description: "Receives input parameters passed by the calling JSR.",
  operands: [],
  validate: (node) =>
    node.operands.length > MAX_ROUTINE_PARAMETERS
      ? [`SBR input parameter count must be ${MAX_ROUTINE_PARAMETERS} or fewer.`]
      : [],
  execute: (_node, ctx) => ctx.rungIn,
  render: { symbol: "SBR", style: "box" },
};

/** RET - Return. Sends return parameters to the calling JSR and exits. */
export const RET: InstructionDefinition = {
  type: "RET",
  displayName: "Return",
  category: "program-control",
  description: "Returns from the current routine and sends optional values back to the calling JSR.",
  operands: [],
  validate: (node) =>
    node.operands.length > MAX_ROUTINE_PARAMETERS
      ? [`RET return parameter count must be ${MAX_ROUTINE_PARAMETERS} or fewer.`]
      : [],
  execute: (node, ctx) => {
    if (ctx.rungIn) ctx.requestReturn?.(node.operands.map((operand) => operand.value.trim()));
    return ctx.rungIn;
  },
  render: { symbol: "RET", style: "box" },
};
