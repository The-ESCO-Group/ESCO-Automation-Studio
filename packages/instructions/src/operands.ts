import type { LadderNode } from "@esco/ladder";

/** Trimmed value of the operand at `index`, or "" when absent. */
export function operandValue(node: LadderNode, index: number): string {
  return node.operands[index]?.value?.trim() ?? "";
}

/**
 * True when a string is a numeric literal (e.g. "3000", "-1", "1.5"). Used to
 * distinguish constants from tag references in operands like MOV(123, Dest).
 */
export function isNumericLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed);
}
