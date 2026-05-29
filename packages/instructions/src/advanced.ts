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
 * PID / PIDE and the rest of the process-control family now live in process.ts
 * (registered model-only), and the GuardLogix safety family in safety.ts. The
 * canonical "unknown unsupported" example used by tests and fixtures is the
 * vendor token `XUNKNOWN`, which is intentionally never registered.
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

const motion = (type: string, displayName: string): InstructionDefinition =>
  modelOnly(type, displayName, "motion", `${displayName} (model-only): preserved and displayed; no real motion control and not simulated.`);

export const MCD = motion("MCD", "Motion Change Dynamics");
export const MCCD = motion("MCCD", "Motion Coordinated Change Dynamics");
export const MCLM = motion("MCLM", "Motion Coordinated Linear Move");
export const MCLP = motion("MCLP", "Motion Coordinated Linear Path");
export const MCT = motion("MCT", "Motion Coordinated Transform");
export const MAG = motion("MAG", "Motion Axis Gear");
export const MAPC = motion("MAPC", "Motion Axis Position Cam");
export const MCSV = motion("MCSV", "Motion Calculate Slave Values");
export const MCSR = motion("MCSR", "Motion Coordinated Shutdown Reset");
export const MDO = motion("MDO", "Motion Direct Drive On");
export const MDAC = motion("MDAC", "Motion Drive Axis Control");
export const MAH = motion("MAH", "Motion Axis Home");
export const MHS = motion("MHS", "Motion Home Sequence");
export const MRP = motion("MRP", "Motion Redefine Position");
export const MRAT = motion("MRAT", "Motion Run Axis Tuning");
export const MGS = motion("MGS", "Motion Group Stop");

// --- Program control (interrupt / immediate-output: not scheduled or simulated offline) ---
export const UID = modelOnly("UID", "User Interrupt Disable", "program-control", "User Interrupt Disable (model-only): interrupt scheduling is not simulated; pass-through.");
export const UIE = modelOnly("UIE", "User Interrupt Enable", "program-control", "User Interrupt Enable (model-only): interrupt scheduling is not simulated; pass-through.");
export const IOT = modelOnly("IOT", "Immediate Output", "program-control", "Immediate Output (model-only): no immediate I/O update offline and no controller communication; pass-through.");

/** Every model-only advanced instruction, for bulk registration. */
export const ADVANCED_MODEL_ONLY: InstructionDefinition[] = [
  SQO, SQI, SQC,
  BSL, BSR,
  FAL, FSC,
  MSG, GSV, SSV,
  ALMA, ALMD,
  MSO, MSF, MAM, MAJ, MAS,
  MCD, MCCD, MCLM, MCLP, MCT, MAG, MAPC, MCSV, MCSR, MDO, MDAC, MAH, MHS, MRP, MRAT, MGS,
  UID, UIE, IOT,
];
