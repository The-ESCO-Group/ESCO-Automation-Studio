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

/** Every extended-math instruction, for bulk registration. */
export const MATH_EXTENDED_INSTRUCTIONS: InstructionDefinition[] = [
  SIN, COS, TAN, ASN, ACS, ATN, LN, LOG, DEG, RAD, TRN, XPY,
];
