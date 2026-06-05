import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { operandValue, parseNumericLiteral } from "./operands";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

const NUMERIC = ["DINT", "REAL"];
/** Comparison instructions accept numeric operands or STRING operands (compared by character). */
const COMPARABLE = ["DINT", "REAL", "STRING"];

/** A single- or double-quoted string literal operand → its inner text, else undefined. */
function stringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) return undefined;
  const quote = trimmed[0];
  if ((quote !== `"` && quote !== "'") || trimmed[trimmed.length - 1] !== quote) return undefined;
  return trimmed.slice(1, -1);
}

/**
 * Resolve a comparison operand to either a number or a string, mirroring how a
 * controller dispatches EQU/NEQ/GRT/GEQ/LES/LEQ on the operand's declared data
 * type. The offline tag image is untyped (a STRING tag and a DINT tag are both
 * just stored values), so the dispatch is inferred from the operand:
 *   - a quoted literal (`'STOP'`) or a tag whose stored value is a non-numeric
 *     string compares as text (Logix compares STRING operands character by
 *     character, which JS string comparison reproduces for ASCII contents);
 *   - a numeric literal, or a tag whose value reads as a finite number, compares
 *     numerically.
 * The single deviation is an all-digit STRING (e.g. a STRING tag holding "42"),
 * treated here as the number 42 — but a STRING-vs-number comparison is a type
 * mismatch a controller rejects at verify time, so it never arises in a valid
 * program, and two such STRINGs still compare equal when their digits match.
 */
function resolveOperand(ctx: InstructionRuntimeContext, raw: string): { text: string; isString: boolean } {
  const literal = stringLiteral(raw);
  if (literal !== undefined) return { text: literal, isString: true };
  if (parseNumericLiteral(raw) !== undefined) return { text: raw, isString: false };
  const text = ctx.readString(raw);
  const numeric = text.trim() !== "" && Number.isFinite(Number(text));
  return { text, isString: text !== "" && !numeric };
}

/** MOV - Move. Copies Source to Dest while the rung is true. */
export const MOV: InstructionDefinition = {
  type: "MOV",
  displayName: "Move",
  category: "move",
  description: "Copies Source into Dest when the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 1);
      if (dest) ctx.writeNumber(dest, ctx.numeric(operandValue(node, 0)));
    }
    return ctx.rungIn;
  },
  render: { symbol: "MOV", style: "box" },
};

/**
 * MOVE - Move (Studio export alias of MOV). Some Studio 5000 exports spell the
 * scalar move box as MOVE in neutral text. Keep the authored mnemonic while
 * using the same operand shape and offline execution as MOV.
 */
export const MOVE: InstructionDefinition = {
  ...MOV,
  type: "MOVE",
  description: "Copies Source into Dest when the rung is true (alias of MOV).",
  render: { ...MOV.render, symbol: "MOVE" },
};

/**
 * A relational/equality box. `numericTest` runs when both operands are numbers;
 * `stringTest` runs when either operand resolves to a string (see
 * {@link resolveOperand}). Both tests use the same operator so numeric `5 < 6`
 * and lexicographic `'A' < 'B'` behave consistently.
 */
function compare(
  type: string,
  displayName: string,
  description: string,
  numericTest: (a: number, b: number) => boolean,
  stringTest: (a: string, b: string) => boolean,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "compare",
    description,
    operands: [
      { name: "sourceA", label: "Source A", required: true, allowedTypes: COMPARABLE, direction: "read" },
      { name: "sourceB", label: "Source B", required: true, allowedTypes: COMPARABLE, direction: "read" },
    ],
    validate: requireOperands(["sourceA", "sourceB"]),
    execute: (node, ctx) => {
      if (!ctx.rungIn) return false;
      const aRaw = operandValue(node, 0);
      const bRaw = operandValue(node, 1);
      const a = resolveOperand(ctx, aRaw);
      const b = resolveOperand(ctx, bRaw);
      if (a.isString || b.isString) return stringTest(a.text, b.text);
      return numericTest(ctx.numeric(aRaw), ctx.numeric(bRaw));
    },
    render: { symbol: type, style: "function" },
  };
}

/** EQU - Equal. Passes when Source A == Source B (numeric or character-for-character). */
export const EQU = compare("EQU", "Equal", "Passes when Source A equals Source B.", (a, b) => a === b, (a, b) => a === b);

/** GRT - Greater Than. Passes when Source A > Source B. */
export const GRT = compare("GRT", "Greater Than", "Passes when Source A is greater than Source B.", (a, b) => a > b, (a, b) => a > b);

/** LES - Less Than. Passes when Source A < Source B. */
export const LES = compare("LES", "Less Than", "Passes when Source A is less than Source B.", (a, b) => a < b, (a, b) => a < b);

/** NEQ - Not Equal. Passes when Source A != Source B. */
export const NEQ = compare("NEQ", "Not Equal", "Passes when Source A does not equal Source B.", (a, b) => a !== b, (a, b) => a !== b);

/** LEQ - Less Than or Equal. */
export const LEQ = compare("LEQ", "Less Than or Equal", "Passes when Source A <= Source B.", (a, b) => a <= b, (a, b) => a <= b);

/** GEQ - Greater Than or Equal. */
export const GEQ = compare("GEQ", "Greater Than or Equal", "Passes when Source A >= Source B.", (a, b) => a >= b, (a, b) => a >= b);

/*
 * Studio-style relational aliases. EQ/NE/GT/GE/LT/LE are the short comparison
 * mnemonics that appear in some exports and function-block conversions; they have
 * identical operands, validation, and offline behaviour to the canonical
 * EQU/NEQ/GRT/GEQ/LES/LEQ boxes above (registered as distinct types so an import
 * keeps the authored mnemonic instead of being flagged unsupported).
 */

/** EQ - Equal (alias of EQU). Passes when Source A == Source B. */
export const EQ = compare("EQ", "Equal To", "Passes when Source A equals Source B (alias of EQU).", (a, b) => a === b, (a, b) => a === b);

/** NE - Not Equal (alias of NEQ). Passes when Source A != Source B. */
export const NE = compare("NE", "Not Equal To", "Passes when Source A does not equal Source B (alias of NEQ).", (a, b) => a !== b, (a, b) => a !== b);

/** GT - Greater Than (alias of GRT). Passes when Source A > Source B. */
export const GT = compare("GT", "Greater Than", "Passes when Source A is greater than Source B (alias of GRT).", (a, b) => a > b, (a, b) => a > b);

/** GE - Greater Than or Equal (alias of GEQ). */
export const GE = compare("GE", "Greater Than or Equal To", "Passes when Source A >= Source B (alias of GEQ).", (a, b) => a >= b, (a, b) => a >= b);

/** LT - Less Than (alias of LES). Passes when Source A < Source B. */
export const LT = compare("LT", "Less Than", "Passes when Source A is less than Source B (alias of LES).", (a, b) => a < b, (a, b) => a < b);

/** LE - Less Than or Equal (alias of LEQ). */
export const LE = compare("LE", "Less Than or Equal To", "Passes when Source A <= Source B (alias of LEQ).", (a, b) => a <= b, (a, b) => a <= b);

/** Studio-style relational aliases, for bulk registration. */
export const COMPARE_ALIAS_INSTRUCTIONS: InstructionDefinition[] = [EQ, NE, GT, GE, LT, LE];
