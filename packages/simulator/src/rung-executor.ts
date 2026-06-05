import {
  parseNumericLiteral,
  type InstructionRegistry,
  type InstructionRuntimeContext,
} from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";
import type { TagMemory } from "./tag-memory";

/** One row of an execution trace: an instruction's evaluation during a scan. */
export interface TraceEntry {
  rung: number;
  instruction: string;
  operands: string[];
  conditionIn: boolean;
  conditionOut: boolean;
  writes: { path: string; value: boolean | number | string }[];
}

/**
 * Per-routine-scan control passed to instructions that affect flow:
 *  - `callRoutine` runs a sibling routine (JSR) against the same memory;
 *  - `runForRoutine` runs a sibling routine repeatedly for FOR;
 *  - `returned` is set by RET to stop the rest of the current routine;
 *  - `breakRequested` is set by BRK to exit the active FOR loop;
 *  - `jumpToLabel` is set by JMP and resolved by the routine executor;
 *  - `mcrActive`/`mcrEnabled` track a bounded Master Control Reset zone;
 *  - `rungNumber`/`trace` capture an optional execution trace.
 */
export interface ExecControl {
  callRoutine: (name: string, parameters?: string[]) => void;
  callAoi?: (instructionType: string, operands: string[]) => boolean;
  runForRoutine?: (name: string, index: string, initial: number, terminal: number, step: number) => void;
  arrayDimension?: (source: string, dimension: number) => number | undefined;
  returned: boolean;
  returnParameters?: string[];
  breakRequested: boolean;
  jumpToLabel?: string;
  mcrActive: boolean;
  mcrEnabled: boolean;
  rungNumber: number;
  trace?: TraceEntry[];
}

/**
 * Executes a single rung against tag memory.
 *
 * Instruction behaviour is never hardcoded here: each node is dispatched to its
 * definition in the {@link InstructionRegistry}, which receives an
 * {@link InstructionRuntimeContext} backed by the live {@link TagMemory}. The
 * executor only threads the rung condition through the branch tree:
 *  - `nodes` are evaluated in series, left to right;
 *  - `parallelBranches` are OR-ed around that series (any parallel path true →
 *    the segment is true), which is what makes a seal-in branch work;
 *  - `next` continues the rung in series after the parallel merge.
 *
 * `deltaMs` is the time elapsed for this scan, passed to instructions like TON.
 * `control` (optional) enables JSR/RET routine flow.
 */
export class RungExecutor {
  constructor(private readonly registry: InstructionRegistry) {}

  /** Execute the rung and return its final rung-out condition. */
  execute(rung: LadderRung, memory: TagMemory, deltaMs = 0, control?: ExecControl): boolean {
    const isMcrBoundary = control?.mcrActive && rungContainsInstruction(rung, "MCR");
    const rungIn = control?.mcrActive && !control.mcrEnabled && !isMcrBoundary ? false : true;
    return this.executeBranch(rung.root, memory, rungIn, deltaMs, control);
  }

  private executeBranch(
    branch: LadderBranch,
    memory: TagMemory,
    rungIn: boolean,
    deltaMs: number,
    control?: ExecControl,
  ): boolean {
    // Series instructions within this segment.
    let segment = rungIn;
    for (const node of branch.nodes) {
      segment = this.executeNode(node, memory, segment, deltaMs, control);
      if (control?.returned || control?.breakRequested) return segment;
      if (control?.jumpToLabel) return segment;
    }

    // OR in any parallel paths, each fed from the same rung-in condition. Every
    // path is evaluated (no short-circuit) so instructions with side effects
    // still run on parallel branches.
    if (branch.parallelBranches && branch.parallelBranches.length > 0) {
      let anyParallel = false;
      for (const parallel of branch.parallelBranches) {
        const result = this.executeBranch(parallel, memory, rungIn, deltaMs, control);
        anyParallel = anyParallel || result;
        if (control?.returned || control?.breakRequested) return segment || anyParallel;
        if (control?.jumpToLabel) return segment || anyParallel;
      }
      segment = segment || anyParallel;
    }

    // Continue the rung in series after the parallel merge.
    if (branch.next) {
      return this.executeBranch(branch.next, memory, segment, deltaMs, control);
    }

    return segment;
  }

  private executeNode(
    node: LadderNode,
    memory: TagMemory,
    rungIn: boolean,
    deltaMs: number,
    control?: ExecControl,
  ): boolean {
    const definition = this.registry.get(node.instructionType);
    const operands = node.operands.map((operand) => operand.value);
    if (!definition) {
      if (rungIn && control?.callAoi?.(node.instructionType, operands)) {
        control.trace?.push({
          rung: control.rungNumber,
          instruction: node.instructionType,
          operands,
          conditionIn: rungIn,
          conditionOut: rungIn,
          writes: [],
        });
        return rungIn;
      }
      // Unsupported (e.g. imported) instruction: act as a pass-through wire so a
      // partially-supported routine still scans without crashing.
      control?.trace?.push({
        rung: control.rungNumber,
        instruction: node.instructionType,
        operands,
        conditionIn: rungIn,
        conditionOut: rungIn,
        writes: [],
      });
      return rungIn;
    }

    // When tracing, capture the writes this instruction performs.
    const writes: { path: string; value: boolean | number | string }[] = [];
    const tracing = !!control?.trace;

    const ctx: InstructionRuntimeContext = {
      rungIn,
      deltaMs,
      readValue: (path) => memory.read(path),
      writeValue: (path, value) => {
        memory.write(path, value);
        if (tracing) writes.push({ path, value });
      },
      readBool: (path) => memory.readBool(path),
      writeBool: (path, value) => {
        memory.writeBool(path, value);
        if (tracing) writes.push({ path, value });
      },
      readNumber: (path) => memory.readNumber(path),
      writeNumber: (path, value) => {
        memory.write(path, value);
        if (tracing) writes.push({ path, value });
      },
      readString: (path) => memory.readString(path),
      writeString: (path, value) => {
        memory.writeString(path, value);
        if (tracing) writes.push({ path, value });
      },
      numeric: (operand) =>
        parseNumericLiteral(operand) ?? memory.readNumber(operand.trim()),
      arrayDimension: control?.arrayDimension,
      callRoutine: control ? (name, parameters) => control.callRoutine(name, parameters) : undefined,
      runFor: control?.runForRoutine
        ? (name, index, initial, terminal, step) =>
            control.runForRoutine?.(name, index, initial, terminal, step)
        : undefined,
      requestReturn: control
        ? (parameters) => {
            control.returned = true;
            control.returnParameters = parameters ?? [];
          }
        : undefined,
      requestBreak: control
        ? () => {
            control.breakRequested = true;
          }
        : undefined,
      requestJump: control
        ? (label) => {
            control.jumpToLabel = label;
          }
        : undefined,
      mcrActive: control ? () => control.mcrActive : undefined,
      enterMcr: control
        ? (enabled) => {
            control.mcrActive = true;
            control.mcrEnabled = enabled;
          }
        : undefined,
      exitMcr: control
        ? () => {
            control.mcrActive = false;
            control.mcrEnabled = true;
          }
        : undefined,
    };

    const conditionOut = definition.execute(node, ctx);
    if (control?.trace) {
      control.trace.push({
        rung: control.rungNumber,
        instruction: node.instructionType,
        operands,
        conditionIn: rungIn,
        conditionOut,
        writes,
      });
    }
    return conditionOut;
  }
}

function branchContainsInstruction(branch: LadderBranch, instructionType: string): boolean {
  if (branch.nodes.some((node) => node.instructionType === instructionType)) return true;
  if (branch.parallelBranches?.some((parallel) => branchContainsInstruction(parallel, instructionType))) return true;
  return branch.next ? branchContainsInstruction(branch.next, instructionType) : false;
}

function rungContainsInstruction(rung: LadderRung, instructionType: string): boolean {
  return branchContainsInstruction(rung.root, instructionType);
}
