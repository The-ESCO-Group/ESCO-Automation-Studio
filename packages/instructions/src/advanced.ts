import type { InstructionCategory, InstructionDefinition } from "./types";

/**
 * Model-only advanced instructions: sequencer, shift, file, message, alarm, and
 * motion families. They are registered so real L5X imports parse, render, and
 * validate (as info, never an error) instead of being flagged "unsupported",
 * and so their operands are preserved on the rung. None of them are simulated —
 * each is a safe pass-through (returns the rung-in condition unchanged) and none
 * touches a controller. Operands are intentionally left undeclared so the
 * validator never mistakes a keyword operand (e.g. GSV's class/attribute names)
 * for an undefined tag.
 *
 * NOTE: PID and PIDE are deliberately NOT registered here. The model-summary in
 * apps/web (Codex-owned) derives its "unsupported" list directly from
 * `registry.has(...)`, and tests there and in project-actions still use PID/PIDE
 * as the canonical unsupported example. Registering them is a coordinated change
 * across those owners — tracked as a follow-up.
 */

function modelOnly(
  type: string,
  displayName: string,
  category: InstructionCategory,
  description: string,
): InstructionDefinition {
  return {
    type,
    displayName,
    category,
    description,
    operands: [],
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

// --- Sequencer ---
export const SQO = modelOnly("SQO", "Sequencer Output", "sequencer", "Sequencer Output (model-only): preserved and displayed; not simulated.");
export const SQI = modelOnly("SQI", "Sequencer Input", "sequencer", "Sequencer Input (model-only): preserved and displayed; not simulated.");
export const SQC = modelOnly("SQC", "Sequencer Compare", "sequencer", "Sequencer Compare (model-only): preserved and displayed; not simulated.");

// --- Shift ---
export const BSL = modelOnly("BSL", "Bit Shift Left", "shift", "Bit Shift Left (model-only): preserved and displayed; not simulated.");
export const BSR = modelOnly("BSR", "Bit Shift Right", "shift", "Bit Shift Right (model-only): preserved and displayed; not simulated.");

// --- File arithmetic / search ---
export const FAL = modelOnly("FAL", "File Arithmetic/Logic", "file", "File Arithmetic/Logic (model-only): preserved and displayed; not simulated.");
export const FSC = modelOnly("FSC", "File Search/Compare", "file", "File Search/Compare (model-only): preserved and displayed; not simulated.");

// --- Message / system value (NO controller communication) ---
export const MSG = modelOnly("MSG", "Message", "message", "Message (model-only): preserved and displayed; never communicates with a controller and is not simulated.");
export const GSV = modelOnly("GSV", "Get System Value", "message", "Get System Value (model-only): preserved and displayed; not simulated.");
export const SSV = modelOnly("SSV", "Set System Value", "message", "Set System Value (model-only): preserved and displayed; not simulated.");

// --- Alarms ---
export const ALMA = modelOnly("ALMA", "Analog Alarm", "alarm", "Analog Alarm (model-only): preserved and displayed; not simulated.");
export const ALMD = modelOnly("ALMD", "Digital Alarm", "alarm", "Digital Alarm (model-only): preserved and displayed; not simulated.");

// --- Motion (NO real motion control) ---
export const MSO = modelOnly("MSO", "Motion Servo On", "motion", "Motion Servo On (model-only): preserved and displayed; no real motion control and not simulated.");
export const MSF = modelOnly("MSF", "Motion Servo Off", "motion", "Motion Servo Off (model-only): preserved and displayed; no real motion control and not simulated.");
export const MAM = modelOnly("MAM", "Motion Axis Move", "motion", "Motion Axis Move (model-only): preserved and displayed; no real motion control and not simulated.");
export const MAJ = modelOnly("MAJ", "Motion Axis Jog", "motion", "Motion Axis Jog (model-only): preserved and displayed; no real motion control and not simulated.");
export const MAS = modelOnly("MAS", "Motion Axis Stop", "motion", "Motion Axis Stop (model-only): preserved and displayed; no real motion control and not simulated.");

/** Every model-only advanced instruction, for bulk registration. */
export const ADVANCED_MODEL_ONLY: InstructionDefinition[] = [
  SQO, SQI, SQC,
  BSL, BSR,
  FAL, FSC,
  MSG, GSV, SSV,
  ALMA, ALMD,
  MSO, MSF, MAM, MAJ, MAS,
];
