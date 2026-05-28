import {
  isNumericLiteral,
  type InstructionRegistry,
  type InstructionRuntimeContext,
} from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";
import type { TagMemory } from "./tag-memory";

/**
 * Per-routine-scan control passed to instructions that affect flow:
 *  - `callRoutine` runs a sibling routine (JSR) against the same memory;
 *  - `returned` is set by RET to stop the rest of the current routine.
 */
export interface ExecControl {
  callRoutine: (name: string) => void;
  returned: boolean;
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
    return this.executeBranch(rung.root, memory, true, deltaMs, control);
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
    }

    // OR in any parallel paths, each fed from the same rung-in condition. Every
    // path is evaluated (no short-circuit) so instructions with side effects
    // still run on parallel branches.
    if (branch.parallelBranches && branch.parallelBranches.length > 0) {
      let anyParallel = false;
      for (const parallel of branch.parallelBranches) {
        const result = this.executeBranch(parallel, memory, rungIn, deltaMs, control);
        anyParallel = anyParallel || result;
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
    if (!definition) {
      // Unsupported (e.g. imported) instruction: act as a pass-through wire so a
      // partially-supported routine still scans without crashing.
      return rungIn;
    }

    const ctx: InstructionRuntimeContext = {
      rungIn,
      deltaMs,
      readBool: (path) => memory.readBool(path),
      writeBool: (path, value) => memory.writeBool(path, value),
      readNumber: (path) => memory.readNumber(path),
      writeNumber: (path, value) => memory.write(path, value),
      numeric: (operand) =>
        isNumericLiteral(operand) ? Number(operand.trim()) : memory.readNumber(operand.trim()),
      callRoutine: control ? (name) => control.callRoutine(name) : undefined,
      requestReturn: control
        ? () => {
            control.returned = true;
          }
        : undefined,
    };

    return definition.execute(node, ctx);
  }
}
