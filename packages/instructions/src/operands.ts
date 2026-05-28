import type { LadderNode } from "@esco/ladder";

/** Trimmed value of the operand at `index`, or "" when absent. */
export function operandValue(node: LadderNode, index: number): string {
  return node.operands[index]?.value?.trim() ?? "";
}

/**
 * True when a string is a numeric literal — decimal/float (`3000`, `-1`, `1.5`)
 * or a Logix radix literal (`16#FF`, `2#1010`, `8#17`). Used to distinguish
 * constants from tag references in operands like MOV(123, Dest).
 */
export function isNumericLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed) || /^\d+#[0-9A-Fa-f]+$/.test(trimmed);
}

/**
 * Extract the base tag name from an operand path: the leading identifier of a
 * tag, member, or array reference. Returns "" for literals/expressions.
 *  - "Motor.Status.Running" → "Motor"
 *  - "Timer1.DN" → "Timer1"
 *  - "MyArray[0]" → "MyArray"
 *  - "123" / "16#FF" → ""
 */
export function baseTagName(value: string): string {
  const match = value.trim().match(/^[A-Za-z_][A-Za-z0-9_]*/);
  return match ? match[0] : "";
}

/** True when the operand is a plain tag name (no member access or array index). */
export function isPlainTag(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());
}
