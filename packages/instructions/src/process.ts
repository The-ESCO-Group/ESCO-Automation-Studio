import type { InstructionCategory, InstructionDefinition, InstructionOperandDefinition } from "./types";

/**
 * Process control instructions (PID, PIDE, and the loop/scaling/totalizer
 * family). Every one is **model-only**: it is registered so real L5X imports
 * parse, render, validate (as info, never an error) and round-trip with their
 * operands preserved — but none is simulated. Closed-loop process control has no
 * controller-faithful offline execution and must never be faked, so the executor
 * is a safe pass-through (returns the rung-in condition unchanged) and touches no
 * tag memory.
 *
 * Unlike the bare model-only blocks in advanced.ts, the two PID variants declare
 * their primary operands so the editor's property panel and palette can show a
 * meaningful loop tag / process variable / control variable. Operand validation
 * is skipped for model-only instructions (see validator rules.ts), so declaring
 * operands here never produces false "undefined tag" findings for the keyword or
 * structure operands that process blocks use.
 *
 * The PID / PIDE *data* models (member layouts like PID_01.SP, .PV, .OUT) live in
 * @esco/core data-types.ts STRUCTURED_TYPES, which drives Watch seeding and
 * member-path validation.
 */

function processBlock(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "process" as InstructionCategory,
    description,
    operands,
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

const loopTag = (allowedTypes: string[]): InstructionOperandDefinition => ({
  name: "loop",
  label: "Loop Tag",
  required: true,
  allowedTypes,
  direction: "write",
});

// --- Classic PID -----------------------------------------------------------
// PID(PID, ProcessVariable, Tieback, ControlVariable, PIDMasterLoop, InholdBit,
//      InholdValue) — only the loop tag is required in practice.
export const PID = processBlock(
  "PID",
  "Proportional Integral Derivative",
  "PID closed-loop control (model-only): preserved, displayed, and its loop members are modelled for the Watch, but the loop is never simulated.",
  [
    loopTag(["PID"]),
    { name: "pv", label: "Process Variable", required: false, direction: "read" },
    { name: "tieback", label: "Tieback", required: false, direction: "read" },
    { name: "cv", label: "Control Variable", required: false, direction: "write" },
    { name: "masterLoop", label: "PID Master Loop", required: false, direction: "read" },
    { name: "inholdBit", label: "Inhold Bit", required: false, direction: "read" },
    { name: "inholdValue", label: "Inhold Value", required: false, direction: "read" },
  ],
);

// --- Enhanced PID (function block) -----------------------------------------
export const PIDE = processBlock(
  "PIDE",
  "Enhanced PID",
  "Enhanced PID closed-loop control (model-only): preserved and displayed; the loop is never simulated.",
  [
    loopTag(["PIDE"]),
    { name: "pv", label: "Process Variable", required: false, direction: "read" },
    { name: "cv", label: "Control Variable", required: false, direction: "write" },
  ],
);

// --- Loop / signal-conditioning family (model-only) ------------------------
const process1 = (type: string, displayName: string): InstructionDefinition =>
  processBlock(type, displayName, `${displayName} (model-only): preserved and displayed; not simulated.`);

export const SCL = process1("SCL", "Scale");
export const TOT = process1("TOT", "Totalizer");
export const RMPS = process1("RMPS", "Ramp/Soak");
export const DEDT = process1("DEDT", "Deadtime");
export const LDLG = process1("LDLG", "Lead-Lag");
export const HLL = process1("HLL", "High/Low Limit");
export const MUX = process1("MUX", "Multiplexer");
export const SOC = process1("SOC", "Second Order Controller");
export const POSP = process1("POSP", "Position Proportional");
export const PMUL = process1("PMUL", "Pulse Multiplier");

/** Every process-control instruction, for bulk registration. */
export const PROCESS_INSTRUCTIONS: InstructionDefinition[] = [
  PID,
  PIDE,
  SCL,
  TOT,
  RMPS,
  DEDT,
  LDLG,
  HLL,
  MUX,
  SOC,
  POSP,
  PMUL,
];
