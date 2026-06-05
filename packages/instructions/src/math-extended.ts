import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

/**
 * Extended math instructions with exact offline semantics: the transcendental /
 * trigonometric family (SIN, COS, TAN, ASN, ACS, ATN), logarithms (LN, LOG),
 * power (XPY), angle conversion (DEG, RAD), and truncation (TRN). Each is a real
 * Logix Compute/Math instruction whose result is a single deterministic function
 * of its source(s) — so unlike PID or motion they CAN be simulated faithfully
 * offline and are registered executable, not model-only.
 *
 * Trig instructions follow Logix and operate in **radians**. For inputs inside
 * the function's mathematical domain the result is exact. Out-of-domain inputs
 * (e.g. ASN(2), LN(-1), XPY(-2, 0.5)) would raise a math status fault on a real
 * controller; offline there is no fault word, so the result is guarded to 0 to
 * keep tag memory finite and the scan stable. That guard — not the fault — is the
 * only deviation from controller behaviour, and it is documented here and tested.
 */

const NUMERIC = ["DINT", "REAL"];

/** Clamp a non-finite result (NaN / ±Infinity) to 0 — the offline safe guard. */
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/** Single-source math box: Dest = fn(Source) while the rung is true (result guarded finite). */
function unaryMathBox(
  type: string,
  displayName: string,
  description: string,
  fn: (a: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["source", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 1);
        if (dest) ctx.writeNumber(dest, finite(fn(ctx.numeric(operandValue(node, 0)))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

// --- Trigonometric (operate in radians, matching Logix) ---
export const SIN = unaryMathBox("SIN", "Sine", "Dest = sine of Source (radians) while the rung is true.", Math.sin);
export const COS = unaryMathBox("COS", "Cosine", "Dest = cosine of Source (radians) while the rung is true.", Math.cos);
export const TAN = unaryMathBox("TAN", "Tangent", "Dest = tangent of Source (radians) while the rung is true.", Math.tan);

// --- Inverse trigonometric (result in radians; |Source| > 1 is out of domain → 0) ---
export const ASN = unaryMathBox("ASN", "Arc Sine", "Dest = arc sine of Source in radians (|Source| ≤ 1) while the rung is true.", Math.asin);
export const ACS = unaryMathBox("ACS", "Arc Cosine", "Dest = arc cosine of Source in radians (|Source| ≤ 1) while the rung is true.", Math.acos);
export const ATN = unaryMathBox("ATN", "Arc Tangent", "Dest = arc tangent of Source in radians while the rung is true.", Math.atan);

// --- Logarithms (Source ≤ 0 is out of domain → 0) ---
export const LN = unaryMathBox("LN", "Natural Log", "Dest = natural logarithm of Source (Source > 0) while the rung is true.", Math.log);
export const LOG = unaryMathBox("LOG", "Log Base 10", "Dest = base-10 logarithm of Source (Source > 0) while the rung is true.", Math.log10);

// --- Angle conversion (exact) ---
export const DEG = unaryMathBox("DEG", "Radians to Degrees", "Dest = Source converted from radians to degrees while the rung is true.", (a) => (a * 180) / Math.PI);
export const RAD = unaryMathBox("RAD", "Degrees to Radians", "Dest = Source converted from degrees to radians while the rung is true.", (a) => (a * Math.PI) / 180);

// --- Truncate (toward zero; exact) ---
export const TRN = unaryMathBox("TRN", "Truncate", "Dest = Source truncated toward zero (fractional part removed) while the rung is true.", Math.trunc);

/**
 * XPY - X to the Power of Y. Dest = Source A raised to Source B while the rung is
 * true. Negative base with a fractional exponent is out of domain (→ 0).
 */
export const XPY: InstructionDefinition = {
  type: "XPY",
  displayName: "X to the Power Y",
  category: "math",
  description: "Dest = Source A raised to the power of Source B while the rung is true.",
  operands: [
    { name: "sourceA", label: "Source A (X)", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "sourceB", label: "Source B (Y)", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["sourceA", "sourceB", "dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 2);
      if (dest) {
        ctx.writeNumber(dest, finite(Math.pow(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1)))));
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "XPY", style: "box" },
};

/** Two-source math box: Dest = fn(Source A, Source B) while the rung is true (result guarded finite). */
function binaryMathBox(
  type: string,
  displayName: string,
  description: string,
  labelA: string,
  labelB: string,
  fn: (a: number, b: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "sourceA", label: labelA, required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "sourceB", label: labelB, required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["sourceA", "sourceB", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 2);
        if (dest) ctx.writeNumber(dest, finite(fn(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1)))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

/*
 * Studio-style long-name math/trig instructions. ACOS/ASIN/ATAN/TRUNC are the
 * function-block / structured-text spellings of the canonical ACS/ASN/ATN/TRN
 * RLL boxes and share their exact offline semantics (radians, out-of-domain →
 * 0). SQRT is the long name for SQR (negative source → 0). ATAN2 and EXPT add
 * the two-argument arc-tangent and power that the long-name family exposes.
 */

// --- Inverse trig long names (alias of ACS/ASN/ATN; result in radians) ---
export const ACOS = unaryMathBox("ACOS", "Arc Cosine", "Dest = arc cosine of Source in radians (|Source| ≤ 1) while the rung is true (alias of ACS).", Math.acos);
export const ASIN = unaryMathBox("ASIN", "Arc Sine", "Dest = arc sine of Source in radians (|Source| ≤ 1) while the rung is true (alias of ASN).", Math.asin);
export const ATAN = unaryMathBox("ATAN", "Arc Tangent", "Dest = arc tangent of Source in radians while the rung is true (alias of ATN).", Math.atan);

/** ATAN2 - Four-quadrant arc tangent. Dest = atan2(Source A = Y, Source B = X) in radians. */
export const ATAN2 = binaryMathBox(
  "ATAN2",
  "Arc Tangent (X, Y)",
  "Dest = four-quadrant arc tangent of Source A (Y) over Source B (X), in radians, while the rung is true.",
  "Source A (Y)",
  "Source B (X)",
  (y, x) => Math.atan2(y, x),
);

/** EXPT - Exponent (X to the power Y). Dest = Source A ^ Source B; long name for XPY. */
export const EXPT = binaryMathBox(
  "EXPT",
  "Exponent (X to the Power Y)",
  "Dest = Source A raised to the power of Source B while the rung is true (alias of XPY).",
  "Source A (X)",
  "Source B (Y)",
  (x, y) => Math.pow(x, y),
);

// --- Truncate / square root long names ---
export const TRUNC = unaryMathBox("TRUNC", "Truncate", "Dest = Source truncated toward zero (fractional part removed) while the rung is true (alias of TRN).", Math.trunc);
export const SQRT = unaryMathBox("SQRT", "Square Root", "Dest = square root of Source (negative Source → 0) while the rung is true (alias of SQR).", (a) => (a < 0 ? 0 : Math.sqrt(a)));

/** Every extended-math instruction, for bulk registration. */
export const MATH_EXTENDED_INSTRUCTIONS: InstructionDefinition[] = [
  SIN, COS, TAN, ASN, ACS, ATN, LN, LOG, DEG, RAD, TRN, XPY,
  ACOS, ASIN, ATAN, ATAN2, EXPT, TRUNC, SQRT,
];
