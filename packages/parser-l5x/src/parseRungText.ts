import type { InstructionRegistry } from "@esco/instructions";
import { createBranch, createNode, tagOperand, type LadderBranch } from "@esco/ladder";

export interface ParsedRungText {
  /** The rung as a semantic ladder branch (a flat series of instructions). */
  root: LadderBranch;
  /** Instruction types found that aren't in the registry. */
  unsupportedTypes: string[];
  /** True if the source contained branch markers (imported as a flat series). */
  hasBranches: boolean;
}

/** Split an operand list on top-level commas (operands may contain `[ ]` / `( )`). */
function splitOperands(text: string): string[] {
  const operands: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      if (current.trim()) operands.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) operands.push(current.trim());
  return operands;
}

/**
 * Parse Logix neutral rung text (e.g. `XIC(StartPB)XIO(StopPB)OTE(MotorRun);`)
 * into a flat series of ladder nodes. Each `NAME(args)` becomes a node; operands
 * map positionally to the instruction's operand names from the registry.
 *
 * Branch markers (`[ ]`) are not modelled in the MVP — instructions are imported
 * as a series and a flag is returned so the caller can warn.
 */
export function parseRungText(text: string, registry: InstructionRegistry): ParsedRungText {
  const nodes = [];
  const unsupported = new Set<string>();
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const type = match[1].toUpperCase();
    const args = splitOperands(match[2]);
    const definition = registry.get(type);
    if (!definition) unsupported.add(type);

    const operandNames = definition
      ? definition.operands.map((operand) => operand.name)
      : args.map((_, i) => `op${i}`);

    const operands = args.map((value, i) => tagOperand(operandNames[i] ?? `op${i}`, value));
    nodes.push(createNode(type, operands));
  }

  return {
    root: createBranch(nodes),
    unsupportedTypes: [...unsupported],
    hasBranches: text.includes("["),
  };
}
