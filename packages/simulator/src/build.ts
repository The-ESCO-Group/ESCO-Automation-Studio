import {
  createDefaultRegistry,
  isNumericLiteral,
  type InstructionRegistry,
} from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime, type TagDescriptor } from "./runtime";

/**
 * Tags written by any instruction in the routine — i.e. the routine's outputs.
 * Read from the registry via each operand's `direction`, so this covers OTE,
 * MOV's Dest, a TON's timer, a CTU's counter, etc., with no hardcoded list.
 */
export function collectOutputTags(
  routine: LadderRoutine,
  registry: InstructionRegistry = createDefaultRegistry(),
): Set<string> {
  const outputs = new Set<string>();
  for (const node of routineNodes(routine)) {
    const definition = registry.get(node.instructionType);
    if (!definition) continue;
    definition.operands.forEach((operandDef, index) => {
      if (operandDef.direction !== "write") return;
      const tag = node.operands[index]?.value?.trim();
      if (tag && !isNumericLiteral(tag)) outputs.add(tag);
    });
  }
  return outputs;
}

/** Build a runtime for a given routine and tag set, sharing one registry. */
export function createRuntime(options: {
  routine?: LadderRoutine;
  /** Sibling routines by name, so a JSR in `routine` can resolve subroutines. */
  routines?: Map<string, LadderRoutine>;
  tags: TagDescriptor[];
  registry?: InstructionRegistry;
}): PlcRuntime {
  const registry = options.registry ?? createDefaultRegistry();
  const runtime = new PlcRuntime(registry);
  for (const tag of options.tags) {
    runtime.defineTag(tag);
  }
  if (options.routines) {
    runtime.loadRoutines(options.routines);
  }
  if (options.routine) {
    runtime.loadRoutine(options.routine);
  }
  return runtime;
}
