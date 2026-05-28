import type { InstructionRegistry } from "@esco/instructions";
import type { LadderRoutine } from "@esco/ladder";
import { RungExecutor, type ExecControl } from "./rung-executor";
import type { TagMemory } from "./tag-memory";

/** Maximum JSR call depth — guards against infinite/recursive routine calls. */
const MAX_CALL_DEPTH = 32;

/**
 * Executes a ladder routine in rung-number order (top to bottom), the order
 * Logix scans a routine. Sibling routines (by name) can be registered so a JSR
 * runs them against the same tag memory; a call-depth limit prevents runaway
 * recursion, and RET ends the current routine's scan early.
 */
export class RoutineExecutor {
  private readonly rungExecutor: RungExecutor;
  private routines = new Map<string, LadderRoutine>();
  private depth = 0;

  constructor(registry: InstructionRegistry) {
    this.rungExecutor = new RungExecutor(registry);
  }

  /** Register the program's routines by name so JSR can resolve subroutines. */
  setRoutines(routines: Map<string, LadderRoutine>): void {
    this.routines = routines;
  }

  execute(routine: LadderRoutine, memory: TagMemory, deltaMs = 0): void {
    this.depth = 0;
    this.runRoutine(routine, memory, deltaMs);
  }

  /** Run a named sibling routine (JSR), respecting the call-depth limit. */
  private callRoutine(name: string, memory: TagMemory, deltaMs: number): void {
    const target = this.routines.get(name);
    if (!target || this.depth >= MAX_CALL_DEPTH) return; // unknown routine / too deep → no-op
    this.depth += 1;
    try {
      this.runRoutine(target, memory, deltaMs);
    } finally {
      this.depth -= 1;
    }
  }

  private runRoutine(routine: LadderRoutine, memory: TagMemory, deltaMs: number): void {
    const control: ExecControl = {
      callRoutine: (name) => this.callRoutine(name, memory, deltaMs),
      returned: false,
    };
    const rungs = [...routine.rungs].sort((a, b) => a.number - b.number);
    for (const rung of rungs) {
      this.rungExecutor.execute(rung, memory, deltaMs, control);
      if (control.returned) break; // RET ends this routine's scan
    }
  }
}
