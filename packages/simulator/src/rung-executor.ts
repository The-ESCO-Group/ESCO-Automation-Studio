import type { InstructionRegistry, InstructionRuntimeContext } from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";
import type { TagMemory } from "./tag-memory";

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
 */
export class RungExecutor {
  constructor(private readonly registry: InstructionRegistry) {}

  /** Execute the rung and return its final rung-out condition. */
  execute(rung: LadderRung, memory: TagMemory): boolean {
    return this.executeBranch(rung.root, memory, true);
  }

  private executeBranch(
    branch: LadderBranch,
    memory: TagMemory,
    rungIn: boolean,
  ): boolean {
    // Series instructions within this segment.
    let segment = rungIn;
    for (const node of branch.nodes) {
      segment = this.executeNode(node, memory, segment);
    }

    // OR in any parallel paths, each fed from the same rung-in condition. Every
    // path is evaluated (no short-circuit) so instructions with side effects
    // still run on parallel branches.
    if (branch.parallelBranches && branch.parallelBranches.length > 0) {
      let anyParallel = false;
      for (const parallel of branch.parallelBranches) {
        const result = this.executeBranch(parallel, memory, rungIn);
        anyParallel = anyParallel || result;
      }
      segment = segment || anyParallel;
    }

    // Continue the rung in series after the parallel merge.
    if (branch.next) {
      return this.executeBranch(branch.next, memory, segment);
    }

    return segment;
  }

  private executeNode(
    node: LadderNode,
    memory: TagMemory,
    rungIn: boolean,
  ): boolean {
    const definition = this.registry.get(node.instructionType);
    if (!definition) {
      throw new Error(`Unknown instruction type: ${node.instructionType}`);
    }

    const ctx: InstructionRuntimeContext = {
      rungIn,
      readBool: (path) => memory.readBool(path),
      writeBool: (path, value) => memory.writeBool(path, value),
    };

    return definition.execute(node, ctx);
  }
}
