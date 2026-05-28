import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import type { LadderRoutine } from "@esco/ladder";
import { RoutineExecutor } from "./routine-executor";
import type { TraceEntry } from "./rung-executor";
import { TagMemory, type PlcValue } from "./tag-memory";

/** How a tag is driven in the simulation: a toggled input or a logic-written output. */
export type TagRole = "input" | "output" | "internal";

export interface TagDescriptor {
  name: string;
  dataType: string;
  role: TagRole;
  initialValue: PlcValue;
}

/**
 * PLC scan-cycle runtime. A scan applies any forced values, executes the loaded
 * ladder routine against tag memory, then commits the output image.
 *
 * Instruction behaviour lives in the {@link InstructionRegistry}; this runtime
 * only owns the scan cadence, tag memory, and force list.
 */
export class PlcRuntime {
  readonly memory = new TagMemory();
  private readonly executor: RoutineExecutor;
  private routine?: LadderRoutine;
  private descriptors: TagDescriptor[] = [];
  private running = false;
  private forces = new Map<string, PlcValue>();

  constructor(registry: InstructionRegistry = createDefaultRegistry()) {
    this.executor = new RoutineExecutor(registry);
  }

  /** Register a tag (name, type, role) and seed its power-up value in memory. */
  defineTag(descriptor: TagDescriptor): void {
    this.descriptors.push(descriptor);
    this.memory.define(descriptor.name, descriptor.initialValue);
  }

  /** Register an alias so reads/writes of `name` resolve to `base` in memory. */
  defineAlias(name: string, base: string): void {
    this.memory.defineAlias(name, base);
  }

  /** All declared tags, in declaration order (used by the Watch panel). */
  tags(): readonly TagDescriptor[] {
    return this.descriptors;
  }

  /** Load the ladder routine that {@link scanOnce} executes. */
  loadRoutine(routine: LadderRoutine): void {
    this.routine = routine;
  }

  /** Register sibling routines by name so a JSR in the scanned routine resolves. */
  loadRoutines(routines: Map<string, LadderRoutine>): void {
    this.executor.setRoutines(routines);
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Execute exactly one scan: apply forces, run logic, commit outputs.
   * `deltaMs` is the time elapsed since the previous scan (drives timers).
   */
  scanOnce(deltaMs = 0, trace?: TraceEntry[]): void {
    for (const [path, value] of this.forces) {
      this.memory.write(path, value);
    }
    if (this.routine) {
      this.executor.execute(this.routine, this.memory, deltaMs, trace);
    }
    // Forces win: re-apply after logic so a forced tag holds its value.
    for (const [path, value] of this.forces) {
      this.memory.write(path, value);
    }
    this.memory.commitScan();
  }

  /** Clear forces and restore every tag to its power-up value. */
  reset(): void {
    this.forces.clear();
    this.memory.reset();
  }

  readTag(path: string): PlcValue {
    return this.memory.read(path);
  }

  writeTag(path: string, value: PlcValue): void {
    this.memory.write(path, value);
  }

  forceTag(path: string, value: PlcValue): void {
    this.forces.set(path, value);
    this.memory.write(path, value);
  }

  clearForce(path: string): void {
    this.forces.delete(path);
  }
}
