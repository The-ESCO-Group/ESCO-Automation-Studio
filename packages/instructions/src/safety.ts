import type { InstructionCategory, InstructionDefinition } from "./types";

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
 */

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
    operands: [],
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

// --- Muting / light curtains ---
export const LC = safetyBlock("LC", "Light Curtain", "Light Curtain Monitoring");
export const MUTING = safetyBlock("MUT", "Muting", "Light-Curtain Muting");

// --- Five-position / mode select / enabling ---
export const FPMS = safetyBlock("FPMS", "Five Position Mode Selector", "Five Position Mode Selector");
export const ESI = safetyBlock("ESI", "Enable Switch Input", "Enable Switch Input");

// --- Motion safety / configurable safety ---
export const SFX = safetyBlock("SFX", "Safety Feedback Interface", "Safety Feedback Interface");
export const CROUT = safetyBlock("CROUT", "Configurable Redundant Output", "Configurable Redundant Output");

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
  LC,
  MUTING,
  FPMS,
  ESI,
  SFX,
  CROUT,
];
