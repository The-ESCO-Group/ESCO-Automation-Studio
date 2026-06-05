import type { Controller, IoModule, PlcProject, Program, Routine, Tag } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  describeModelOnlyInstructionReview,
  supportLevel,
  type ModelOnlyInstructionBoundary,
} from "@esco/instructions";
import { rungNodes, type LadderNode } from "@esco/ladder";
import { controllerSafetyInfoReviewReport } from "./controller-safety-info-review";
import { controllerSafetyTagMapReviewReport } from "./controller-safety-tag-map-review";
import { controllerSfcExecutionReviewReport } from "./controller-sfc-review";
import { equipmentPhaseReviewReport } from "./equipment-phase-review";
import { getLadder } from "./helpers";
import { processLoopReviewReport } from "./process-loop-review";
import { safetyMetadataReviewReport } from "./safety-metadata-review";

export type AdvancedDomainKind = "safety" | "motion" | "process" | "phase" | "sfc";

export type AdvancedDomainStatus = "empty" | "reviewable" | "needs-attention";

export type MotionInstructionReviewIssue =
  | "missing-motion-target"
  | "motion-target-type-mismatch"
  | "missing-motion-control"
  | "motion-control-type-mismatch"
  | "missing-required-operand";

export type MotionOperandRole = "motion-target" | "motion-control" | "review-operand";

export interface MotionOperandReview {
  index: number;
  name: string;
  label: string;
  value: string;
  role: MotionOperandRole;
  required: boolean;
  direction: "read" | "write";
  resolved: boolean;
  dataType?: string;
  expectedTypes?: string[];
  typeMatches?: boolean;
}

export interface MotionInstructionReviewRow {
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
  status: "reviewable" | "needs-attention";
  issues: MotionInstructionReviewIssue[];
  modelOnly: true;
  motionCommandModelled: false;
  motionPlannerModelled: false;
  axisStateModelled: false;
  driveCommandModelled: false;
  motionFeedbackModelled: false;
  boundaries: ModelOnlyInstructionBoundary[];
  operands: MotionOperandReview[];
  message: string;
}

export interface AdvancedDomainSummary {
  domain: AdvancedDomainKind;
  label: string;
  status: AdvancedDomainStatus;
  itemCount: number;
  reviewableCount: number;
  issueCount: number;
  warningCount: number;
  boundaryCount: number;
  readinessPercent: number;
  topBoundaries: string[];
  message: string;
}

export type AdvancedDomainDetailRowKind =
  | "safety-partition"
  | "safety-instruction"
  | "controller-safety-info"
  | "controller-safety-tag-map"
  | "controller-sfc-execution"
  | "motion-instruction"
  | "process-instruction"
  | "phase-instruction";

export interface AdvancedDomainDetailRow {
  id: string;
  domain: AdvancedDomainKind;
  domainLabel: string;
  rowKind: AdvancedDomainDetailRowKind;
  subject: string;
  controllerName: string;
  programName?: string;
  routineName?: string;
  rungNumber?: number;
  instructionType?: string;
  objectKind?: string;
  status: string;
  needsAttention: boolean;
  issueCount: number;
  boundaryCount: number;
  boundaries: string[];
  message: string;
  offlinePreview?: AdvancedDomainOfflinePreview;
  offlineOnly: true;
  executionModelled: false;
}

export type AdvancedDomainInspectorKind = "motion-axis" | "process-loop" | "equipment-phase";

export interface AdvancedDomainInspectorDiagnostic {
  status: "ok" | "warning" | "error" | "info";
  label: string;
  detail: string;
}

export type MotionAxisDeviceTreeNodeKind =
  | "controller"
  | "motion-group"
  | "coordinate-system"
  | "axis"
  | "motion-device";

export type MotionAxisDeviceTreeNodeStatus = "reviewable" | "unlinked" | "needs-attention";

export interface MotionAxisDeviceTreeNode {
  id: string;
  controllerName: string;
  kind: MotionAxisDeviceTreeNodeKind;
  name: string;
  dataType?: string;
  parentId?: string;
  parentName?: string;
  childIds: string[];
  commandCount: number;
  moduleCount: number;
  controlTagCount: number;
  issueCount: number;
  status: MotionAxisDeviceTreeNodeStatus;
  diagnostics: AdvancedDomainInspectorDiagnostic[];
  boundaries: string[];
  message: string;
  offlineOnly: true;
  executionModelled: false;
}

export interface MotionAxisDeviceTreeReport {
  nodes: MotionAxisDeviceTreeNode[];
  nodeCount: number;
  motionObjectCount: number;
  axisCount: number;
  coordinateSystemCount: number;
  motionGroupCount: number;
  motionDeviceCount: number;
  linkedDeviceCount: number;
  unlinkedAxisCount: number;
  issueCount: number;
  boundaries: string[];
  message: string;
}

export interface AdvancedDomainInspectorRow {
  id: string;
  domain: Exclude<AdvancedDomainKind, "safety">;
  kind: AdvancedDomainInspectorKind;
  title: string;
  subject: string;
  controllerName: string;
  status: "reviewable" | "needs-attention" | "empty";
  itemCount: number;
  issueCount: number;
  instructionTypes: string[];
  locations: string[];
  dataTypes: string[];
  diagnostics: AdvancedDomainInspectorDiagnostic[];
  diagnosticCount: number;
  diagnosticWarningCount: number;
  diagnosticErrorCount: number;
  boundaries: string[];
  message: string;
  offlinePreview?: AdvancedDomainOfflinePreview;
  offlineOnly: true;
  executionModelled: false;
}

export interface AdvancedDomainInspectorReport {
  rows: AdvancedDomainInspectorRow[];
  rowCount: number;
  reviewableCount: number;
  issueCount: number;
}

export interface AdvancedDomainReviewReport {
  domains: AdvancedDomainSummary[];
  detailRows: AdvancedDomainDetailRow[];
  inspectorReport: AdvancedDomainInspectorReport;
  motionTree: MotionAxisDeviceTreeReport;
  motionRows: MotionInstructionReviewRow[];
  totalItemCount: number;
  reviewableItemCount: number;
  issueCount: number;
  warningCount: number;
  boundaryCount: number;
  readinessPercent: number;
  status: AdvancedDomainStatus;
  warnings: string[];
  boundaries: string[];
}

const registry = createDefaultRegistry();

export interface AdvancedDomainOfflinePreview {
  available: boolean;
  status: "previewable" | "blocked";
  stateEvidence: string;
  timingSource: string;
  estimatedOnly: true;
  controllerTimingModelled: false;
  runtimeWritesModelled: false;
  executionModelled: false;
  message: string;
}

const AXIS_TYPES = [
  "AXIS_GENERIC",
  "AXIS_GENERIC_DRIVE",
  "AXIS_SERVO",
  "AXIS_SERVO_DRIVE",
  "AXIS_VIRTUAL",
  "AXIS_CIP_DRIVE",
  "AXIS_CONSUMED",
];

interface TagPath {
  path: string;
  baseTag: string;
  programName?: string;
}

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
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

function resolveTag(controller: Controller, program: Program, value: string): Tag | undefined {
  const path = tagPath(value);
  if (!path) return undefined;
  if (path.programName) {
    const targetProgram = controller.programs.find((candidate) => candidate.name === path.programName);
    return targetProgram?.programTags.find((candidate) => candidate.name === path.baseTag);
  }
  return (
    program.programTags.find((candidate) => candidate.name === path.baseTag) ??
    controller.controllerTags.find((candidate) => candidate.name === path.baseTag)
  );
}

function motionOperandRole(name: string): MotionOperandRole {
  const normalized = name.toLowerCase();
  if (normalized === "motioncontrol") return "motion-control";
  if (
    normalized === "axis" ||
    normalized === "slaveaxis" ||
    normalized === "masteraxis" ||
    normalized === "coordinatesystem" ||
    normalized === "motiongroup"
  ) {
    return "motion-target";
  }
  return "review-operand";
}

function expectedMotionTypes(name: string): string[] | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "motioncontrol") return ["MOTION_INSTRUCTION"];
  if (normalized === "coordinatesystem") return ["COORDINATE_SYSTEM"];
  if (normalized === "motiongroup") return ["MOTION_GROUP"];
  if (normalized === "axis" || normalized === "slaveaxis" || normalized === "masteraxis") return ["AXIS_*"];
  return undefined;
}

function typeMatches(actual: string | undefined, expected: string[] | undefined): boolean | undefined {
  if (!actual || !expected?.length) return undefined;
  const normalized = actual.toUpperCase();
  if (expected.includes("AXIS_*")) return AXIS_TYPES.includes(normalized) || normalized.startsWith("AXIS_");
  return expected.some((candidate) => candidate.toUpperCase() === normalized);
}

function motionIssues(operands: MotionOperandReview[]): MotionInstructionReviewIssue[] {
  const issues: MotionInstructionReviewIssue[] = [];
  for (const operand of operands) {
    if (!operand.required) continue;
    if (blank(operand.value) || (operand.role !== "review-operand" && !operand.resolved)) {
      if (operand.role === "motion-target") issues.push("missing-motion-target");
      else if (operand.role === "motion-control") issues.push("missing-motion-control");
      else issues.push("missing-required-operand");
      continue;
    }
    if (operand.typeMatches === false) {
      if (operand.role === "motion-target") issues.push("motion-target-type-mismatch");
      else if (operand.role === "motion-control") issues.push("motion-control-type-mismatch");
    }
  }
  return [...new Set(issues)];
}

function motionIssueLabel(issue: MotionInstructionReviewIssue): string {
  switch (issue) {
    case "missing-motion-target":
      return "missing imported motion target tag";
    case "motion-target-type-mismatch":
      return "motion target tag type does not match the commanded object";
    case "missing-motion-control":
      return "missing imported MOTION_INSTRUCTION control tag";
    case "motion-control-type-mismatch":
      return "motion control tag is not a MOTION_INSTRUCTION";
    case "missing-required-operand":
      return "missing required motion review operand";
  }
}

function motionMessage(row: Omit<MotionInstructionReviewRow, "message">): string {
  if (row.issues.length) {
    return `${row.instructionType} motion metadata needs attention: ${row.issues.map(motionIssueLabel).join("; ")}.`;
  }
  return `${row.instructionType} motion operands are reviewable offline; motion planning, axis state, drive command, and feedback effects are not simulated.`;
}

function motionRow(input: {
  controller: Controller;
  program: Program;
  routine: Routine;
  rungId: string;
  rungNumber: number;
  node: LadderNode;
}): MotionInstructionReviewRow | undefined {
  const { controller, program, routine, rungId, rungNumber, node } = input;
  const def = registry.get(node.instructionType);
  if (!def || def.category !== "motion" || supportLevel(def) !== "model-only") return undefined;
  const review = describeModelOnlyInstructionReview(def, node);
  if (!review) return undefined;

  const operands: MotionOperandReview[] = review.operands.map((operand) => {
    const role = motionOperandRole(operand.name);
    const resolvedTag = role === "review-operand" || blank(operand.value)
      ? undefined
      : resolveTag(controller, program, operand.value);
    const expectedTypes = expectedMotionTypes(operand.name);
    return {
      index: operand.index,
      name: operand.name,
      label: operand.label,
      value: operand.value,
      role,
      required: operand.required,
      direction: operand.declaredDirection,
      resolved: Boolean(resolvedTag),
      dataType: resolvedTag?.dataType,
      expectedTypes,
      typeMatches: typeMatches(resolvedTag?.dataType, expectedTypes),
    };
  });
  const issues = motionIssues(operands);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program.id,
    programName: program.name,
    routineId: routine.id,
    routineName: routine.name,
    rungId,
    rungNumber,
    instructionType: review.instructionType,
    displayName: review.displayName,
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    modelOnly: true as const,
    motionCommandModelled: false as const,
    motionPlannerModelled: false as const,
    axisStateModelled: false as const,
    driveCommandModelled: false as const,
    motionFeedbackModelled: false as const,
    boundaries: review.boundaries,
    operands,
  };
  return { ...rowBase, message: motionMessage(rowBase) };
}

export function motionInstructionReviewRows(project: PlcProject): MotionInstructionReviewRow[] {
  const rows: MotionInstructionReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const row = motionRow({
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
  return rows;
}

function readinessPercent(reviewableCount: number, itemCount: number): number {
  if (itemCount === 0) return 100;
  return Math.round((reviewableCount / itemCount) * 100);
}

function domainStatus(itemCount: number, issueCount: number): AdvancedDomainStatus {
  if (itemCount === 0) return "empty";
  return issueCount > 0 ? "needs-attention" : "reviewable";
}

function summaryMessage(domain: AdvancedDomainKind, itemCount: number, issueCount: number): string {
  const label = domain === "phase" ? "Phase" : domain === "sfc" ? "SFC" : domain[0]!.toUpperCase() + domain.slice(1);
  if (itemCount === 0) return `${label} review has no imported model-only items in this project.`;
  if (issueCount > 0) return `${label} review found ${issueCount} item${issueCount === 1 ? "" : "s"} needing attention.`;
  return `${label} review items are resolved for offline review boundaries.`;
}

function domainSummary(input: {
  domain: AdvancedDomainKind;
  label: string;
  itemCount: number;
  reviewableCount: number;
  issueCount: number;
  warnings: string[];
  boundaries: string[];
}): AdvancedDomainSummary {
  const uniqueBoundaries = [...new Set(input.boundaries)].sort();
  return {
    domain: input.domain,
    label: input.label,
    status: domainStatus(input.itemCount, input.issueCount),
    itemCount: input.itemCount,
    reviewableCount: input.reviewableCount,
    issueCount: input.issueCount,
    warningCount: input.warnings.length,
    boundaryCount: uniqueBoundaries.length,
    readinessPercent: readinessPercent(input.reviewableCount, input.itemCount),
    topBoundaries: uniqueBoundaries.slice(0, 5),
    message: summaryMessage(input.domain, input.itemCount, input.issueCount),
  };
}

const detailBase = (input: {
  id: string;
  domain: AdvancedDomainKind;
  domainLabel: string;
  rowKind: AdvancedDomainDetailRowKind;
  subject: string;
  controllerName: string;
  status: string;
  issueCount: number;
  boundaries: string[];
  message: string;
  offlinePreview?: AdvancedDomainOfflinePreview;
  programName?: string;
  routineName?: string;
  rungNumber?: number;
  instructionType?: string;
  objectKind?: string;
}): AdvancedDomainDetailRow => ({
  ...input,
  needsAttention: input.issueCount > 0 || input.status === "needs-attention" || input.status.startsWith("missing-"),
  boundaryCount: [...new Set(input.boundaries)].length,
  boundaries: [...new Set(input.boundaries)].sort(),
  ...(input.offlinePreview ? { offlinePreview: input.offlinePreview } : {}),
  offlineOnly: true,
  executionModelled: false,
});

function inspectorOfflinePreview(previews: readonly AdvancedDomainOfflinePreview[]): AdvancedDomainOfflinePreview | undefined {
  if (!previews.length) return undefined;
  const previewable = previews.filter((preview) => preview.available);
  const selected = previewable[0] ?? previews[0]!;
  if (!previewable.length) return selected;
  return {
    ...selected,
    available: true,
    status: "previewable",
    message: `${previewable.length}/${previews.length} offline preview row${previews.length === 1 ? "" : "s"} are previewable. ${selected.message}`,
  };
}

function advancedDomainDetailRows(input: {
  safety: ReturnType<typeof safetyMetadataReviewReport>;
  safetyInfo: ReturnType<typeof controllerSafetyInfoReviewReport>;
  safetyTagMap: ReturnType<typeof controllerSafetyTagMapReviewReport>;
  sfc: ReturnType<typeof controllerSfcExecutionReviewReport>;
  motionRows: MotionInstructionReviewRow[];
  process: ReturnType<typeof processLoopReviewReport>;
  phase: ReturnType<typeof equipmentPhaseReviewReport>;
}): AdvancedDomainDetailRow[] {
  const rows: AdvancedDomainDetailRow[] = [];

  for (const row of input.safety.partitionRows) {
    rows.push(detailBase({
      id: `safety-partition:${row.objectId}`,
      domain: "safety",
      domainLabel: "Safety",
      rowKind: "safety-partition",
      subject: `${row.objectKind}: ${row.objectName}`,
      controllerName: row.controllerName,
      programName: row.programName,
      objectKind: row.objectKind,
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const [index, row] of input.safety.instructionRows.entries()) {
    rows.push(detailBase({
      id: `safety-instruction:${row.rungId}:${row.instructionType}:${index}`,
      domain: "safety",
      domainLabel: "Safety",
      rowKind: "safety-instruction",
      subject: row.displayName,
      controllerName: row.controllerName,
      programName: row.programName,
      routineName: row.routineName,
      rungNumber: row.rungNumber,
      instructionType: row.instructionType,
      objectKind: "instruction",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const row of input.safetyInfo.rows.filter((candidate) => candidate.safetyInfoPresent)) {
    rows.push(detailBase({
      id: `controller-safety-info:${row.controllerId}`,
      domain: "safety",
      domainLabel: "Safety",
      rowKind: "controller-safety-info",
      subject: "Controller SafetyInfo",
      controllerName: row.controllerName,
      objectKind: "controller",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const row of input.safetyTagMap.rows.filter((candidate) => candidate.safetyTagMapPresent)) {
    rows.push(detailBase({
      id: `controller-safety-tag-map:${row.controllerId}`,
      domain: "safety",
      domainLabel: "Safety",
      rowKind: "controller-safety-tag-map",
      subject: "Controller SafetyTagMap",
      controllerName: row.controllerName,
      objectKind: "controller",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const row of input.sfc.rows.filter((candidate) => candidate.hasSfcMetadata)) {
    rows.push(detailBase({
      id: `controller-sfc-execution:${row.controllerId}`,
      domain: "sfc",
      domainLabel: "SFC",
      rowKind: "controller-sfc-execution",
      subject: "Controller SFC Execution",
      controllerName: row.controllerName,
      objectKind: "controller",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const [index, row] of input.motionRows.entries()) {
    rows.push(detailBase({
      id: `motion:${row.rungId}:${row.instructionType}:${index}`,
      domain: "motion",
      domainLabel: "Motion",
      rowKind: "motion-instruction",
      subject: row.displayName,
      controllerName: row.controllerName,
      programName: row.programName,
      routineName: row.routineName,
      rungNumber: row.rungNumber,
      instructionType: row.instructionType,
      objectKind: "instruction",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
    }));
  }

  for (const [index, row] of input.process.rows.entries()) {
    rows.push(detailBase({
      id: `process:${row.rungId}:${row.instructionType}:${index}`,
      domain: "process",
      domainLabel: "Process",
      rowKind: "process-instruction",
      subject: row.displayName,
      controllerName: row.controllerName,
      programName: row.programName,
      routineName: row.routineName,
      rungNumber: row.rungNumber,
      instructionType: row.instructionType,
      objectKind: "instruction",
      status: row.status,
      issueCount: row.status === "reviewable" ? 0 : 1,
      boundaries: row.boundaries,
      message: row.message,
      offlinePreview: row.offlinePreview,
    }));
  }

  for (const [index, row] of input.phase.rows.entries()) {
    rows.push(detailBase({
      id: `phase:${row.rungId}:${row.instructionType}:${index}`,
      domain: "phase",
      domainLabel: "Phase",
      rowKind: "phase-instruction",
      subject: row.displayName,
      controllerName: row.controllerName,
      programName: row.programName,
      routineName: row.routineName,
      rungNumber: row.rungNumber,
      instructionType: row.instructionType,
      objectKind: "instruction",
      status: row.status,
      issueCount: row.issues.length,
      boundaries: row.boundaries,
      message: row.message,
      offlinePreview: row.offlinePreview,
    }));
  }

  return rows;
}

function locationOf(row: { programName: string; routineName: string; rungNumber: number }): string {
  return `${row.programName} / ${row.routineName} / Rung ${row.rungNumber}`;
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

function inspectorDiagnosticCounts(diagnostics: AdvancedDomainInspectorDiagnostic[]): {
  diagnosticCount: number;
  diagnosticWarningCount: number;
  diagnosticErrorCount: number;
} {
  return {
    diagnosticCount: diagnostics.length,
    diagnosticWarningCount: diagnostics.filter((row) => row.status === "warning").length,
    diagnosticErrorCount: diagnostics.filter((row) => row.status === "error").length,
  };
}

function motionTargetFamily(dataType: string | undefined): { label: string; detail: string; status: AdvancedDomainInspectorDiagnostic["status"] } {
  const normalized = dataType?.toUpperCase();
  if (!normalized) {
    return {
      status: "error",
      label: "Target unresolved",
      detail: "The commanded motion target tag is not resolved in the imported offline tag database.",
    };
  }
  if (normalized === "COORDINATE_SYSTEM") {
    return {
      status: "ok",
      label: "Coordinate system object",
      detail: "Coordinated-motion object metadata is present for review; path planning and interpolation remain unmodelled.",
    };
  }
  if (normalized === "MOTION_GROUP") {
    return {
      status: "ok",
      label: "Motion group object",
      detail: "Motion-group metadata is present for review; group scheduling and servo updates remain unmodelled.",
    };
  }
  if (!normalized.startsWith("AXIS_")) {
    return {
      status: "error",
      label: "Target type mismatch",
      detail: `Target data type ${dataType} is not a supported motion axis, coordinate system, or motion group object.`,
    };
  }
  if (normalized === "AXIS_VIRTUAL") {
    return {
      status: "ok",
      label: "Virtual axis profile",
      detail: "Virtual-axis metadata is resolved for offline review; no axis state integration is executed.",
    };
  }
  if (normalized.includes("DRIVE") || normalized.includes("SERVO") || normalized.includes("CIP")) {
    return {
      status: "ok",
      label: "Drive-backed axis profile",
      detail: "Drive/servo axis metadata is resolved for offline review; ESCO does not command drives or read live feedback.",
    };
  }
  return {
    status: "ok",
    label: "Axis profile",
    detail: `${dataType} metadata is resolved for offline review; motion planner and feedback effects remain unmodelled.`,
  };
}

function motionAxisDiagnostics(
  group: MotionInstructionReviewRow[],
  target: MotionOperandReview | undefined,
  issueCount: number,
): AdvancedDomainInspectorDiagnostic[] {
  const diagnostics: AdvancedDomainInspectorDiagnostic[] = [];
  const family = motionTargetFamily(target?.dataType);
  diagnostics.push(family);

  const controls = group.flatMap((row) => row.operands.filter((operand) => operand.role === "motion-control"));
  const badControls = controls.filter((operand) => operand.required && (!operand.resolved || operand.typeMatches === false));
  if (badControls.length > 0) {
    diagnostics.push({
      status: "error",
      label: "Motion control tag",
      detail: `${badControls.length} command${badControls.length === 1 ? "" : "s"} reference a missing or non-MOTION_INSTRUCTION control tag.`,
    });
  } else if (controls.length > 0) {
    diagnostics.push({
      status: "ok",
      label: "Motion control tags",
      detail: `${controls.length} motion-control operand${controls.length === 1 ? "" : "s"} resolve to MOTION_INSTRUCTION metadata.`,
    });
  } else {
    diagnostics.push({
      status: "info",
      label: "No motion control operand",
      detail: "This command family does not expose a separate MOTION_INSTRUCTION control operand in the current model-only review metadata.",
    });
  }

  diagnostics.push({
    status: issueCount > 0 ? "warning" : "ok",
    label: "Command coverage",
    detail: `${group.length} command${group.length === 1 ? "" : "s"} reviewed: ${uniqueSorted(group.map((row) => row.instructionType)).join(", ")}.`,
  });
  diagnostics.push({
    status: "info",
    label: "Offline boundary",
    detail: "Axis state, planner execution, drive command, and feedback are preserved as boundaries only; no motion is simulated or sent to hardware.",
  });
  return diagnostics;
}

function motionInspectorRows(rows: MotionInstructionReviewRow[]): AdvancedDomainInspectorRow[] {
  const groups = new Map<string, MotionInstructionReviewRow[]>();
  for (const row of rows) {
    const target = row.operands.find((operand) => operand.role === "motion-target");
    const key = `${row.controllerName}:${target?.value || row.rungId}:${target?.dataType ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const first = group[0]!;
    const target = first.operands.find((operand) => operand.role === "motion-target");
    const issueCount = group.reduce((sum, row) => sum + row.issues.length, 0);
    const subject = target?.value || `${first.instructionType} @ ${locationOf(first)}`;
    const diagnostics = motionAxisDiagnostics(group, target, issueCount);
    return {
      id: `motion-axis:${key}`,
      domain: "motion",
      kind: "motion-axis",
      title: "Motion Axis / Object Inspector",
      subject,
      controllerName: first.controllerName,
      status: issueCount > 0 ? "needs-attention" : "reviewable",
      itemCount: group.length,
      issueCount,
      instructionTypes: uniqueSorted(group.map((row) => row.instructionType)),
      locations: uniqueSorted(group.map(locationOf)),
      dataTypes: uniqueSorted(group.map((row) => row.operands.find((operand) => operand.role === "motion-target")?.dataType)),
      diagnostics,
      ...inspectorDiagnosticCounts(diagnostics),
      boundaries: uniqueSorted(group.flatMap((row) => row.boundaries)),
      message: issueCount
        ? `${subject} has ${issueCount} motion review issue${issueCount === 1 ? "" : "s"} across ${group.length} command${group.length === 1 ? "" : "s"}.`
        : `${subject} is resolved for offline motion review across ${group.length} command${group.length === 1 ? "" : "s"}; axis state, planner, drive command, and feedback remain unmodelled.`,
      offlineOnly: true,
      executionModelled: false,
    };
  });
}

function motionObjectKind(dataType: string | undefined): Exclude<MotionAxisDeviceTreeNodeKind, "controller" | "motion-device"> | undefined {
  const normalized = dataType?.toUpperCase();
  if (!normalized) return undefined;
  if (normalized === "MOTION_GROUP") return "motion-group";
  if (normalized === "COORDINATE_SYSTEM") return "coordinate-system";
  if (normalized.startsWith("AXIS_")) return "axis";
  return undefined;
}

function motionDeviceModule(module: IoModule): boolean {
  const haystack = [
    module.name,
    module.catalogNumber,
    module.description,
    module.productType,
    module.productCode,
  ].filter(Boolean).join(" ");
  return /drive|servo|axis|motion|vfd/i.test(haystack);
}

function linkKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function moduleMatchesAxis(module: IoModule, axis: Tag): boolean {
  const axisKey = linkKey(axis.name);
  if (!axisKey) return false;
  const moduleKey = linkKey([
    module.name,
    module.catalogNumber,
    module.description,
    module.commPath,
  ].filter(Boolean).join(" "));
  return moduleKey.includes(axisKey);
}

function controllerMotionTags(controller: Controller): Tag[] {
  return [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ].filter((tag) => motionObjectKind(tag.dataType));
}

function targetValue(row: MotionInstructionReviewRow): string | undefined {
  return row.operands.find((operand) => operand.role === "motion-target")?.value;
}

function rowsForMotionTag(rows: MotionInstructionReviewRow[], controller: Controller, tag: Tag): MotionInstructionReviewRow[] {
  return rows.filter((row) => {
    if (row.controllerId !== controller.id) return false;
    const path = targetValue(row);
    return path ? tagPath(path)?.baseTag === tag.name : false;
  });
}

function motionTreeMessage(input: {
  kind: MotionAxisDeviceTreeNodeKind;
  name: string;
  commandCount: number;
  moduleCount: number;
  issueCount: number;
  unlinkedDriveAxis: boolean;
}): string {
  if (input.kind === "motion-device") {
    return input.moduleCount
      ? `${input.name} is linked into the offline motion device tree for review; ESCO does not open module connections or command hardware.`
      : `${input.name} is preserved as an imported motion device for offline review only.`;
  }
  if (input.issueCount > 0) {
    return `${input.name} has ${input.issueCount} motion tree issue${input.issueCount === 1 ? "" : "s"}; review target, control-tag, and device metadata.`;
  }
  if (input.unlinkedDriveAxis) {
    return `${input.name} is a drive-backed axis without a matching imported motion device/module link.`;
  }
  return `${input.name} is present in the offline motion tree with ${input.commandCount} reviewed command${input.commandCount === 1 ? "" : "s"}; axis state, planning, drive commands, and feedback remain unmodelled.`;
}

function motionTreeReport(project: PlcProject, motionRows: MotionInstructionReviewRow[]): MotionAxisDeviceTreeReport {
  const treeBoundaries = [
    "no-motion-device-connection",
    "no-axis-state-update",
    "no-drive-command",
    "no-motion-feedback",
  ];
  const nodes: MotionAxisDeviceTreeNode[] = [];
  const byId = new Map<string, MotionAxisDeviceTreeNode>();

  const addNode = (node: MotionAxisDeviceTreeNode): MotionAxisDeviceTreeNode => {
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const addChild = (parentId: string | undefined, childId: string): void => {
    if (!parentId) return;
    const parent = byId.get(parentId);
    if (parent && !parent.childIds.includes(childId)) parent.childIds.push(childId);
  };

  for (const controller of project.controllers) {
    const root = addNode({
      id: `motion-tree:${controller.id}:controller`,
      controllerName: controller.name,
      kind: "controller",
      name: controller.name,
      childIds: [],
      commandCount: motionRows.filter((row) => row.controllerId === controller.id).length,
      moduleCount: controller.ioConfiguration.modules.filter(motionDeviceModule).length,
      controlTagCount: 0,
      issueCount: 0,
      status: "reviewable",
      diagnostics: [
        {
          status: "info",
          label: "Offline boundary",
          detail: "The motion tree is assembled from imported tags, module metadata, and routine operands only.",
        },
      ],
      boundaries: treeBoundaries,
      message: `${controller.name} motion tree is review-only; it never starts a motion planner, drive link, or physical controller session.`,
      offlineOnly: true,
      executionModelled: false,
    });

    const motionTags = controllerMotionTags(controller);
    const motionGroups = motionTags.filter((tag) => motionObjectKind(tag.dataType) === "motion-group");
    const axisTags = motionTags.filter((tag) => motionObjectKind(tag.dataType) === "axis");
    const modules = controller.ioConfiguration.modules.filter(motionDeviceModule);
    const moduleLinks = new Map<string, IoModule[]>();
    for (const axis of axisTags) {
      moduleLinks.set(axis.id, modules.filter((module) => moduleMatchesAxis(module, axis)));
    }

    for (const tag of motionTags) {
      const kind = motionObjectKind(tag.dataType)!;
      const groupParent = kind !== "motion-group" && motionGroups.length === 1
        ? `motion-tree:${controller.id}:tag:${motionGroups[0]!.id}`
        : root.id;
      const parentId = kind === "motion-group" ? root.id : groupParent;
      const parentName = parentId === root.id ? root.name : motionGroups[0]?.name;
      const rows = rowsForMotionTag(motionRows, controller, tag);
      const controls = rows.flatMap((row) => row.operands.filter((operand) => operand.role === "motion-control"));
      const issueCount = rows.reduce((sum, row) => sum + row.issues.length, 0);
      const linkedModules = moduleLinks.get(tag.id) ?? [];
      const driveBackedAxis = kind === "axis" && /DRIVE|SERVO|CIP/.test(tag.dataType.toUpperCase());
      const unlinkedDriveAxis = driveBackedAxis && linkedModules.length === 0;
      const diagnostics: AdvancedDomainInspectorDiagnostic[] = [
        motionTargetFamily(tag.dataType),
        {
          status: rows.length ? "ok" : "info",
          label: "Command references",
          detail: rows.length
            ? `${rows.length} imported motion command${rows.length === 1 ? "" : "s"} reference this object.`
            : "No imported motion command currently references this object.",
        },
      ];
      if (kind === "axis") {
        diagnostics.push({
          status: unlinkedDriveAxis ? "warning" : linkedModules.length ? "ok" : "info",
          label: "Device link",
          detail: linkedModules.length
            ? `${linkedModules.length} imported motion device/module row${linkedModules.length === 1 ? "" : "s"} match this axis by name.`
            : driveBackedAxis
              ? "No imported motion device/module row could be matched to this drive-backed axis."
              : "This axis does not require a drive/module link in the offline tree.",
        });
      }
      diagnostics.push({
        status: "info",
        label: "Offline boundary",
        detail: "Tree links are metadata only; ESCO does not execute axis state, planner, drive command, or feedback loops.",
      });

      const node = addNode({
        id: `motion-tree:${controller.id}:tag:${tag.id}`,
        controllerName: controller.name,
        kind,
        name: tag.name,
        dataType: tag.dataType,
        parentId,
        parentName,
        childIds: [],
        commandCount: rows.length,
        moduleCount: linkedModules.length,
        controlTagCount: uniqueSorted(controls.map((operand) => operand.value)).length,
        issueCount: issueCount + (unlinkedDriveAxis ? 1 : 0),
        status: issueCount > 0 ? "needs-attention" : unlinkedDriveAxis ? "unlinked" : "reviewable",
        diagnostics,
        boundaries: uniqueSorted([...rows.flatMap((row) => row.boundaries), ...treeBoundaries]),
        message: motionTreeMessage({
          kind,
          name: tag.name,
          commandCount: rows.length,
          moduleCount: linkedModules.length,
          issueCount,
          unlinkedDriveAxis,
        }),
        offlineOnly: true,
        executionModelled: false,
      });
      addChild(parentId, node.id);
    }

    for (const module of modules) {
      const linkedAxes = axisTags.filter((axis) => moduleMatchesAxis(module, axis));
      const parentAxis = linkedAxes.length === 1 ? linkedAxes[0] : undefined;
      const parentId = parentAxis ? `motion-tree:${controller.id}:tag:${parentAxis.id}` : root.id;
      const status: MotionAxisDeviceTreeNodeStatus = linkedAxes.length > 1 ? "needs-attention" : parentAxis ? "reviewable" : "unlinked";
      const diagnostics: AdvancedDomainInspectorDiagnostic[] = [
        {
          status: parentAxis ? "ok" : linkedAxes.length > 1 ? "warning" : "info",
          label: "Axis link",
          detail: parentAxis
            ? `Matched to axis ${parentAxis.name} by imported names.`
            : linkedAxes.length > 1
              ? `Matches ${linkedAxes.length} axis names; review imported module naming.`
              : "No axis name match was found for this imported motion device/module.",
        },
        {
          status: "info",
          label: "Offline boundary",
          detail: "Module/device metadata is displayed only; no I/O connection or drive command is opened.",
        },
      ];
      const node = addNode({
        id: `motion-tree:${controller.id}:module:${module.id}`,
        controllerName: controller.name,
        kind: "motion-device",
        name: module.name,
        dataType: module.catalogNumber ?? module.productType,
        parentId,
        parentName: parentAxis?.name ?? root.name,
        childIds: [],
        commandCount: 0,
        moduleCount: 1,
        controlTagCount: 0,
        issueCount: linkedAxes.length > 1 ? 1 : 0,
        status,
        diagnostics,
        boundaries: treeBoundaries,
        message: motionTreeMessage({
          kind: "motion-device",
          name: module.name,
          commandCount: 0,
          moduleCount: parentAxis ? 1 : 0,
          issueCount: linkedAxes.length > 1 ? 1 : 0,
          unlinkedDriveAxis: false,
        }),
        offlineOnly: true,
        executionModelled: false,
      });
      addChild(parentId, node.id);
    }
  }

  const visibleNodes = nodes.filter((node) => node.kind !== "controller");
  const boundaries = uniqueSorted(nodes.flatMap((node) => node.boundaries));
  const report = {
    nodes,
    nodeCount: nodes.length,
    motionObjectCount: visibleNodes.filter((node) => node.kind !== "motion-device").length,
    axisCount: visibleNodes.filter((node) => node.kind === "axis").length,
    coordinateSystemCount: visibleNodes.filter((node) => node.kind === "coordinate-system").length,
    motionGroupCount: visibleNodes.filter((node) => node.kind === "motion-group").length,
    motionDeviceCount: visibleNodes.filter((node) => node.kind === "motion-device").length,
    linkedDeviceCount: visibleNodes.filter((node) => node.kind === "motion-device" && node.parentId && !node.parentId.endsWith(":controller")).length,
    unlinkedAxisCount: visibleNodes.filter((node) => node.kind === "axis" && node.status === "unlinked").length,
    issueCount: visibleNodes.reduce((sum, node) => sum + node.issueCount, 0),
    boundaries,
    message: `${visibleNodes.length} motion tree node${visibleNodes.length === 1 ? "" : "s"} are available for offline axis/device review; no motion execution, drive command, feedback, or hardware communication is modelled.`,
  };
  return report;
}

type ProcessInspectorSourceRow = ReturnType<typeof processLoopReviewReport>["rows"][number];
type PhaseInspectorSourceRow = ReturnType<typeof equipmentPhaseReviewReport>["rows"][number];

function processLoopDiagnostics(
  group: ProcessInspectorSourceRow[],
  issueCount: number,
): AdvancedDomainInspectorDiagnostic[] {
  const diagnostics: AdvancedDomainInspectorDiagnostic[] = [];
  const blockOperands = group.flatMap((row) => row.operands.filter((operand) => operand.role === "block-tag"));
  const blockReferences = blockOperands.flatMap((operand) => operand.references);
  const missingLoopCount = group.filter((row) => row.status === "missing-loop-tag").length;
  const loopMismatchCount = group.filter((row) => row.status === "loop-tag-type-mismatch").length;
  const loopTypes = uniqueSorted(group.map((row) => row.loopTagDataType));
  const expectedLoopTypes = uniqueSorted(group.flatMap((row) => row.expectedLoopTypes ?? []));

  if (missingLoopCount > 0) {
    diagnostics.push({
      status: "error",
      label: "Loop tag",
      detail: `${missingLoopCount} instruction${missingLoopCount === 1 ? "" : "s"} missing imported process block tag metadata.`,
    });
  } else if (loopMismatchCount > 0) {
    diagnostics.push({
      status: "error",
      label: "Loop tag type",
      detail: `Imported loop type ${loopTypes.join(" or ") || "unknown"} does not match expected ${expectedLoopTypes.join(" or ") || "process block metadata"}.`,
    });
  } else if (blockReferences.length > 0) {
    diagnostics.push({
      status: "ok",
      label: "Loop tag",
      detail: `${uniqueSorted(blockReferences.map((ref) => ref.baseTag)).join(", ")} resolves as ${loopTypes.join(" or ") || "process block"} metadata.`,
    });
  } else {
    diagnostics.push({
      status: "info",
      label: "Loop tag",
      detail: "No explicit process block tag reference is available for this imported model-only instruction group.",
    });
  }

  const referenceOperands = group.flatMap((row) =>
    row.operands.filter((operand) => operand.role !== "block-tag" && operand.references.length > 0),
  );
  const references = referenceOperands.flatMap((operand) => operand.references);
  const missingReferenceCount = references.filter((ref) => !ref.resolved).length;
  const referenceTypeMismatchCount = references.filter((ref) => ref.typeMatches === false).length;
  if (missingReferenceCount > 0) {
    diagnostics.push({
      status: "error",
      label: "PV/CV references",
      detail: `${missingReferenceCount} referenced process operand${missingReferenceCount === 1 ? "" : "s"} did not resolve to imported tags.`,
    });
  } else if (referenceTypeMismatchCount > 0) {
    diagnostics.push({
      status: "error",
      label: "PV/CV reference types",
      detail: `${referenceTypeMismatchCount} process operand${referenceTypeMismatchCount === 1 ? "" : "s"} resolve with a data type mismatch.`,
    });
  } else if (references.length > 0) {
    diagnostics.push({
      status: "ok",
      label: "PV/CV references",
      detail: `${references.length} process operand reference${references.length === 1 ? "" : "s"} resolve in the imported offline tag database.`,
    });
  } else {
    diagnostics.push({
      status: "info",
      label: "PV/CV references",
      detail: "No external PV, CV, tieback, or master-loop tag references were imported for this group.",
    });
  }

  const timingPreviewRows = group.filter((row) => row.offlineTimingPreviewModelled);
  if (timingPreviewRows.length > 0) {
    const scheduledTimingCount = timingPreviewRows.filter((row) => row.timingPreview.source === "scheduled-task-period").length;
    const samplePeriods = uniqueSorted(timingPreviewRows.map((row) => `${row.timingPreview.samplePeriodMs} ms`));
    const scanCount = timingPreviewRows.reduce((sum, row) => sum + row.timingPreview.previewScanCount, 0);
    diagnostics.push({
      status: scheduledTimingCount > 0 ? "ok" : "info",
      label: "Timing preview",
      detail: `${timingPreviewRows.length} offline timing preview${timingPreviewRows.length === 1 ? "" : "s"} use ${samplePeriods.join(", ")} sample period${samplePeriods.length === 1 ? "" : "s"} across ${scanCount} review sample${scanCount === 1 ? "" : "s"}; controller jitter, watchdog faults, closed-loop math, and runtime writes are not executed.`,
    });
  }

  const tuningParameters = group.flatMap((row) => row.tuning.parameters);
  const tuningGainCount = group.reduce((sum, row) => sum + row.tuning.tuningParameterCount, 0);
  if (tuningParameters.length > 0) {
    diagnostics.push({
      status: "info",
      label: "Tuning parameters",
      detail: `${tuningParameters.length} loop member${tuningParameters.length === 1 ? "" : "s"} available for offline tuning review; ${tuningGainCount} are gain/integral/derivative parameters and none are executed or written.`,
    });
    const comparisonRows = group.filter((row) => row.tuning.parameterCount > 0);
    const comparisonReadyCount = comparisonRows.filter((row) => row.tuning.comparisonReady).length;
    const missingRoles = uniqueSorted(comparisonRows.flatMap((row) => row.tuning.missingComparisonRoles));
    diagnostics.push({
      status: comparisonReadyCount === comparisonRows.length ? "info" : "warning",
      label: "Tuning comparison",
      detail: `${comparisonReadyCount}/${comparisonRows.length} loop review${comparisonRows.length === 1 ? "" : "s"} have SP/PV/CV/KP/KI/KD member coverage for offline parameter comparison; ${missingRoles.length ? `missing ${missingRoles.join(", ")} on the rest and ` : ""}no tuning values are compared, calculated, written, or executed.`,
    });
  } else {
    diagnostics.push({
      status: "warning",
      label: "Tuning parameters",
      detail: "No structured loop member metadata is available for offline tuning review.",
    });
  }

  diagnostics.push({
    status: issueCount > 0 ? "warning" : "ok",
    label: "Instruction coverage",
    detail: `${group.length} process instruction${group.length === 1 ? "" : "s"} reviewed: ${uniqueSorted(group.map((row) => row.instructionType)).join(", ")}.`,
  });
  diagnostics.push({
    status: "info",
    label: "Offline boundary",
    detail: "Closed-loop execution, controller jitter/watchdog faults, tuning effects, and runtime tag writes are review boundaries only.",
  });
  return diagnostics;
}

function processInspectorRows(rows: ReturnType<typeof processLoopReviewReport>["rows"]): AdvancedDomainInspectorRow[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.controllerName}:${row.loopTag || row.rungId}:${row.loopTagDataType ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const first = group[0]!;
    const issueCount = group.filter((row) => row.status !== "reviewable").length;
    const subject = first.loopTag || `${first.instructionType} @ ${locationOf(first)}`;
    const diagnostics = processLoopDiagnostics(group, issueCount);
    const offlinePreview = inspectorOfflinePreview(group.map((row) => row.offlinePreview));
    return {
      id: `process-loop:${key}`,
      domain: "process",
      kind: "process-loop",
      title: "PIDE / Process Loop Inspector",
      subject,
      controllerName: first.controllerName,
      status: issueCount > 0 ? "needs-attention" : "reviewable",
      itemCount: group.length,
      issueCount,
      instructionTypes: uniqueSorted(group.map((row) => row.instructionType)),
      locations: uniqueSorted(group.map(locationOf)),
      dataTypes: uniqueSorted(group.map((row) => row.loopTagDataType)),
      diagnostics,
      ...inspectorDiagnosticCounts(diagnostics),
      boundaries: uniqueSorted(group.flatMap((row) => row.boundaries)),
      message: issueCount
        ? `${subject} has ${issueCount} process-loop review issue${issueCount === 1 ? "" : "s"}; check block tag type and PV/CV references.`
        : `${subject} is resolved for offline process-loop review with timing preview evidence; closed-loop tuning, controller timing faults, and runtime tag writes remain unmodelled.`,
      ...(offlinePreview ? { offlinePreview } : {}),
      offlineOnly: true,
      executionModelled: false,
    };
  });
}

function phaseDiagnostics(
  group: PhaseInspectorSourceRow[],
  issueCount: number,
): AdvancedDomainInspectorDiagnostic[] {
  const diagnostics: AdvancedDomainInspectorDiagnostic[] = [];
  const targetOperands = group.flatMap((row) =>
    row.operands.filter((operand) => operand.role === "equipment-phase" || operand.role === "phase-instruction"),
  );
  const targetReferences = targetOperands.flatMap((operand) => operand.references);
  const missingTargetCount = group.filter((row) =>
    row.issues.includes("missing-equipment-phase") || row.issues.includes("missing-phase-instruction"),
  ).length;
  const targetTypeMismatchCount = group.filter((row) =>
    row.issues.includes("equipment-phase-type-mismatch") || row.issues.includes("phase-instruction-type-mismatch"),
  ).length;
  const targetTypes = uniqueSorted(group.map((row) => row.targetDataType));
  const targetKinds = uniqueSorted(group.map((row) => row.targetKind));

  if (missingTargetCount > 0) {
    diagnostics.push({
      status: "error",
      label: "Phase target",
      detail: `${missingTargetCount} PhaseManager instruction${missingTargetCount === 1 ? "" : "s"} reference missing target metadata.`,
    });
  } else if (targetTypeMismatchCount > 0) {
    diagnostics.push({
      status: "error",
      label: "Phase target type",
      detail: `Imported target type ${targetTypes.join(" or ") || "unknown"} does not match the expected PhaseManager object.`,
    });
  } else if (targetReferences.length > 0) {
    diagnostics.push({
      status: "ok",
      label: "Phase target",
      detail: `${uniqueSorted(targetReferences.map((ref) => ref.baseTag)).join(", ")} resolves as ${targetTypes.join(" or ") || targetKinds.join(" or ")} metadata.`,
    });
  } else {
    diagnostics.push({
      status: "info",
      label: "Phase target",
      detail: "This is an in-phase instruction group with no external EQUIPMENT_PHASE or PHASE_INSTRUCTION operand.",
    });
  }

  const commandOperands = group.flatMap((row) =>
    row.operands.filter((operand) =>
      ["phase-command", "external-request", "failure-code"].includes(operand.role) && operand.value.trim(),
    ),
  );
  const missingRequiredCount = group.reduce(
    (sum, row) => sum + row.operands.filter((operand) => operand.missingRequiredValue).length,
    0,
  );
  if (missingRequiredCount > 0) {
    diagnostics.push({
      status: "warning",
      label: "Command/request operands",
      detail: `${missingRequiredCount} required PhaseManager operand${missingRequiredCount === 1 ? "" : "s"} are not configured.`,
    });
  } else if (commandOperands.length > 0) {
    diagnostics.push({
      status: "ok",
      label: "Command/request operands",
      detail: `${commandOperands.length} command, request, or failure operand${commandOperands.length === 1 ? "" : "s"} preserved for review.`,
    });
  } else {
    diagnostics.push({
      status: "info",
      label: "Command/request operands",
      detail: "No command, external request, or failure-code operand is present on this instruction group.",
    });
  }

  const statePreviewRows = group.filter((row) => row.offlineStateTimingPreviewModelled);
  if (statePreviewRows.length > 0) {
    const paths = uniqueSorted(statePreviewRows.map((row) => `${row.stateTimingPreview.fromState}->${row.stateTimingPreview.toState}`));
    const duration = statePreviewRows.reduce((sum, row) => sum + row.stateTimingPreview.nominalDurationMs, 0);
    diagnostics.push({
      status: "info",
      label: "State/timing preview",
      detail: `${statePreviewRows.length} offline state/timing preview${statePreviewRows.length === 1 ? "" : "s"} map ${paths.join(", ")} over ${duration} ms nominal review time; no state engine, arbitration, ownership transfer, batch request, or runtime write is executed.`,
    });
  }

  const transitions = uniqueSorted(group.map((row) => row.transition.label));
  diagnostics.push({
    status: "info",
    label: "State transition map",
    detail: `${transitions.join(", ")} evidence preserved for review; no committed PhaseManager state transition, command arbitration, ownership transfer, or parameter handoff is executed.`,
  });

  diagnostics.push({
    status: issueCount > 0 ? "warning" : "ok",
    label: "Instruction coverage",
    detail: `${group.length} PhaseManager instruction${group.length === 1 ? "" : "s"} reviewed: ${uniqueSorted(group.map((row) => row.instructionType)).join(", ")}.`,
  });
  diagnostics.push({
    status: "info",
    label: "Offline boundary",
    detail: "Phase state engine, command arbitration, ownership transfer, batch requests, and parameter transfer are not executed.",
  });
  return diagnostics;
}

function phaseInspectorRows(rows: ReturnType<typeof equipmentPhaseReviewReport>["rows"]): AdvancedDomainInspectorRow[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.controllerName}:${row.targetKind ?? "in-phase"}:${row.targetTag || row.rungId}:${row.targetDataType ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const first = group[0]!;
    const issueCount = group.reduce((sum, row) => sum + row.issues.length, 0);
    const subject = first.targetTag || `${first.instructionType} @ ${locationOf(first)}`;
    const diagnostics = phaseDiagnostics(group, issueCount);
    const offlinePreview = inspectorOfflinePreview(group.map((row) => row.offlinePreview));
    return {
      id: `equipment-phase:${key}`,
      domain: "phase",
      kind: "equipment-phase",
      title: "Equipment Phase Inspector",
      subject,
      controllerName: first.controllerName,
      status: issueCount > 0 ? "needs-attention" : "reviewable",
      itemCount: group.length,
      issueCount,
      instructionTypes: uniqueSorted(group.map((row) => row.instructionType)),
      locations: uniqueSorted(group.map(locationOf)),
      dataTypes: uniqueSorted(group.map((row) => row.targetDataType)),
      diagnostics,
      ...inspectorDiagnosticCounts(diagnostics),
      boundaries: uniqueSorted(group.flatMap((row) => row.boundaries)),
      message: issueCount
        ? `${subject} has ${issueCount} PhaseManager review issue${issueCount === 1 ? "" : "s"}; check EQUIPMENT_PHASE/PHASE_INSTRUCTION references.`
        : `${subject} is resolved for offline PhaseManager review with state/timing preview evidence; state engine, command arbitration, ownership, and batch requests remain unmodelled.`,
      ...(offlinePreview ? { offlinePreview } : {}),
      offlineOnly: true,
      executionModelled: false,
    };
  });
}

function advancedDomainInspectorReport(input: {
  motionRows: MotionInstructionReviewRow[];
  process: ReturnType<typeof processLoopReviewReport>;
  phase: ReturnType<typeof equipmentPhaseReviewReport>;
}): AdvancedDomainInspectorReport {
  const rows = [
    ...motionInspectorRows(input.motionRows),
    ...processInspectorRows(input.process.rows),
    ...phaseInspectorRows(input.phase.rows),
  ].sort(
    (a, b) =>
      Number(b.status === "needs-attention") - Number(a.status === "needs-attention") ||
      a.domain.localeCompare(b.domain) ||
      a.subject.localeCompare(b.subject),
  );
  return {
    rows,
    rowCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.reduce((sum, row) => sum + row.issueCount, 0),
  };
}

export function advancedDomainReviewReport(project: PlcProject): AdvancedDomainReviewReport {
  const safety = safetyMetadataReviewReport(project);
  const safetyInfo = controllerSafetyInfoReviewReport(project);
  const safetyTagMap = controllerSafetyTagMapReviewReport(project);
  const sfc = controllerSfcExecutionReviewReport(project);
  const motionRows = motionInstructionReviewRows(project);
  const process = processLoopReviewReport(project);
  const phase = equipmentPhaseReviewReport(project);

  const safetyBoundaries = [
    ...safety.partitionRows.flatMap((row) => row.boundaries),
    ...safety.instructionRows.flatMap((row) => row.boundaries),
    ...safetyInfo.rows.filter((row) => row.safetyInfoPresent).flatMap((row) => row.boundaries),
    ...safetyTagMap.rows.filter((row) => row.safetyTagMapPresent).flatMap((row) => row.boundaries),
  ];
  const safetyInfoItemCount = safetyInfo.rows.filter((row) => row.safetyInfoPresent).length;
  const safetyTagMapItemCount = safetyTagMap.rows.filter((row) => row.safetyTagMapPresent).length;
  const safetyItemCount = safety.partitionRowCount + safety.instructionCount + safetyInfoItemCount + safetyTagMapItemCount;
  const safetyReviewableCount =
    safety.partitionRows.filter((row) => row.status === "reviewable").length +
    safety.reviewableInstructionCount +
    safetyInfo.reviewableCount +
    safetyTagMap.reviewableCount;
  const safetyIssueCount = safety.issueCount + safetyInfo.issueCount + safetyTagMap.issueCount;

  const domainSummaries = [
    domainSummary({
      domain: "safety",
      label: "Safety",
      itemCount: safetyItemCount,
      reviewableCount: safetyReviewableCount,
      issueCount: safetyIssueCount,
      warnings: [...safety.warnings, ...safetyInfo.warnings, ...safetyTagMap.warnings],
      boundaries: safetyBoundaries,
    }),
    domainSummary({
      domain: "motion",
      label: "Motion",
      itemCount: motionRows.length,
      reviewableCount: motionRows.filter((row) => row.status === "reviewable").length,
      issueCount: motionRows.filter((row) => row.issues.length > 0).length,
      warnings: motionRows.filter((row) => row.issues.length > 0).map((row) => row.message),
      boundaries: motionRows.flatMap((row) => row.boundaries),
    }),
    domainSummary({
      domain: "process",
      label: "Process",
      itemCount: process.instructionCount,
      reviewableCount: process.reviewableCount,
      issueCount: process.instructionCount - process.reviewableCount,
      warnings: process.warnings,
      boundaries: process.rows.flatMap((row) => row.boundaries),
    }),
    domainSummary({
      domain: "phase",
      label: "Phase",
      itemCount: phase.instructionCount,
      reviewableCount: phase.reviewableCount,
      issueCount: phase.issueCount,
      warnings: phase.warnings,
      boundaries: phase.rows.flatMap((row) => row.boundaries),
    }),
    domainSummary({
      domain: "sfc",
      label: "SFC",
      itemCount: sfc.controllersWithSfcMetadataCount,
      reviewableCount: sfc.reviewableCount,
      issueCount: sfc.issueCount,
      warnings: sfc.warnings,
      boundaries: sfc.rows.filter((row) => row.hasSfcMetadata).flatMap((row) => row.boundaries),
    }),
  ];

  const totalItemCount = domainSummaries.reduce((sum, row) => sum + row.itemCount, 0);
  const reviewableItemCount = domainSummaries.reduce((sum, row) => sum + row.reviewableCount, 0);
  const warnings = [
    ...safety.warnings,
    ...safetyInfo.warnings,
    ...safetyTagMap.warnings,
    ...motionRows.filter((row) => row.issues.length > 0).map((row) => row.message),
    ...process.warnings,
    ...phase.warnings,
    ...sfc.warnings,
  ];
  const boundaries = [...new Set([
    ...safetyBoundaries,
    ...motionRows.flatMap((row) => row.boundaries),
    ...process.rows.flatMap((row) => row.boundaries),
    ...phase.rows.flatMap((row) => row.boundaries),
    ...sfc.rows.filter((row) => row.hasSfcMetadata).flatMap((row) => row.boundaries),
  ])].sort();
  const issueCount = domainSummaries.reduce((sum, row) => sum + row.issueCount, 0);
  const detailRows = advancedDomainDetailRows({ safety, safetyInfo, safetyTagMap, sfc, motionRows, process, phase });
  const inspectorReport = advancedDomainInspectorReport({ motionRows, process, phase });
  const motionTree = motionTreeReport(project, motionRows);

  return {
    domains: domainSummaries,
    detailRows,
    inspectorReport,
    motionTree,
    motionRows,
    totalItemCount,
    reviewableItemCount,
    issueCount,
    warningCount: warnings.length,
    boundaryCount: boundaries.length,
    readinessPercent: readinessPercent(reviewableItemCount, totalItemCount),
    status: domainStatus(totalItemCount, issueCount),
    warnings,
    boundaries,
  };
}
