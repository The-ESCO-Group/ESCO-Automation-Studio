import { STRUCTURED_TYPES, type Controller, type PlcProject, type Program, type Routine, type Tag, type Task } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  isNumericLiteral,
  referencedPaths,
  supportLevel,
  type InstructionOperandDefinition,
} from "@esco/instructions";
import { rungNodes, type LadderNode } from "@esco/ladder";
import { getLadder } from "./helpers";

export type ProcessLoopReviewStatus =
  | "reviewable"
  | "missing-loop-tag"
  | "loop-tag-type-mismatch"
  | "missing-reference"
  | "operand-type-mismatch"
  | "incomplete-operands";

export type ProcessLoopReviewBoundary =
  | "no-process-loop-execution"
  | "no-runtime-tag-memory-write"
  | "no-closed-loop-tuning"
  | "no-controller-period-or-watchdog-model"
  | "offline-process-timing-estimate-only";

export type ProcessLoopOperandRole =
  | "block-tag"
  | "process-variable"
  | "control-variable"
  | "tieback"
  | "master-loop"
  | "hold"
  | "review-operand";

export type ProcessLoopTuningParameterRole =
  | "setpoint"
  | "process-variable"
  | "control-output"
  | "gain"
  | "integral"
  | "derivative"
  | "limit"
  | "status";

export interface ProcessLoopTuningParameterReview {
  name: string;
  path: string;
  dataType: string;
  role: ProcessLoopTuningParameterRole;
  present: boolean;
  valueModelled: false;
  runtimeWriteModelled: false;
}

export interface ProcessLoopTuningReview {
  loopTag?: string;
  loopDataType?: string;
  parameterCount: number;
  tuningParameterCount: number;
  setpointPresent: boolean;
  processVariablePresent: boolean;
  controlOutputPresent: boolean;
  limitsPresent: boolean;
  comparisonReady: boolean;
  missingComparisonRoles: ProcessLoopTuningParameterRole[];
  parameters: ProcessLoopTuningParameterReview[];
  valueComparisonModelled: false;
  tuningExecutionModelled: false;
  runtimeWritesModelled: false;
  message: string;
}

export type ProcessLoopTimingPreviewSource =
  | "scheduled-task-period"
  | "continuous-task-default"
  | "event-task-metadata"
  | "unscheduled-default";

export interface ProcessLoopTimingPreview {
  samplePeriodMs: number;
  previewHorizonMs: number;
  previewScanCount: number;
  source: ProcessLoopTimingPreviewSource;
  taskName?: string;
  taskType?: Task["type"];
  watchdogMs?: number;
  controllerTimingModelled: false;
  closedLoopExecutionModelled: false;
  runtimeWriteModelled: false;
  message: string;
}

export interface ProcessLoopOfflinePreview {
  available: boolean;
  status: "previewable" | "blocked";
  stateEvidence: string;
  timingSource: "imported-task-period" | "offline-default" | "none";
  estimatedOnly: true;
  controllerTimingModelled: false;
  runtimeWritesModelled: false;
  executionModelled: false;
  message: string;
}

export interface ProcessLoopReference {
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

export interface ProcessLoopOperandReview {
  index: number;
  name: string;
  label: string;
  value: string;
  role: ProcessLoopOperandRole;
  direction: "read" | "write";
  required: boolean;
  missingRequiredValue: boolean;
  references: ProcessLoopReference[];
}

export interface ProcessLoopReviewRow {
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
  status: ProcessLoopReviewStatus;
  loopTag?: string;
  loopTagDataType?: string;
  expectedLoopTypes?: string[];
  modelOnly: true;
  loopExecutionModelled: false;
  offlineTimingPreviewModelled: boolean;
  runtimeTagWritesModelled: false;
  tuning: ProcessLoopTuningReview;
  timingPreview: ProcessLoopTimingPreview;
  offlinePreview: ProcessLoopOfflinePreview;
  boundaries: ProcessLoopReviewBoundary[];
  operands: ProcessLoopOperandReview[];
  message: string;
}

export interface ProcessLoopReviewReport {
  rows: ProcessLoopReviewRow[];
  instructionCount: number;
  reviewableCount: number;
  missingLoopTagCount: number;
  missingReferenceCount: number;
  typeMismatchCount: number;
  warnings: string[];
  tuningReviewCount: number;
  tuningParameterCount: number;
  tuningComparisonReadyCount: number;
  tuningComparisonGapCount: number;
  timingPreviewCount: number;
  scheduledTimingPreviewCount: number;
  timingPreviewScanCount: number;
}

const registry = createDefaultRegistry();

const BOUNDARIES: ProcessLoopReviewBoundary[] = [
  "no-process-loop-execution",
  "no-runtime-tag-memory-write",
  "no-closed-loop-tuning",
  "no-controller-period-or-watchdog-model",
  "offline-process-timing-estimate-only",
];

const TUNING_PARAMETER_ROLES: Record<string, ProcessLoopTuningParameterRole> = {
  SP: "setpoint",
  PV: "process-variable",
  CV: "control-output",
  CVEU: "control-output",
  OUT: "control-output",
  KP: "gain",
  KI: "integral",
  KD: "derivative",
  MAXO: "limit",
  MINO: "limit",
  ERR: "status",
};

const REQUIRED_COMPARISON_ROLES: ProcessLoopTuningParameterRole[] = [
  "setpoint",
  "process-variable",
  "control-output",
  "gain",
  "integral",
  "derivative",
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

function resolveTag(controller: Controller, program: Program, value: string): ProcessLoopReference | undefined {
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

function reference(
  path: TagPath,
  tag: Tag | undefined,
  scope: ProcessLoopReference["scope"],
): ProcessLoopReference {
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

function sameDataType(actual: string | undefined, expected: string): boolean {
  return actual?.toUpperCase() === expected.toUpperCase();
}

function valuesForOperand(node: LadderNode, index: number, operandDef: InstructionOperandDefinition | undefined): string[] {
  const operand = node.operands[index];
  const value = operand?.value.trim() ?? "";
  if (!value || isNumericLiteral(value)) return [];
  if (operandDef?.isExpression || operand?.kind === "expression") return referencedPaths(value);
  return tagPath(value) ? [value] : [];
}

function operandRole(index: number, operandDef: InstructionOperandDefinition | undefined): ProcessLoopOperandRole {
  const name = operandDef?.name.toLowerCase() ?? "";
  const label = operandDef?.label.toLowerCase() ?? "";
  const text = `${name} ${label}`;
  if (index === 0 && operandDef?.direction === "write") return "block-tag";
  if (text.includes("process variable") || name === "pv") return "process-variable";
  if (text.includes("control variable") || name === "cv") return "control-variable";
  if (text.includes("tieback")) return "tieback";
  if (text.includes("master loop")) return "master-loop";
  if (text.includes("inhold") || text.includes("hold")) return "hold";
  return "review-operand";
}

function describeOperand(
  controller: Controller,
  program: Program,
  node: LadderNode,
  index: number,
  operandDef: InstructionOperandDefinition | undefined,
): ProcessLoopOperandReview {
  const operand = node.operands[index];
  const value = operand?.value.trim() ?? "";
  const references = valuesForOperand(node, index, operandDef).map((path) => {
    const resolved = resolveTag(controller, program, path)!;
    if (operandDef?.allowedTypes?.length) {
      resolved.expectedTypes = [...operandDef.allowedTypes];
      resolved.typeMatches = operandDef.allowedTypes.some((expected) => sameDataType(resolved.dataType, expected));
    }
    return resolved;
  });

  return {
    index,
    name: operandDef?.name ?? operand?.name ?? `op${index}`,
    label: operandDef?.label ?? operand?.name ?? `op${index}`,
    value,
    role: operandRole(index, operandDef),
    direction: operandDef?.direction ?? "read",
    required: operandDef?.required ?? false,
    missingRequiredValue: Boolean(operandDef?.required && !value),
    references,
  };
}

function rowStatus(operands: ProcessLoopOperandReview[]): ProcessLoopReviewStatus {
  const loop = operands.find((operand) => operand.role === "block-tag");
  const loopReference = loop?.references[0];
  if (!loop || loop.missingRequiredValue || !loopReference?.resolved) return "missing-loop-tag";
  if (loopReference.typeMatches === false) return "loop-tag-type-mismatch";
  if (operands.some((operand) => operand.missingRequiredValue)) return "incomplete-operands";
  if (operands.some((operand) => operand.references.some((ref) => !ref.resolved))) return "missing-reference";
  if (operands.some((operand) => operand.references.some((ref) => ref.typeMatches === false))) return "operand-type-mismatch";
  return "reviewable";
}

function tuningReview(loopTag: string | undefined, loopDataType: string | undefined): ProcessLoopTuningReview {
  const members = loopDataType ? (STRUCTURED_TYPES[loopDataType.toUpperCase()] ?? []) : [];
  const parameters = members
    .filter((member) => TUNING_PARAMETER_ROLES[member.name.toUpperCase()])
    .map((member): ProcessLoopTuningParameterReview => ({
      name: member.name,
      path: loopTag ? `${loopTag}.${member.name}` : member.name,
      dataType: member.type,
      role: TUNING_PARAMETER_ROLES[member.name.toUpperCase()]!,
      present: true,
      valueModelled: false,
      runtimeWriteModelled: false,
    }));
  const hasRole = (role: ProcessLoopTuningParameterRole) => parameters.some((parameter) => parameter.role === role);
  const tuningParameterCount = parameters.filter((parameter) =>
    parameter.role === "gain" || parameter.role === "integral" || parameter.role === "derivative",
  ).length;
  const missingComparisonRoles = REQUIRED_COMPARISON_ROLES.filter((role) => !hasRole(role));
  const comparisonReady = parameters.length > 0 && missingComparisonRoles.length === 0;
  const message =
    parameters.length > 0
      ? `${loopTag ?? "Loop"} exposes ${parameters.length} imported loop member${parameters.length === 1 ? "" : "s"} for tuning review (${tuningParameterCount} gain/integral/derivative parameter${tuningParameterCount === 1 ? "" : "s"}); offline comparison readiness is ${comparisonReady ? "complete" : "incomplete"} and ESCO does not tune, execute, compare values, or write the loop.`
      : `${loopTag ?? "Loop"} has no imported structured tuning member metadata for offline review.`;
  return {
    ...(loopTag ? { loopTag } : {}),
    ...(loopDataType ? { loopDataType } : {}),
    parameterCount: parameters.length,
    tuningParameterCount,
    setpointPresent: hasRole("setpoint"),
    processVariablePresent: hasRole("process-variable"),
    controlOutputPresent: hasRole("control-output"),
    limitsPresent: hasRole("limit"),
    comparisonReady,
    missingComparisonRoles,
    parameters,
    valueComparisonModelled: false,
    tuningExecutionModelled: false,
    runtimeWritesModelled: false,
    message,
  };
}

function scheduledTaskForProgram(controller: Controller, program: Program): Task | undefined {
  return controller.tasks
    .filter((task) => !task.inhibited && task.scheduledProgramIds.includes(program.id))
    .sort((a, b) => {
      const aRank = a.type === "periodic" ? 0 : a.type === "continuous" ? 1 : 2;
      const bRank = b.type === "periodic" ? 0 : b.type === "continuous" ? 1 : 2;
      return aRank - bRank || (a.periodMs ?? Number.MAX_SAFE_INTEGER) - (b.periodMs ?? Number.MAX_SAFE_INTEGER);
    })[0];
}

function timingPreview(controller: Controller, program: Program): ProcessLoopTimingPreview {
  const task = scheduledTaskForProgram(controller, program);
  const scheduledPeriod = task?.periodMs != null && task.periodMs > 0 ? task.periodMs : undefined;
  const samplePeriodMs = scheduledPeriod ?? (task?.type === "event" ? 1000 : 100);
  const source: ProcessLoopTimingPreviewSource = scheduledPeriod
    ? "scheduled-task-period"
    : task?.type === "continuous"
      ? "continuous-task-default"
      : task?.type === "event"
        ? "event-task-metadata"
        : "unscheduled-default";
  const previewHorizonMs = Math.max(samplePeriodMs * 5, 500);
  const previewScanCount = Math.ceil(previewHorizonMs / samplePeriodMs);
  const timingSource =
    source === "scheduled-task-period"
      ? `${task!.name} ${samplePeriodMs} ms task period`
      : source === "continuous-task-default"
        ? `${task!.name} continuous-task offline default`
        : source === "event-task-metadata"
          ? `${task!.name} event-task metadata fallback`
          : "unscheduled offline default";
  return {
    samplePeriodMs,
    previewHorizonMs,
    previewScanCount,
    source,
    ...(task ? { taskName: task.name, taskType: task.type } : {}),
    ...(task?.watchdogMs != null ? { watchdogMs: task.watchdogMs } : {}),
    controllerTimingModelled: false,
    closedLoopExecutionModelled: false,
    runtimeWriteModelled: false,
    message: `Offline timing preview uses ${timingSource} across ${previewScanCount} sample${previewScanCount === 1 ? "" : "s"} (${previewHorizonMs} ms horizon); controller period jitter, watchdog faults, closed-loop math, and tag writes are not executed.`,
  };
}

function processOfflinePreview(
  status: ProcessLoopReviewStatus,
  loopTag: string | undefined,
  timing: ProcessLoopTimingPreview,
): ProcessLoopOfflinePreview {
  if (status !== "reviewable") {
    return {
      available: false,
      status: "blocked",
      stateEvidence: loopTag ? `${loopTag} process metadata requires cleanup before preview.` : "Process loop tag is unresolved.",
      timingSource: "none",
      estimatedOnly: true,
      controllerTimingModelled: false,
      runtimeWritesModelled: false,
      executionModelled: false,
      message: "Offline process timing preview is blocked until the loop tag and required references resolve.",
    };
  }
  return {
    available: true,
    status: "previewable",
    stateEvidence: `${loopTag ?? "Loop"} has enough imported metadata for offline PV/CV/tuning review.`,
    timingSource: timing.source === "scheduled-task-period" ? "imported-task-period" : "offline-default",
    estimatedOnly: true,
    controllerTimingModelled: false,
    runtimeWritesModelled: false,
    executionModelled: false,
    message: `Offline process preview estimates ${timing.previewScanCount} sample${timing.previewScanCount === 1 ? "" : "s"} at ${timing.samplePeriodMs} ms; no controller timing, closed-loop execution, or runtime writes are modelled.`,
  };
}

function messageFor(row: Omit<ProcessLoopReviewRow, "message">): string {
  if (row.status === "reviewable") {
    return `${row.instructionType} loop "${row.loopTag}" is reviewable offline with ${row.tuning.parameterCount} tuning/status member${row.tuning.parameterCount === 1 ? "" : "s"} and a ${row.timingPreview.samplePeriodMs} ms offline timing preview; closed-loop execution and runtime tag writes are not simulated.`;
  }
  if (row.status === "missing-loop-tag") {
    return `${row.instructionType} is missing its configured process block tag or the tag is not imported.`;
  }
  if (row.status === "loop-tag-type-mismatch") {
    return `${row.instructionType} block tag "${row.loopTag}" has type ${row.loopTagDataType ?? "unknown"}, expected ${row.expectedLoopTypes?.join(" or ") ?? "the declared process type"}.`;
  }
  if (row.status === "missing-reference") {
    return `${row.instructionType} has one or more PV/CV/review operands that do not resolve to imported tags.`;
  }
  if (row.status === "operand-type-mismatch") {
    return `${row.instructionType} has one or more operands whose imported tag type does not match the declared review type.`;
  }
  return `${row.instructionType} has required operands that are not configured.`;
}

function processRow(input: {
  controller: Controller;
  program: Program;
  routine: Routine;
  rungId: string;
  rungNumber: number;
  node: LadderNode;
}): ProcessLoopReviewRow | undefined {
  const { controller, program, routine, rungId, rungNumber, node } = input;
  const def = registry.get(node.instructionType);
  if (!def || def.category !== "process" || supportLevel(def) !== "model-only") return undefined;

  const count = Math.max(def.operands.length, node.operands.length);
  const operands = Array.from({ length: count }, (_unused, index) =>
    describeOperand(controller, program, node, index, def.operands[index]),
  );
  const loop = operands.find((operand) => operand.role === "block-tag");
  const loopReference = loop?.references[0];
  const loopTag = loop?.value || loopReference?.baseTag;
  const loopTagDataType = loopReference?.dataType;
  const status = rowStatus(operands);
  const timing = timingPreview(controller, program);
  const offlinePreview = processOfflinePreview(status, loopTag, timing);
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
    status,
    loopTag,
    loopTagDataType,
    expectedLoopTypes: loopReference?.expectedTypes,
    modelOnly: true as const,
    loopExecutionModelled: false as const,
    offlineTimingPreviewModelled: offlinePreview.available,
    runtimeTagWritesModelled: false as const,
    tuning: tuningReview(loopTag, loopTagDataType),
    timingPreview: timing,
    offlinePreview,
    boundaries: BOUNDARIES,
    operands,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function processLoopReviewReport(project: PlcProject): ProcessLoopReviewReport {
  const rows: ProcessLoopReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const row = processRow({
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

  const warnings = rows.filter((row) => row.status !== "reviewable").map((row) => row.message);

  return {
    rows,
    instructionCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    missingLoopTagCount: rows.filter((row) => row.status === "missing-loop-tag").length,
    missingReferenceCount: rows.filter((row) => row.status === "missing-reference").length,
    typeMismatchCount: rows.filter((row) => row.status === "loop-tag-type-mismatch" || row.status === "operand-type-mismatch").length,
    warnings,
    tuningReviewCount: rows.filter((row) => row.tuning.parameterCount > 0).length,
    tuningParameterCount: rows.reduce((sum, row) => sum + row.tuning.tuningParameterCount, 0),
    tuningComparisonReadyCount: rows.filter((row) => row.tuning.comparisonReady).length,
    tuningComparisonGapCount: rows.filter((row) => row.tuning.parameterCount > 0 && !row.tuning.comparisonReady).length,
    timingPreviewCount: rows.filter((row) => row.offlineTimingPreviewModelled).length,
    scheduledTimingPreviewCount: rows.filter((row) => row.offlineTimingPreviewModelled && row.timingPreview.source === "scheduled-task-period").length,
    timingPreviewScanCount: rows.reduce((sum, row) => sum + (row.offlineTimingPreviewModelled ? row.timingPreview.previewScanCount : 0), 0),
  };
}
