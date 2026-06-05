import type { LadderNode } from "@esco/ladder";
import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

const FBD_ONESHOT_OPERANDS = [
  { name: "shot", label: "FBD_ONESHOT Tag", required: true, allowedTypes: ["FBD_ONESHOT"], direction: "write" as const },
];

function validateShotOperand(node: LadderNode): string[] {
  return node.operands[0]?.value ? [] : ["Operand 'shot' is required."];
}

function executeOneShot(node: LadderNode, ctx: Parameters<InstructionDefinition["execute"]>[1], edge: "rising" | "falling"): boolean {
  const shot = operandValue(node, 0);
  if (!shot) return ctx.rungIn;

  const inputPath = `${shot}.InputBit`;
  const outputPath = `${shot}.OutputBit`;
  const enableOutPath = `${shot}.EnableOut`;
  const previousPath = `${shot}.__escoPreviousInput`;
  const initializedPath = `${shot}.__escoInitialized`;

  if (!ctx.rungIn) {
    ctx.writeBool(enableOutPath, false);
    ctx.writeBool(outputPath, false);
    return false;
  }

  const input = ctx.readBool(inputPath);
  const initialized = ctx.readBool(initializedPath);
  const previous = ctx.readBool(previousPath);
  const pulse = initialized && (edge === "rising" ? input && !previous : !input && previous);

  ctx.writeBool(enableOutPath, true);
  ctx.writeBool(outputPath, pulse);
  ctx.writeBool(previousPath, input);
  ctx.writeBool(initializedPath, true);
  return true;
}

export const OSRI: InstructionDefinition = {
  type: "OSRI",
  displayName: "One Shot Rising with Input",
  category: "bit",
  description:
    "One Shot Rising with Input: offline partial simulation for the documented FBD_ONESHOT structure form. Pulses OutputBit for one scan when InputBit transitions false to true while the instruction is enabled.",
  operands: FBD_ONESHOT_OPERANDS,
  fidelity: {
    status: "executable-partial",
    summary:
      "Simulates the documented FBD_ONESHOT InputBit/OutputBit edge behavior offline; no controller firmware, FBD sheet scheduling, or hardware execution is implied.",
    limitations: [
      "offline edge/history model only",
      "no firmware-faithful function-block scheduler",
      "legacy two-bit OSRI imports should be reviewed and converted to FBD_ONESHOT form",
    ],
  },
  validate: validateShotOperand,
  execute: (node, ctx) => executeOneShot(node, ctx, "rising"),
  render: { symbol: "OSRI", style: "box" },
};

export const OSFI: InstructionDefinition = {
  type: "OSFI",
  displayName: "One Shot Falling with Input",
  category: "bit",
  description:
    "One Shot Falling with Input: offline partial simulation for the documented FBD_ONESHOT structure form. Pulses OutputBit for one scan when InputBit transitions true to false while the instruction is enabled.",
  operands: FBD_ONESHOT_OPERANDS,
  fidelity: {
    status: "executable-partial",
    summary:
      "Simulates the documented FBD_ONESHOT InputBit/OutputBit falling-edge behavior offline; no controller firmware, FBD sheet scheduling, or hardware execution is implied.",
    limitations: [
      "offline edge/history model only",
      "no firmware-faithful function-block scheduler",
      "legacy two-bit OSFI imports should be reviewed and converted to FBD_ONESHOT form",
    ],
  },
  validate: validateShotOperand,
  execute: (node, ctx) => executeOneShot(node, ctx, "falling"),
  render: { symbol: "OSFI", style: "box" },
};

export const FBD_ONE_SHOT_INSTRUCTIONS: InstructionDefinition[] = [OSRI, OSFI];
