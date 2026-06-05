import type { InstructionCategory, InstructionDefinition, InstructionOperandDefinition } from "./types";

/**
 * Sequential Function Chart (SFC) control instructions. Every one is
 * **model-only**: registered so RLL rungs that reset or pause an SFC routine in a
 * real L5X parse, render, validate (as info, never an error) and round-trip with
 * operands preserved — but never simulated.
 *
 * SFC execution is driven by the chart's step/transition state machine
 * (active-step tracking, transition evaluation, action qualifiers, last-scan
 * handling). None of that engine exists offline, and faking a step reset or a
 * chart pause would misrepresent how the program runs on a controller, so the
 * executor is a strict pass-through that touches no tag memory. Like the
 * equipment-phase family (phase.ts), these reuse the existing "program-control"
 * category rather than introducing a new palette category. They are preserved for
 * review only.
 *
 * SFR and SFP both name the SFC routine they act on as their first operand, so —
 * mirroring JSR — that operand is declared as a routine reference (isRoutineRef).
 * This surfaces the controlled routine in the property panel and routine
 * cross-reference instead of being mistaken for an undefined tag; the trailing
 * step / target-state operand falls through to opN. Operand validation is skipped
 * for model-only instructions, so nothing here ever produces a false finding.
 */

const sfcRoutine: InstructionOperandDefinition = {
  name: "sfcRoutine",
  label: "SFC Routine",
  required: true,
  direction: "read",
  isRoutineRef: true,
};

function sfcBlock(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "program-control" as InstructionCategory,
    description: `${description} (SFC control, model-only): preserved and displayed for review; the SFC step/transition engine is never simulated.`,
    operands,
    fidelity: {
      status: "review-only",
      summary: `${description} is preserved for SFC review only; the offline runtime does not run the chart step/transition engine.`,
      limitations: [
        "no SFC step engine",
        "no SFC step reset or pause side effect",
        "no transition marking",
        "no action qualifier or last-scan behavior",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

// SFR(SFCRoutineName, StepName) — resets the named SFC routine to a step.
export const SFR = sfcBlock("SFR", "SFC Reset", "SFC Reset", [{ ...sfcRoutine }]);
// SFP(SFCRoutineName, TargetState) — pauses the named SFC routine.
export const SFP = sfcBlock("SFP", "SFC Pause", "SFC Pause", [{ ...sfcRoutine }]);
// EOT(StorageBit) — marks the end of a transition; its bit operand falls through
// to opN (no routine reference), so it is left a bare pass-through.
export const EOT = sfcBlock("EOT", "End of Transition", "End of Transition");

/** Every SFC control instruction, for bulk registration. */
export const SFC_INSTRUCTIONS: InstructionDefinition[] = [SFR, SFP, EOT];
