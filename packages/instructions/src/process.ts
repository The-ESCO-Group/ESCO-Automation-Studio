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
    fidelity: {
      status: "model-only",
      summary: description,
      limitations: [
        "no firmware-faithful PID/PIDE algorithm execution",
        "no process-variable sampling",
        "no control-variable output",
        "no loop scheduling, tuning, status, or alarm updates",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

function processLibraryBlock(type: string, displayName: string): InstructionDefinition {
  const description = `${displayName} (vendor process-library object, model-only): preserved and displayed for review; process-library faceplate behavior, device diagnostics, and controller communication are not simulated offline.`;
  return {
    type,
    displayName,
    category: "process" as InstructionCategory,
    description,
    operands: [],
    fidelity: {
      status: "model-only",
      summary: description,
      limitations: [
        "no process-library runtime or faceplate behavior",
        "no drive Add-On Profile or device diagnostic execution",
        "no controller communication or hardware side effects",
      ],
    },
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
  validateOnModelOnly: true,
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
// Like PID/PIDE, every block in this family is backed by a predefined process
// structure tag of its own datatype, named first in neutral text — e.g.
// SCL(SCL_01, ...), TOT(TOT_01, ...). That tag is the object the block owns and
// updates (its .EnableIn/.Out and status members are set by the block, not by
// surrounding logic), so we declare it as a single backing-tag **review operand**
// with write direction, mirroring the safety blocks (see safety.ts). This
// surfaces the block tag in the property panel and as a destructive reference in
// tag cross-reference — without it, cross-reference defaults the undeclared
// operand to a read reference, mis-classifying the owned tag. Operand validation
// is skipped for model-only instructions, so allowedTypes only informs the
// editor and never produces false "undefined tag" findings. Any conditioning
// inputs/outputs after the backing tag fall through to opN as read references.
const backingTag = (type: string): InstructionOperandDefinition => ({
  name: "block",
  label: "Block Tag",
  required: true,
  allowedTypes: [type],
  direction: "write",
  validateOnModelOnly: true,
});

const process1 = (type: string, displayName: string): InstructionDefinition =>
  processBlock(type, displayName, `${displayName} (model-only): preserved and displayed; its backing ${type} tag is modelled for review, but it is never simulated.`, [
    backingTag(type),
  ]);

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

// --- Drives & filters family (model-only) ----------------------------------
// The remaining signal-conditioning function blocks (the controller "Drives &
// Filters" group). Each is backed by a predefined process structure tag of its
// own datatype that the block owns and updates, identical in shape to SCL/TOT
// above, so each reuses process1's single backing-tag write review operand and
// stays a model-only pass-through — closed-loop filtering/integration has no
// controller-faithful offline execution and must never be faked.
export const DERV = process1("DERV", "Derivative");
export const INTG = process1("INTG", "Integrator");
export const HPF = process1("HPF", "High Pass Filter");
export const LPF = process1("LPF", "Low Pass Filter");
export const NTCH = process1("NTCH", "Notch Filter");
export const RLIM = process1("RLIM", "Rate Limiter");
export const SCRV = process1("SCRV", "S-Curve");
export const LDL2 = process1("LDL2", "Second-Order Lead-Lag");
export const PI = process1("PI", "Proportional + Integral");

// --- Select / limit & discrete-state family (model-only) -------------------
// The remaining "Select/Limit" signal-routing function blocks (SEL/ESEL/SSUM/
// SNEG — MUX and HLL already live in the loop family above), the discrete-state
// device blocks (D2SD/D3SD) and the function generator (FGEN). Each is backed by
// a predefined process structure tag of its own datatype that the block owns and
// updates — identical in shape to SCL/TOT above — so each reuses process1's
// single backing-tag write review operand and stays a model-only pass-through.
// Selection/limiting against a held output, discrete-device state arbitration and
// breakpoint-table generation are signal-conditioning behaviours with no
// controller-faithful offline execution and must never be faked.
export const SEL = process1("SEL", "Select");
export const ESEL = process1("ESEL", "Enhanced Select");
export const SSUM = process1("SSUM", "Selected Summer");
export const SNEG = process1("SNEG", "Selected Negate");
export const D2SD = process1("D2SD", "Discrete 2-State Device");
export const D3SD = process1("D3SD", "Discrete 3-State Device");
export const FGEN = process1("FGEN", "Function Generator");

// --- Vendor process-library / device AOI calls (model-only) ----------------
// These are real raC_/raP_ library object calls seen in large process-library
// L5X exports. They are recognized so imports, validation, search and display
// do not treat them as unknown instructions, but no faceplate/device-profile
// behaviour is simulated.
export const RAC_DVC_PF755 = processLibraryBlock("RAC_DVC_PF755", "raC AC Drive Device");
export const RAC_OPR_PF755_ENERGY = processLibraryBlock("RAC_OPR_PF755_ENERGY", "raC AC Drive Energy");
export const RAP_DVC_LGXCHANGEDET = processLibraryBlock("RAP_DVC_LGXCHANGEDET", "raP Controller Change Detection");
export const RAP_DVC_LGXCPU_5X80 = processLibraryBlock("RAP_DVC_LGXCPU_5X80", "raP Controller CPU 5580");
export const RAP_DVC_LGXREDUN = processLibraryBlock("RAP_DVC_LGXREDUN", "raP Controller Redundancy");
export const RAP_DVC_LGXTASKMON = processLibraryBlock("RAP_DVC_LGXTASKMON", "raP Controller Task Monitor");
export const RAP_OPR_EXTDDALM = processLibraryBlock("RAP_OPR_EXTDDALM", "raP Operator External Digital Alarm");
export const RAP_OPR_ORGSCAN = processLibraryBlock("RAP_OPR_ORGSCAN", "raP Operator Organization Scan");
export const RAP_OPR_ORGVIEW = processLibraryBlock("RAP_OPR_ORGVIEW", "raP Operator Organization View");
export const RAP_TEC_PARRPT = processLibraryBlock("RAP_TEC_PARRPT", "raP Technology Parameter Report");

export const PROCESS_LIBRARY_INSTRUCTIONS: InstructionDefinition[] = [
  RAC_DVC_PF755,
  RAC_OPR_PF755_ENERGY,
  RAP_DVC_LGXCHANGEDET,
  RAP_DVC_LGXCPU_5X80,
  RAP_DVC_LGXREDUN,
  RAP_DVC_LGXTASKMON,
  RAP_OPR_EXTDDALM,
  RAP_OPR_ORGSCAN,
  RAP_OPR_ORGVIEW,
  RAP_TEC_PARRPT,
];

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
  DERV,
  INTG,
  HPF,
  LPF,
  NTCH,
  RLIM,
  SCRV,
  LDL2,
  PI,
  SEL,
  ESEL,
  SSUM,
  SNEG,
  D2SD,
  D3SD,
  FGEN,
  ...PROCESS_LIBRARY_INSTRUCTIONS,
];
