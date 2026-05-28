import type { InstructionRegistry } from "@esco/instructions";
import type { LadderRoutine } from "@esco/ladder";
import { RungExecutor } from "./rung-executor";
import type { TagMemory } from "./tag-memory";

/**
 * Executes every rung of a ladder routine in rung-number order, top to bottom,
 * which is the order Logix scans a ladder routine.
 */
export class RoutineExecutor {
  private readonly rungExecutor: RungExecutor;

  constructor(registry: InstructionRegistry) {
    this.rungExecutor = new RungExecutor(registry);
  }

  execute(routine: LadderRoutine, memory: TagMemory, deltaMs = 0): void {
    const rungs = [...routine.rungs].sort((a, b) => a.number - b.number);
    for (const rung of rungs) {
      this.rungExecutor.execute(rung, memory, deltaMs);
    }
  }
}
