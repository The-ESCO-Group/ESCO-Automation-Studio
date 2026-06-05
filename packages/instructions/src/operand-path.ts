import { parseNumericLiteral } from "./operands";

/**
 * Structured breakdown of a single ladder operand reference.
 *
 * Operands in Logix-style logic are not free text: they are tag references that
 * may walk into UDT members, index into arrays, and address a single bit. This
 * module turns the raw operand string into a structured shape the editor and
 * validator can reason about — base tag, member path, array indices, and bit
 * access — and flags malformed syntax instead of guessing.
 */
export interface ParsedOperand {
  /** The original operand text, untrimmed. */
  raw: string;
  /**
   *  - "empty"    — blank operand (a missing required operand, but not a syntax error).
   *  - "literal"  — a numeric/radix constant (e.g. 3000, 16#FF) — not a tag.
   *  - "tag"      — a well-formed tag/member/array/bit reference.
   *  - "invalid"  — syntactically malformed; `error` explains why.
   */
  kind: "empty" | "literal" | "tag" | "invalid";
  /** Leading tag identifier, or "" for literals/empty/invalid. */
  baseTag: string;
  /** Member names after the base, in order ("Pump.RunCmd" → ["RunCmd"]). */
  memberPath: string[];
  /** Numeric array index groups, in order of appearance ("A[1,2]" → [[1,2]]). */
  indices: number[][];
  /** Trailing bit number for `.N` bit access ("DINT_Tag.3" → 3). */
  bitAccess?: number;
  /** True when any array index is an indirect (tag) index, e.g. "A[i]". */
  hasIndirectIndex?: boolean;
  /** Whether the reference is usable (`empty`, `literal`, and `tag` are all valid). */
  valid: boolean;
  /** Human-readable reason when `kind` is "invalid". */
  error?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Parse a single operand string into its structured parts. Pure and total — it
 * never throws; malformed input yields `{ kind: "invalid", error }`. Numeric and
 * radix literals (see {@link parseNumericLiteral}) are reported as "literal", so
 * callers can tell a constant apart from a tag without re-parsing.
 */
export function parseOperandPath(raw: string): ParsedOperand {
  const text = raw.trim();
  const base = (): Omit<ParsedOperand, "kind" | "valid"> => ({
    raw,
    baseTag: "",
    memberPath: [],
    indices: [],
  });

  if (text === "") {
    return { ...base(), kind: "empty", valid: true };
  }
  if (parseNumericLiteral(text) !== undefined) {
    return { ...base(), kind: "literal", valid: true };
  }

  const invalid = (error: string): ParsedOperand => ({
    ...base(),
    kind: "invalid",
    valid: false,
    error,
  });

  const baseMatch = text.match(IDENTIFIER);
  if (!baseMatch) {
    return invalid(`"${text}" is not a valid tag reference.`);
  }
  const baseTag = baseMatch[0];
  let i = baseTag.length;

  const memberPath: string[] = [];
  const indices: number[][] = [];
  let bitAccess: number | undefined;
  let hasIndirectIndex = false;

  while (i < text.length) {
    if (bitAccess !== undefined) {
      return invalid(`Bit access ".${bitAccess}" must be the last part of "${text}".`);
    }
    const ch = text[i];

    if (ch === ".") {
      const rest = text.slice(i + 1);
      const numberMatch = rest.match(/^\d+/);
      if (numberMatch) {
        bitAccess = Number(numberMatch[0]);
        i += 1 + numberMatch[0].length;
        continue;
      }
      const memberMatch = rest.match(IDENTIFIER);
      if (!memberMatch) {
        return invalid(`Expected a member name after "." in "${text}".`);
      }
      memberPath.push(memberMatch[0]);
      i += 1 + memberMatch[0].length;
      continue;
    }

    if (ch === "[") {
      const close = text.indexOf("]", i);
      if (close < 0) return invalid(`Unbalanced "[" in "${text}".`);
      const inner = text.slice(i + 1, close).trim();
      if (inner === "") return invalid(`Empty array index in "${text}".`);
      const group: number[] = [];
      for (const piece of inner.split(",")) {
        const part = piece.trim();
        if (part === "") return invalid(`Empty array index in "${text}".`);
        const n = Number(part);
        if (Number.isInteger(n) && n >= 0 && /^\d+$/.test(part)) {
          group.push(n);
        } else if (IDENTIFIER.test(part)) {
          // Indirect (tag) index, e.g. A[Index] — valid Logix, but not a constant.
          hasIndirectIndex = true;
        } else {
          return invalid(`Invalid array index "${part}" in "${text}".`);
        }
      }
      if (group.length > 0) indices.push(group);
      i = close + 1;
      continue;
    }

    return invalid(`Unexpected character "${ch}" in "${text}".`);
  }

  return {
    raw,
    kind: "tag",
    baseTag,
    memberPath,
    indices,
    ...(bitAccess !== undefined ? { bitAccess } : {}),
    ...(hasIndirectIndex ? { hasIndirectIndex } : {}),
    valid: true,
  };
}
