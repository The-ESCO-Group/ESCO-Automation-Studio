import type {
  InstructionCategory,
  InstructionDefinition,
  InstructionOperandDefinition,
} from "./types";

/**
 * Model-only extended instructions from the Logix instruction set that cannot be
 * faithfully simulated offline in one pass, registered so real L5X imports parse,
 * render, validate (as info, never an error), and preserve their operands instead
 * of being flagged "unsupported".
 *
 * Two groups live here:
 *
 *  1. Function-block timer / counter variants (TONR, TOFR, RTOR, CTUD). These
 *     have explicit enable / reset / direction pins and backing FBD structures
 *     that the RLL rung-power executor cannot represent without inventing
 *     semantics. Mapping rung power onto, say, a CTUD's separate up/down enables
 *     would silently corrupt the counter image — so they are preserved
 *     model-only with their operands declared for display and cross-reference,
 *     and their execute is a strict pass-through (returns rung-in unchanged,
 *     never touches tag memory). The OSRI/OSFI FBD_ONESHOT structure form is
 *     small enough for partial offline edge simulation and lives in
 *     fbd-one-shot.ts.
 *
 *  2. System / debug / external-flow instructions (ASO, BPT, TPT, LV, JXR, REF,
 *     UNK). These would perform a hardware I/O refresh, hit a debugger
 *     breakpoint/trace point, call an external routine, or carry vendor-specific
 *     behaviour that has no safe offline equivalent. They are preserved
 *     model-only and never perform any side effect.
 *
 * None of these is simulated. The `modelOnly` flag drives the UI/validator
 * labelling; the executor still calls `execute`, which here only returns rung-in.
 */

function modelOnly(
  type: string,
  displayName: string,
  category: InstructionCategory,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category,
    description,
    operands,
    fidelity: {
      status: "model-only",
      summary: description,
      limitations: [
        "pass-through rung execution only",
        "no function-block pin scheduler",
        "no runtime tag-memory side effects",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

const writeOperand = (name: string, label: string, allowedTypes?: string[]): InstructionOperandDefinition => ({
  name,
  label,
  required: true,
  ...(allowedTypes ? { allowedTypes } : {}),
  direction: "write",
});
const readOperand = (name: string, label: string, allowedTypes?: string[]): InstructionOperandDefinition => ({
  name,
  label,
  required: true,
  ...(allowedTypes ? { allowedTypes } : {}),
  direction: "read",
});

// --- 1. Function-block timer / counter variants (state preserved, not simulated) ---

export const TONR = modelOnly(
  "TONR",
  "Timer On Delay with Reset",
  "timer",
  "Timer On Delay with Reset (model-only): the timer structure and preset are preserved and displayed; the function-block timer with its reset pin is not simulated offline.",
  [writeOperand("timer", "Timer", ["TIMER", "FBD_TIMER"]), readOperand("preset", "Preset (ms)", ["DINT"])],
);
export const TOFR = modelOnly(
  "TOFR",
  "Timer Off Delay with Reset",
  "timer",
  "Timer Off Delay with Reset (model-only): the timer structure and preset are preserved and displayed; the function-block timer with its reset pin is not simulated offline.",
  [writeOperand("timer", "Timer", ["TIMER", "FBD_TIMER"]), readOperand("preset", "Preset (ms)", ["DINT"])],
);
export const RTOR = modelOnly(
  "RTOR",
  "Retentive Timer On with Reset",
  "timer",
  "Retentive Timer On with Reset (model-only): the retentive timer structure and preset are preserved and displayed; the function-block timer with its reset pin is not simulated offline.",
  [writeOperand("timer", "Timer", ["TIMER", "FBD_TIMER"]), readOperand("preset", "Preset (ms)", ["DINT"])],
);
export const CTUD = modelOnly(
  "CTUD",
  "Count Up/Down",
  "counter",
  "Count Up/Down (model-only): the up/down counter structure and preset are preserved and displayed; the function-block counter with separate up and down enables is not simulated offline (a single rung-power input cannot represent both directions safely).",
  [writeOperand("counter", "Counter", ["COUNTER", "FBD_COUNTER"]), readOperand("preset", "Preset", ["DINT"])],
);

// --- 2. System / debug / external-flow instructions (no side effects offline) ---

export const ASO = modelOnly(
  "ASO",
  "ASO",
  "message",
  "ASO (model-only): preserved and displayed for review; performs no device, output, or controller side effect offline and is not simulated.",
);
export const BPT = modelOnly(
  "BPT",
  "Breakpoint",
  "program-control",
  "Breakpoint (model-only): preserved and displayed for review; sets no debugger breakpoint and halts no scan offline.",
);
export const TPT = modelOnly(
  "TPT",
  "Trace Point",
  "program-control",
  "Trace Point (model-only): preserved and displayed for review; emits no debug trace and is not simulated offline.",
);
export const LV = modelOnly(
  "LV",
  "LV",
  "program-control",
  "LV (model-only): preserved and displayed for review; performs no offline action and is not simulated.",
);
export const JXR = modelOnly(
  "JXR",
  "Jump to External Routine",
  "program-control",
  "Jump to External Routine (model-only): the external routine reference is preserved and displayed; no external routine is executed offline.",
  [{ name: "routine", label: "External Routine", required: true, isRoutineRef: true }],
);
export const REF = modelOnly(
  "REF",
  "I/O Refresh",
  "program-control",
  "I/O Refresh (model-only): preserved and displayed for review; performs no real I/O scan or hardware refresh offline.",
);
export const UNK = modelOnly(
  "UNK",
  "Unknown (Preserved)",
  "program-control",
  "UNK (model-only): a recognized but unmodelled instruction token, preserved and displayed verbatim for review; performs no action and is not simulated.",
);

/** Every model-only extended instruction, for bulk registration. */
export const MODEL_ONLY_EXTENDED_INSTRUCTIONS: InstructionDefinition[] = [
  TONR, TOFR, RTOR, CTUD,
  ASO, BPT, TPT, LV, JXR, REF, UNK,
];
