import type { InstructionCategory, InstructionDefinition, InstructionOperandDefinition } from "./types";

/**
 * Equipment Phase (PhaseManager) instructions. Every one is **model-only**:
 * registered so PhaseManager / batch-sequencing routines in a real L5X parse,
 * render, validate (as info, never an error) and round-trip with operands
 * preserved — but never simulated.
 *
 * Equipment-phase logic is driven by the PhaseManager state machine
 * (Idle/Running/Held/Stopping/… transitions, command arbitration, external
 * sequencer/FactoryTalk Batch requests). None of that state engine exists
 * offline, and faking a phase state change would misrepresent how the program
 * runs on a controller, so the executor is a strict pass-through that touches no
 * tag memory. These instructions reuse the existing "program-control" category
 * (they gate and report program/sequence flow) rather than introducing a new
 * palette category. They are preserved for review only.
 *
 * The external command / attach blocks still declare the equipment phase (or, for
 * PXRQ, the PHASE_INSTRUCTION control tag) they own and update as a single write
 * review operand, so that owned object surfaces in the property panel and as a
 * destructive reference in tag cross-reference — see the operand helpers below.
 */

function phaseBlock(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "program-control" as InstructionCategory,
    description: `${description} (equipment phase, model-only): preserved and displayed for review; the PhaseManager state machine is never simulated.`,
    operands,
    fidelity: {
      status: "review-only",
      summary: `${description} is preserved for PhaseManager review only; the offline runtime does not run the phase state engine.`,
      limitations: [
        "no PhaseManager state engine",
        "no phase command dispatch",
        "no phase failure handling",
        "no ownership arbitration or external request handling",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

/**
 * Phase review operands. The external command / attach blocks
 * (PATT/PDET/PCMD/POVR/PCLF) name the EQUIPMENT_PHASE they command and whose
 * state they update as their leading operand, and PXRQ names the
 * PHASE_INSTRUCTION control tag it owns and updates — mirroring the motion,
 * alarm and process signal-conditioning families. Declaring that owned object as
 * a single write (destructive) review operand surfaces it in the property panel
 * and as a destructive reference in tag cross-reference, instead of being
 * mis-classified as a plain read; the trailing command-keyword / result operands
 * fall through to opN exactly like the reordered motion forms. The in-phase
 * blocks (PSC/PPD/PRNP) take no operands and PFL's only operand is a failure-code
 * value (typically an immediate), so they declare none. Operand validation is
 * skipped for model-only instructions, so allowedTypes only informs the editor
 * and no false "undefined tag" finding is ever produced.
 */
const phaseObject: InstructionOperandDefinition = {
  name: "phase",
  label: "Equipment Phase",
  required: true,
  allowedTypes: ["EQUIPMENT_PHASE"],
  direction: "write",
  validateOnModelOnly: true,
};
const phaseInstruction: InstructionOperandDefinition = {
  name: "phaseInstruction",
  label: "Phase Instruction",
  required: true,
  allowedTypes: ["PHASE_INSTRUCTION"],
  direction: "write",
  validateOnModelOnly: true,
};

// --- State / command ---
export const PSC = phaseBlock("PSC", "Phase State Complete", "Phase State Complete");
export const PCMD = phaseBlock("PCMD", "Phase Command", "Phase Command", [{ ...phaseObject }]);
export const POVR = phaseBlock("POVR", "Phase Override Command", "Phase Override Command", [{ ...phaseObject }]);
export const PPD = phaseBlock("PPD", "Phase Paused", "Phase Paused");

// --- Failure handling ---
export const PFL = phaseBlock("PFL", "Phase Failure", "Phase Failure");
export const PCLF = phaseBlock("PCLF", "Phase Clear Failure", "Phase Clear Failure", [{ ...phaseObject }]);

// --- Attach / detach (program ownership of a phase) ---
export const PATT = phaseBlock("PATT", "Attach to Equipment Phase", "Attach to Equipment Phase", [{ ...phaseObject }]);
export const PDET = phaseBlock("PDET", "Detach from Equipment Phase", "Detach from Equipment Phase", [{ ...phaseObject }]);

// --- External requests / parameters ---
export const PXRQ = phaseBlock("PXRQ", "Phase External Request", "Phase External Request", [{ ...phaseInstruction }]);
export const PRNP = phaseBlock("PRNP", "Phase New Parameters", "Phase New Parameters");

/** Every equipment-phase instruction, for bulk registration. */
export const PHASE_INSTRUCTIONS: InstructionDefinition[] = [
  PSC,
  PCMD,
  POVR,
  PPD,
  PFL,
  PCLF,
  PATT,
  PDET,
  PXRQ,
  PRNP,
];
