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
  return parseNumericLiteral(value) !== undefined;
}

/**
 * Parse a Logix numeric literal. Supports decimal/float values plus radix
 * literals such as `16#FF`, `2#1010`, and signed forms like `-16#10`. Underscore
 * digit-group separators are accepted between digits, mirroring Studio 5000
 * immediate operands (`16#00FF_00FF`, `2#1010_1010`, `1_000_000`); a leading,
 * trailing, or doubled underscore is rejected, so a separator never turns a
 * malformed token into a number.
 */
export function parseNumericLiteral(value: string): number | undefined {
  const trimmed = value.trim();
  const radixMatch = trimmed.match(/^([+-]?)(\d+)#([0-9A-Fa-f](?:_?[0-9A-Fa-f])*)$/);
  if (radixMatch) {
    const sign = radixMatch[1] === "-" ? -1 : 1;
    const radix = Number(radixMatch[2]);
    const digits = radixMatch[3]!.replace(/_/g, "");
    if (!Number.isInteger(radix) || radix < 2 || radix > 16) return undefined;
    let parsed = 0;
    for (const char of digits) {
      const digit = Number.parseInt(char, 16);
      if (!Number.isInteger(digit) || digit >= radix) return undefined;
      parsed = parsed * radix + digit;
    }
    return sign * parsed;
  }

  if (/^[+-]?((\d(?:_?\d)*)(\.(\d(?:_?\d)*)?)?|\.(\d(?:_?\d)*))$/.test(trimmed)) {
    const parsed = Number(trimmed.replace(/_/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
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
