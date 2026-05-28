import type { LadderBranch, LadderNode, LadderRoutine, LadderRung } from "./types";

/** Yield every node in a branch tree: series nodes, parallel paths, then continuation. */
export function* walkBranch(branch: LadderBranch): Generator<LadderNode> {
  yield* branch.nodes;
  for (const parallel of branch.parallelBranches ?? []) {
    yield* walkBranch(parallel);
  }
  if (branch.next) {
    yield* walkBranch(branch.next);
  }
}

/** Every node referenced by a rung, in traversal order. */
export function rungNodes(rung: LadderRung): LadderNode[] {
  return [...walkBranch(rung.root)];
}

/** Every node referenced by a routine, across all rungs. */
export function routineNodes(routine: LadderRoutine): LadderNode[] {
  return routine.rungs.flatMap((rung) => [...walkBranch(rung.root)]);
}

/** Distinct tag names referenced by any `tag` operand in the routine (ignores blanks). */
export function routineTagReferences(routine: LadderRoutine): string[] {
  const tags = new Set<string>();
  for (const node of routineNodes(routine)) {
    for (const operand of node.operands) {
      if (operand.kind === "tag" && operand.value) {
        tags.add(operand.value);
      }
    }
  }
  return [...tags];
}
