import type { Controller, PlcProject, Program, Routine, Tag } from "@esco/core";
import { baseTagName, createDefaultRegistry, supportLevel, type InstructionOperandDefinition } from "@esco/instructions";
import { rungNodes, type LadderNode } from "@esco/ladder";
import { getLadder } from "./helpers";

export type EquipmentPhaseReviewStatus =
  | "reviewable"
  | "missing-equipment-phase"
  | "equipment-phase-type-mismatch"
  | "missing-phase-instruction"
  | "phase-instruction-type-mismatch"
  | "incomplete-operands";

export type EquipmentPhaseReviewIssue =
  | "missing-equipment-phase"
  | "equipment-phase-type-mismatch"
  | "missing-phase-instruction"
  | "phase-instruction-type-mismatch"
  | "missing-required-operand";

export type EquipmentPhaseReviewBoundary =
  | "no-phase-state-engine"
  | "no-phase-command-arbitration"
  | "no-phase-ownership-transfer"
  | "no-batch-sequencer-requests"
  | "no-runtime-phase-parameter-transfer"
  | "no-controller-verified-phase-scheduling"
  | "offline-phase-state-timing-preview-only";

export type EquipmentPhaseOperandRole =
  | "equipment-phase"
  | "phase-instruction"
  | "phase-command"
  | "external-request"
  | "failure-code"
  | "review-operand";

export type EquipmentPhaseTransitionFamily =
  | "ownership"
  | "command"
  | "state-feedback"
  | "failure"
  | "external-request"
  | "parameter";

export interface EquipmentPhaseTransitionReview {
  instructionType: string;
  family: EquipmentPhaseTransitionFamily;
  label: string;
  detail: string;
  stateTransitionModelled: false;
  offlineStateTransitionPreviewModelled: boolean;
  runtimeWriteModelled: false;
}

export interface EquipmentPhaseStateTimingPreview {
  fromState: string;
  toState: string;
  nominalDurationMs: number;
  scanWindowMs: number;
  stepLabel: string;
  source: "instruction-family";
  phaseStateEngineModelled: false;
  commandArbitrationModelled: false;
  runtimeWriteModelled: false;
  controllerVerified: false;
  message: string;
}

export interface EquipmentPhaseOfflinePreview {
  available: boolean;
  status: "previewable" | "blocked";
  stateEvidence: string;
  timingSource: "instruction-family" | "none";
  estimatedOnly: true;
  controllerTimingModelled: false;
  runtimeWritesModelled: false;
  executionModelled: false;
  message: string;
}

export interface EquipmentPhaseReference {
  path: string;
  baseTag: string;
  programName?: string;
  resolved: boolean;
  scope: "controller" | "program" | "qualified-program" | "unresolved";
  tagId?: string;
  tagName?: string;
  dataType?: string;
  expectedTypes?: string[];
  typeMatches?: boolean;
}

export interface EquipmentPhaseOperandReview {
  index: number;
  name: string;
  label: string;
  value: string;
  role: EquipmentPhaseOperandRole;
  direction: "read" | "write";
  required: boolean;
  declared: boolean;
  missingRequiredValue: boolean;
  references: EquipmentPhaseReference[];
}

export interface EquipmentPhaseReviewRow {
  controllerId: string;
  controllerName: string;
  programId: string;
  programName: string;
  routineId: string;
  routineName: string;
  rungId: string;
  rungNumber: number;
  instructionType: string;
  displayName: string;
  status: EquipmentPhaseReviewStatus;
  issues: EquipmentPhaseReviewIssue[];
  targetKind?: "equipment-phase" | "phase-instruction";
  targetTag?: string;
  targetDataType?: string;
  modelOnly: true;
  phaseStateEngineModelled: false;
  offlineStateTimingPreviewModelled: boolean;
  timingPreviewModelled: boolean;
  commandArbitrationModelled: false;
  ownershipTransferModelled: false;
  batchSequencerRequestsModelled: false;
  runtimeParameterTransferModelled: false;
  transition: EquipmentPhaseTransitionReview;
  stateTimingPreview: EquipmentPhaseStateTimingPreview;
  offlinePreview: EquipmentPhaseOfflinePreview;
  boundaries: EquipmentPhaseReviewBoundary[];
  operands: EquipmentPhaseOperandReview[];
  message: string;
}

export interface EquipmentPhaseReviewReport {
  rows: EquipmentPhaseReviewRow[];
  instructionCount: number;
  reviewableCount: number;
  issueCount: number;
  equipmentPhaseInstructionCount: number;
  phaseInstructionRequestCount: number;
  inPhaseInstructionCount: number;
  missingEquipmentPhaseCount: number;
  equipmentPhaseTypeMismatchCount: number;
  missingPhaseInstructionCount: number;
  phaseInstructionTypeMismatchCount: number;
  incompleteOperandCount: number;
  stateTimingPreviewCount: number;
  nominalPreviewDurationMsTotal: number;
  warnings: string[];
}

const registry = createDefaultRegistry();

const PHASE_TYPES = new Set(["PSC", "PCMD", "POVR", "PPD", "PFL", "PCLF", "PATT", "PDET", "PXRQ", "PRNP"]);

const BOUNDARIES: EquipmentPhaseReviewBoundary[] = [
  "no-phase-state-engine",
  "no-phase-command-arbitration",
  "no-phase-ownership-transfer",
  "no-batch-sequencer-requests",
  "no-runtime-phase-parameter-transfer",
  "no-controller-verified-phase-scheduling",
  "offline-phase-state-timing-preview-only",
];

interface TagPath {
  path: string;
  baseTag: string;
  programName?: string;
}

function tagPath(value: string): TagPath | undefined {
  const trimmed = value.trim();
  const qualified = trimmed.match(/^Program:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
  if (qualified) {
    return {
      path: trimmed,
      programName: qualified[1],
      baseTag: qualified[2]!,
    };
  }
  const base = baseTagName(trimmed);
  if (!base) return undefined;
  return { path: trimmed, baseTag: base };
}

function sameDataType(actual: string | undefined, expected: string): boolean {
  return actual?.toUpperCase() === expected.toUpperCase();
}

function reference(path: TagPath, tag: Tag | undefined, scope: EquipmentPhaseReference["scope"]): EquipmentPhaseReference {
  return {
    path: path.path,
    baseTag: path.baseTag,
    programName: path.programName,
    resolved: Boolean(tag),
    scope,
    tagId: tag?.id,
    tagName: tag?.name,
    dataType: tag?.dataType,
  };
}

function resolveTag(controller: Controller, program: Program, value: string): EquipmentPhaseReference | undefined {
  const path = tagPath(value);
  if (!path) return undefined;

  if (path.programName) {
    const targetProgram = controller.programs.find((candidate) => candidate.name === path.programName);
    const tag = targetProgram?.programTags.find((candidate) => candidate.name === path.baseTag);
    return reference(path, tag, tag ? "qualified-program" : "unresolved");
  }

  const local = program.programTags.find((candidate) => candidate.name === path.baseTag);
  if (local) return reference(path, local, "program");
  const controllerTag = controller.controllerTags.find((candidate) => candidate.name === path.baseTag);
  if (controllerTag) return reference(path, controllerTag, "controller");
  return reference(path, undefined, "unresolved");
}

function operandRole(
  instructionType: string,
  index: number,
  operandDef: InstructionOperandDefinition | undefined,
): EquipmentPhaseOperandRole {
  if (operandDef?.allowedTypes?.includes("EQUIPMENT_PHASE")) return "equipment-phase";
  if (operandDef?.allowedTypes?.includes("PHASE_INSTRUCTION")) return "phase-instruction";
  if (instructionType === "PXRQ" && index === 1) return "external-request";
  if ((instructionType === "PCMD" || instructionType === "POVR") && index === 1) return "phase-command";
  if (instructionType === "PFL" && index === 0) return "failure-code";
  return "review-operand";
}

function describeOperand(
  controller: Controller,
  program: Program,
  node: LadderNode,
  index: number,
  operandDef: InstructionOperandDefinition | undefined,
): EquipmentPhaseOperandReview {
  const operand = node.operands[index];
  const value = operand?.value.trim() ?? "";
  const role = operandRole(node.instructionType, index, operandDef);
  const references: EquipmentPhaseReference[] = [];

  if (operandDef?.allowedTypes?.length && value) {
    const resolved = resolveTag(controller, program, value);
    if (resolved) {
      resolved.expectedTypes = [...operandDef.allowedTypes];
      resolved.typeMatches = operandDef.allowedTypes.some((expected) => sameDataType(resolved.dataType, expected));
      references.push(resolved);
    }
  }

  return {
    index,
    name: operandDef?.name ?? operand?.name ?? `op${index}`,
    label: operandDef?.label ?? operand?.name ?? `op${index}`,
    value,
    role,
    direction: operandDef?.direction ?? "read",
    required: operandDef?.required ?? false,
    declared: Boolean(operandDef),
    missingRequiredValue: Boolean(operandDef?.required && !value),
    references,
  };
}

function issuesFor(operands: EquipmentPhaseOperandReview[]): EquipmentPhaseReviewIssue[] {
  const issues: EquipmentPhaseReviewIssue[] = [];
  for (const operand of operands) {
    const ref = operand.references[0];
    if (operand.missingRequiredValue) {
      if (operand.role === "equipment-phase") issues.push("missing-equipment-phase");
      else if (operand.role === "phase-instruction") issues.push("missing-phase-instruction");
      else issues.push("missing-required-operand");
      continue;
    }
    if (operand.role === "equipment-phase") {
      if (!ref?.resolved) issues.push("missing-equipment-phase");
      else if (ref.typeMatches === false) issues.push("equipment-phase-type-mismatch");
    }
    if (operand.role === "phase-instruction") {
      if (!ref?.resolved) issues.push("missing-phase-instruction");
      else if (ref.typeMatches === false) issues.push("phase-instruction-type-mismatch");
    }
  }
  return [...new Set(issues)];
}

function statusFor(issues: EquipmentPhaseReviewIssue[]): EquipmentPhaseReviewStatus {
  if (issues.includes("missing-equipment-phase")) return "missing-equipment-phase";
  if (issues.includes("equipment-phase-type-mismatch")) return "equipment-phase-type-mismatch";
  if (issues.includes("missing-phase-instruction")) return "missing-phase-instruction";
  if (issues.includes("phase-instruction-type-mismatch")) return "phase-instruction-type-mismatch";
  if (issues.includes("missing-required-operand")) return "incomplete-operands";
  return "reviewable";
}

function issueLabel(issue: EquipmentPhaseReviewIssue): string {
  switch (issue) {
    case "missing-equipment-phase":
      return "missing imported EQUIPMENT_PHASE tag";
    case "equipment-phase-type-mismatch":
      return "phase operand is not an EQUIPMENT_PHASE tag";
    case "missing-phase-instruction":
      return "missing imported PHASE_INSTRUCTION tag";
    case "phase-instruction-type-mismatch":
      return "PXRQ operand is not a PHASE_INSTRUCTION tag";
    case "missing-required-operand":
      return "missing required phase operand";
  }
}

function targetOperand(operands: EquipmentPhaseOperandReview[]): EquipmentPhaseOperandReview | undefined {
  return operands.find((operand) => operand.role === "equipment-phase" || operand.role === "phase-instruction");
}

function targetKind(operand: EquipmentPhaseOperandReview | undefined): EquipmentPhaseReviewRow["targetKind"] | undefined {
  if (operand?.role === "equipment-phase") return "equipment-phase";
  if (operand?.role === "phase-instruction") return "phase-instruction";
  return undefined;
}

function transitionReview(instructionType: string): EquipmentPhaseTransitionReview {
  const base = {
    instructionType,
    stateTransitionModelled: false as const,
    offlineStateTransitionPreviewModelled: true,
    runtimeWriteModelled: false as const,
  };
  switch (instructionType) {
    case "PATT":
      return {
        ...base,
        family: "ownership",
        label: "Attach ownership",
        detail: "Imported attach evidence is preserved; program ownership is not transferred offline.",
      };
    case "PDET":
      return {
        ...base,
        family: "ownership",
        label: "Detach ownership",
        detail: "Imported detach evidence is preserved; program ownership is not released offline.",
      };
    case "PCMD":
      return {
        ...base,
        family: "command",
        label: "Command request",
        detail: "Imported command request evidence is preserved; command arbitration and phase state changes are not executed.",
      };
    case "POVR":
      return {
        ...base,
        family: "command",
        label: "Override command request",
        detail: "Imported override evidence is preserved; no override command is sent to a phase owner.",
      };
    case "PSC":
      return {
        ...base,
        family: "state-feedback",
        label: "State complete indication",
        detail: "Imported state-complete evidence is preserved; no phase step completion or state transition is committed.",
      };
    case "PPD":
      return {
        ...base,
        family: "state-feedback",
        label: "Paused indication",
        detail: "Imported paused-state evidence is preserved; the offline runtime does not drive a held or paused state.",
      };
    case "PFL":
      return {
        ...base,
        family: "failure",
        label: "Failure report",
        detail: "Imported failure evidence is preserved; phase fault state, failure code writes, and alarm side effects are not executed.",
      };
    case "PCLF":
      return {
        ...base,
        family: "failure",
        label: "Clear failure request",
        detail: "Imported clear-failure evidence is preserved; phase fault clearing is not executed.",
      };
    case "PXRQ":
      return {
        ...base,
        family: "external-request",
        label: "External request / parameter handoff",
        detail: "Imported external request evidence is preserved; batch requests and parameter transfer are not executed.",
      };
    case "PRNP":
      return {
        ...base,
        family: "parameter",
        label: "New parameters notification",
        detail: "Imported new-parameter evidence is preserved; runtime parameter transfer is not executed.",
      };
    default:
      return {
        ...base,
        family: "state-feedback",
        label: "Phase state evidence",
        detail: "Imported PhaseManager evidence is preserved for offline review only.",
      };
  }
}

function stateTimingPreview(transition: EquipmentPhaseTransitionReview): EquipmentPhaseStateTimingPreview {
  const pathByFamily: Record<EquipmentPhaseTransitionFamily, { fromState: string; toState: string; nominalDurationMs: number }> = {
    ownership: {
      fromState: transition.instructionType === "PDET" ? "Owned" : "Unowned",
      toState: transition.instructionType === "PDET" ? "Unowned" : "Owned",
      nominalDurationMs: 100,
    },
    command: { fromState: "Owned", toState: "Command queued", nominalDurationMs: 100 },
    "state-feedback": { fromState: "Running", toState: transition.instructionType === "PPD" ? "Paused" : "Complete", nominalDurationMs: 250 },
    failure: { fromState: transition.instructionType === "PCLF" ? "Failed" : "Running", toState: transition.instructionType === "PCLF" ? "Cleared" : "Failed", nominalDurationMs: 150 },
    "external-request": { fromState: "Request idle", toState: "Request pending", nominalDurationMs: 200 },
    parameter: { fromState: "Parameters idle", toState: "Parameters available", nominalDurationMs: 100 },
  };
  const path = pathByFamily[transition.family];
  const scanWindowMs = Math.max(path.nominalDurationMs, 100);
  return {
    ...path,
    scanWindowMs,
    stepLabel: transition.label,
    source: "instruction-family",
    phaseStateEngineModelled: false,
    commandArbitrationModelled: false,
    runtimeWriteModelled: false,
    controllerVerified: false,
    message: `${transition.label} preview maps ${path.fromState} -> ${path.toState} over a nominal ${path.nominalDurationMs} ms offline review window; no PhaseManager state engine, arbitration, ownership transfer, batch request, or runtime write is executed.`,
  };
}

function phaseOfflinePreview(
  issues: readonly EquipmentPhaseReviewIssue[],
  targetTag: string | undefined,
  stateTiming: EquipmentPhaseStateTimingPreview,
): EquipmentPhaseOfflinePreview {
  if (issues.length > 0) {
    return {
      available: false,
      status: "blocked",
      stateEvidence: targetTag ? `${targetTag} PhaseManager metadata requires cleanup before preview.` : "Phase target is unresolved.",
      timingSource: "none",
      estimatedOnly: true,
      controllerTimingModelled: false,
      runtimeWritesModelled: false,
      executionModelled: false,
      message: "Offline phase state/timing preview is blocked until the PhaseManager target metadata resolves.",
    };
  }
  return {
    available: true,
    status: "previewable",
    stateEvidence: `${stateTiming.stepLabel} maps ${stateTiming.fromState} -> ${stateTiming.toState}.`,
    timingSource: "instruction-family",
    estimatedOnly: true,
    controllerTimingModelled: false,
    runtimeWritesModelled: false,
    executionModelled: false,
    message: `Offline phase preview estimates ${stateTiming.nominalDurationMs} ms for ${stateTiming.fromState} -> ${stateTiming.toState}; no PhaseManager state engine, command arbitration, ownership transfer, batch request, or runtime write is executed.`,
  };
}

function messageFor(row: Omit<EquipmentPhaseReviewRow, "message">): string {
  if (row.issues.length) {
    return `${row.instructionType} PhaseManager metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.targetTag) {
    return `${row.instructionType} target "${row.targetTag}" is reviewable offline as ${row.transition.label.toLowerCase()} with a ${row.stateTimingPreview.nominalDurationMs} ms state/timing preview; the PhaseManager state engine, command arbitration, and ownership transfer are not executed.`;
  }
  return `${row.instructionType} is reviewable offline as ${row.transition.label.toLowerCase()} with a ${row.stateTimingPreview.nominalDurationMs} ms state/timing preview; the PhaseManager state engine and controller scheduling are not executed.`;
}

function phaseRow(input: {
  controller: Controller;
  program: Program;
  routine: Routine;
  rungId: string;
  rungNumber: number;
  node: LadderNode;
}): EquipmentPhaseReviewRow | undefined {
  const { controller, program, routine, rungId, rungNumber, node } = input;
  const def = registry.get(node.instructionType);
  if (!def || supportLevel(def) !== "model-only" || !PHASE_TYPES.has(def.type)) return undefined;

  const count = Math.max(def.operands.length, node.operands.length);
  const operands = Array.from({ length: count }, (_unused, index) =>
    describeOperand(controller, program, node, index, def.operands[index]),
  );
  const issues = issuesFor(operands);
  const target = targetOperand(operands);
  const targetReference = target?.references[0];
  const transition = transitionReview(def.type);
  const stateTiming = stateTimingPreview(transition);
  const targetTag = target?.value || targetReference?.baseTag;
  const offlinePreview = phaseOfflinePreview(issues, targetTag, stateTiming);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program.id,
    programName: program.name,
    routineId: routine.id,
    routineName: routine.name,
    rungId,
    rungNumber,
    instructionType: def.type,
    displayName: def.displayName,
    status: statusFor(issues),
    issues,
    targetKind: targetKind(target),
    targetTag,
    targetDataType: targetReference?.dataType,
    modelOnly: true as const,
    phaseStateEngineModelled: false as const,
    offlineStateTimingPreviewModelled: offlinePreview.available,
    timingPreviewModelled: offlinePreview.available,
    commandArbitrationModelled: false as const,
    ownershipTransferModelled: false as const,
    batchSequencerRequestsModelled: false as const,
    runtimeParameterTransferModelled: false as const,
    transition,
    stateTimingPreview: stateTiming,
    offlinePreview,
    boundaries: BOUNDARIES,
    operands,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function equipmentPhaseReviewReport(project: PlcProject): EquipmentPhaseReviewReport {
  const rows: EquipmentPhaseReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const row = phaseRow({
              controller,
              program,
              routine,
              rungId: rung.id,
              rungNumber: rung.number,
              node,
            });
            if (row) rows.push(row);
          }
        }
      }
    }
  }

  const hasIssue = (issue: EquipmentPhaseReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    instructionCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    equipmentPhaseInstructionCount: rows.filter((row) => row.targetKind === "equipment-phase").length,
    phaseInstructionRequestCount: rows.filter((row) => row.targetKind === "phase-instruction").length,
    inPhaseInstructionCount: rows.filter((row) => row.targetKind == null).length,
    missingEquipmentPhaseCount: hasIssue("missing-equipment-phase"),
    equipmentPhaseTypeMismatchCount: hasIssue("equipment-phase-type-mismatch"),
    missingPhaseInstructionCount: hasIssue("missing-phase-instruction"),
    phaseInstructionTypeMismatchCount: hasIssue("phase-instruction-type-mismatch"),
    incompleteOperandCount: hasIssue("missing-required-operand"),
    stateTimingPreviewCount: rows.filter((row) => row.offlineStateTimingPreviewModelled).length,
    nominalPreviewDurationMsTotal: rows.reduce((sum, row) => sum + (row.offlineStateTimingPreviewModelled ? row.stateTimingPreview.nominalDurationMs : 0), 0),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
