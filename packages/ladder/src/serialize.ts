/**
 * Serialize the semantic ladder AST back to Logix neutral rung text. This is the
 * inverse of the rung-text parser for the supported branch shapes (a flat series
 * and single-level parallel branches), so ladder logic survives an
 * export → import round trip.
 */

import type { LadderBranch, LadderNode, LadderRung } from "./types";

/** One instruction in neutral text: `TYPE(op1,op2,...)`. */
function nodeToText(node: LadderNode): string {
  const operands = node.operands.map((operand) => (operand.value ?? "").trim());
  return `${node.instructionType}(${operands.join(",")})`;
}

/**
 * Neutral text for a branch tree: the series instructions in order, then any
 * single-level parallel group as `[leg,leg,…]` (the segment's own series is the
 * first leg), then the series continuation. Mirrors how `parseRungText` builds
 * the tree, so `parse(serialize(branch))` reproduces the same structure.
 */
export function serializeBranch(branch: LadderBranch): string {
  const series = branch.nodes.map(nodeToText).join("");
  let text: string;
  if (branch.parallelBranches && branch.parallelBranches.length > 0) {
    const legs = [series, ...branch.parallelBranches.map(serializeBranch)];
    text = `[${legs.join(",")}]`;
  } else {
    text = series;
  }
  if (branch.next) text += serializeBranch(branch.next);
  return text;
}

/** Logix neutral rung text for a rung's logic (no trailing semicolon). */
export function rungToText(rung: LadderRung): string {
  return serializeBranch(rung.root);
}
