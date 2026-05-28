import type { Routine } from "@esco/core";
import type { LadderBranch, LadderNode, LadderRoutine, LadderRung } from "@esco/ladder";

/**
 * A normalized, comparable representation of a routine's ladder logic.
 *
 * Logic is reduced to canonical neutral text per rung, with node/branch ids and
 * absolute rung numbers dropped (rungs are compared in scan order). Two
 * signatures are produced:
 *  - `full` includes operand values — the exact-match key;
 *  - `structure` replaces operand values with `_` placeholders, so it matches
 *    routines with the same instruction/branch layout but different tags.
 * Unsupported instructions keep their type and operands, so they participate in
 * the comparison rather than being dropped.
 */
export interface RoutineFingerprint {
  full: string;
  structure: string;
  /** Per-rung neutral text (operands included) for side-by-side display. */
  rungTexts: string[];
  rungCount: number;
}

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function nodeToText(node: LadderNode, withOperands: boolean): string {
  const operands = node.operands.map((operand) => (withOperands ? (operand.value ?? "").trim() : "_"));
  return `${node.instructionType}(${operands.join(",")})`;
}

/** Canonical neutral text for a branch tree: series, `[leg,leg,…]` parallels, then continuation. */
function branchToText(branch: LadderBranch, withOperands: boolean): string {
  const series = branch.nodes.map((node) => nodeToText(node, withOperands)).join("");
  let text: string;
  if (branch.parallelBranches && branch.parallelBranches.length > 0) {
    const legs = [series, ...branch.parallelBranches.map((leg) => branchToText(leg, withOperands))];
    text = `[${legs.join(",")}]`;
  } else {
    text = series;
  }
  if (branch.next) text += branchToText(branch.next, withOperands);
  return text;
}

/** Neutral text of a single rung (operands included by default). */
export function rungText(rung: LadderRung, withOperands = true): string {
  return branchToText(rung.root, withOperands);
}

/** Build a comparable fingerprint of a routine's logic. */
export function fingerprintRoutine(routine: Routine): RoutineFingerprint {
  const ladder = asLadderRoutine(routine.ladder);
  const rungs = ladder ? [...ladder.rungs].sort((a, b) => a.number - b.number) : [];
  const fullTexts = rungs.map((rung) => branchToText(rung.root, true));
  const structureTexts = rungs.map((rung) => branchToText(rung.root, false));
  return {
    full: fullTexts.join(" / "),
    structure: structureTexts.join(" / "),
    rungTexts: fullTexts,
    rungCount: rungs.length,
  };
}
