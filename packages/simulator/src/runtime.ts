import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import type { LadderRoutine } from "@esco/ladder";
import { RoutineExecutor } from "./routine-executor";
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

  /** All declared tags, in declaration order (used by the Watch panel). */
  tags(): readonly TagDescriptor[] {
    return this.descriptors;
  }

  /** Load the ladder routine that {@link scanOnce} executes. */
  loadRoutine(routine: LadderRoutine): void {
    this.routine = routine;
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

  /** Execute exactly one scan: apply forces, run logic, commit outputs. */
  scanOnce(): void {
    for (const [path, value] of this.forces) {
      this.memory.write(path, value);
    }
    if (this.routine) {
      this.executor.execute(this.routine, this.memory);
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
