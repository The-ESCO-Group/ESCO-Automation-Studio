import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime, type TagDescriptor } from "./runtime";

/**
 * Tags written by a coil-style instruction anywhere in the routine — i.e. the
 * routine's outputs. Coil-vs-contact is read from the instruction registry, so
 * no instruction knowledge is hardcoded here.
 */
export function collectOutputTags(
  routine: LadderRoutine,
  registry: InstructionRegistry = createDefaultRegistry(),
): Set<string> {
  const outputs = new Set<string>();
  for (const node of routineNodes(routine)) {
    const definition = registry.get(node.instructionType);
    if (definition?.render.style === "coil") {
      const tag = node.operands[0]?.value;
      if (tag) outputs.add(tag);
    }
  }
  return outputs;
}

/** Build a runtime for a given routine and tag set, sharing one registry. */
export function createRuntime(options: {
  routine?: LadderRoutine;
  tags: TagDescriptor[];
  registry?: InstructionRegistry;
}): PlcRuntime {
  const registry = options.registry ?? createDefaultRegistry();
  const runtime = new PlcRuntime(registry);
  for (const tag of options.tags) {
    runtime.defineTag(tag);
  }
  if (options.routine) {
    runtime.loadRoutine(options.routine);
  }
  return runtime;
}
