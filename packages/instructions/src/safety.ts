import type { InstructionCategory, InstructionDefinition, InstructionOperandDefinition } from "./types";

/**
 * GuardLogix safety instructions. Every one is **model-only**: registered so
 * safety routines in a real L5X parse, render, validate (as info, never an
 * error) and round-trip with operands preserved — but never simulated.
 *
 * Safety logic carries functional-safety obligations (SIL/PL ratings, dual-
 * channel evaluation, lock/signature gating). None of that can be reproduced
 * faithfully offline, and pretending to execute it would be dangerous, so the
 * executor is a strict pass-through that touches no tag memory and the UI badges
 * these as safety / model-only. They are preserved for review only.
 *
 * Each block declares a single **review operand** — its backing safety tag (the
 * predefined safety structure the instruction is wired to, e.g. an ESTOP tag for
 * ESTOP, a DCS tag for DCS). Like the MSG/GSV/SSV review operands, this surfaces
 * the safety tag in the property panel and tag cross-reference (as a destructive
 * reference) without making the instruction executable: operand validation is
 * skipped for model-only instructions, so it never produces false "undefined
 * tag" findings. The channel inputs and status members live on that tag and are
 * set by surrounding logic, not by the instruction operand list.
 */

/** The backing safety tag the instruction is wired to — its sole operand. */
const safetyTag = (type: string): InstructionOperandDefinition => ({
  name: "safety",
  label: "Safety Tag",
  required: true,
  allowedTypes: [type],
  direction: "write",
  validateOnModelOnly: true,
});

function safetyBlock(
  type: string,
  displayName: string,
  description: string,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "safety" as InstructionCategory,
    description: `${description} (safety, model-only): preserved and displayed for review; never simulated and no real safety evaluation.`,
    operands: [safetyTag(type)],
    fidelity: {
      status: "review-only",
      summary: `${description} is preserved for GuardLogix safety review only; no safety function is evaluated offline.`,
      limitations: [
        "no safety evaluation",
        "no safety signature verification",
        "no safety lock/unlock or partition enforcement",
        "no controller safety status",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

// --- Emergency stop / monitoring ---
export const ESTOP = safetyBlock("ESTOP", "Emergency Stop", "Emergency Stop");
export const ESTPI = safetyBlock("ESTPI", "Emergency Stop with Inputs", "Emergency Stop with Inputs");
export const RESET = safetyBlock("RESET", "Reset", "Safety Reset");
export const THRS = safetyBlock("THRS", "Two-Hand Run Station", "Two-Hand Run Station");
export const THRSE = safetyBlock("THRSE", "Two-Hand Run Station Enhanced", "Two-Hand Run Station Enhanced");

// --- Gates / guards ---
export const SMAT = safetyBlock("SMAT", "Safety Mat", "Safety Mat");
export const SGS = safetyBlock("SGS", "Safety Gate Sequence Monitor", "Safety Gate Monitor");
export const DCS = safetyBlock("DCS", "Dual Channel Stop", "Dual Channel Input Stop");
export const DCSTL = safetyBlock("DCSTL", "Dual Channel Stop with Test and Lock", "Dual Channel Stop with Test and Lock");
export const DCSTM = safetyBlock("DCSTM", "Dual Channel Stop Monitoring", "Dual Channel Stop Monitoring");
export const DCM = safetyBlock("DCM", "Dual Channel Monitoring", "Dual Channel Monitoring");
export const DCInput = safetyBlock("DCI", "Dual Channel Input", "Dual Channel Input");
// DIN monitors two *diverse* inputs (one normally-open, one normally-closed)
// that must report opposite states, detecting an inconsistency fault. Like the
// other dual-channel blocks it carries dual-channel safety obligations, so it
// stays a model-only review block backed by its DIVERSE_INPUT safety tag.
export const DIN = safetyBlock("DIN", "Diverse Input", "Diverse Input");

// --- Muting / light curtains ---
export const LC = safetyBlock("LC", "Light Curtain", "Light Curtain Monitoring");
export const MUTING = safetyBlock("MUT", "Muting", "Light-Curtain Muting");

// --- Five-position / mode select / enabling ---
export const FPMS = safetyBlock("FPMS", "Five Position Mode Selector", "Five Position Mode Selector");
export const ESI = safetyBlock("ESI", "Enable Switch Input", "Enable Switch Input");

// --- Redundant outputs ---
// ROUT controls and monitors a pair of redundant safety outputs with feedback;
// CROUT is the configurable variant. Both carry the same functional-safety
// obligations as the input blocks (dual-channel evaluation, feedback timing),
// so they stay model-only review blocks backed by their ROUT/CROUT safety tag.
export const ROUT = safetyBlock("ROUT", "Redundant Output", "Redundant Output");
export const CROUT = safetyBlock("CROUT", "Configurable Redundant Output", "Configurable Redundant Output");

// --- Motion safety / configurable safety ---
export const SFX = safetyBlock("SFX", "Safety Feedback Interface", "Safety Feedback Interface");

/** Every safety instruction, for bulk registration. */
export const SAFETY_INSTRUCTIONS: InstructionDefinition[] = [
  ESTOP,
  ESTPI,
  RESET,
  THRS,
  THRSE,
  SMAT,
  SGS,
  DCS,
  DCSTL,
  DCSTM,
  DCM,
  DCInput,
  DIN,
  LC,
  MUTING,
  FPMS,
  ESI,
  ROUT,
  CROUT,
  SFX,
];
