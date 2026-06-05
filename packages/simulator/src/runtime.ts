import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import type { AddOnInstruction } from "@esco/core";
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
  /** First-dimension length for backward-compatible single-dimension array tags. */
  dimension?: number;
  /** Full Logix array dimensions, e.g. DINT[4,8] -> [4, 8]. */
  dimensions?: number[];
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
  private arrayDimensions = new Map<string, number[]>();
  private running = false;
  private forces = new Map<string, PlcValue>();

  constructor(registry: InstructionRegistry = createDefaultRegistry()) {
    this.executor = new RoutineExecutor(registry);
  }

  /** Register a tag (name, type, role) and seed its power-up value in memory. */
  defineTag(descriptor: TagDescriptor): void {
    this.descriptors.push(descriptor);
    const dimensions = descriptor.dimensions?.length
      ? descriptor.dimensions
      : descriptor.dimension && descriptor.dimension > 0
        ? [descriptor.dimension]
        : [];
    if (dimensions.length > 0) {
      this.arrayDimensions.set(descriptor.name, dimensions.map((dimension) => Math.floor(dimension)));
    }
    this.memory.define(descriptor.name, descriptor.initialValue);
  }

  /** Register an alias so reads/writes of `name` resolve to `base` in memory. */
  defineAlias(name: string, base: string): void {
    this.memory.defineAlias(name, base);
    const baseDimensions = this.arrayDimensions.get(base);
    if (baseDimensions) this.arrayDimensions.set(name, baseDimensions);
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

  /** Register project-defined AOIs so their imported RLL routines can execute offline. */
  loadAddOnInstructions(aois: AddOnInstruction[]): void {
    this.executor.setAddOnInstructions(aois);
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
      this.executor.execute(this.routine, this.memory, deltaMs, trace, (source, dimension) =>
        this.arrayDimension(source, dimension),
      );
    }
    // Forces win: re-apply after logic so a forced tag holds its value.
    for (const [path, value] of this.forces) {
      this.memory.write(path, value);
    }
    this.memory.commitScan();
  }

  /** Execute a registered sibling routine as a subroutine against the current memory image. */
  callRoutine(name: string, parameters: string[] = [], deltaMs = 0, trace?: TraceEntry[]): void {
    this.executor.callRoutine(name, this.memory, deltaMs, parameters, trace, (source, dimension) =>
      this.arrayDimension(source, dimension),
    );
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

  arrayDimension(source: string, dimension: number): number | undefined {
    const base = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    if (!base) return undefined;
    const dimensions = this.arrayDimensions.get(base);
    if (!dimensions) return undefined;
    const index = Math.trunc(dimension);
    if (!Number.isFinite(index) || index < 0) return 0;
    return dimensions[index] ?? 0;
  }
}
