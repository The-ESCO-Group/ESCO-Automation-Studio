import type { AddOnInstruction, Controller, PlcProject, Program, Routine, Tag, UserDefinedType } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  describeModelOnlyInstructionReview,
  supportLevel,
  type ModelOnlyInstructionBoundary,
} from "@esco/instructions";
import { rungNodes, type LadderNode } from "@esco/ladder";
import { getLadder } from "./helpers";

export type AlarmReviewRowKind = "alarm-tag" | "process-alarm-definition" | "alarm-instruction";
export type AlarmReviewStatus = "reviewable" | "metadata-only" | "needs-attention";
export type AlarmReviewIssue =
  | "missing-alarm-tag"
  | "alarm-tag-type-mismatch"
  | "missing-required-operand"
  | "source-protected-aoi"
  | "custom-alarm-definition";
export type AlarmReviewBoundary =
  | "metadata-display-only"
  | "no-runtime-tag-writes"
  | "no-controller-communication"
  | "no-proprietary-binary-support"
  | ModelOnlyInstructionBoundary;

export interface AlarmReviewOperand {
  index: number;
  name: string;
  label: string;
  value: string;
  direction: "read" | "write";
  required: boolean;
  resolved: boolean;
  dataType?: string;
  expectedTypes?: string[];
  typeMatches?: boolean;
}

export interface AlarmReviewRow {
  id: string;
  kind: AlarmReviewRowKind;
  status: AlarmReviewStatus;
  controllerName: string;
  programName?: string;
  routineName?: string;
  rungNumber?: number;
  name: string;
  dataType?: string;
  alarmKind: "analog" | "digital" | "legacy" | "process" | "custom";
  instructionType?: string;
  sourceProtected?: boolean;
  fieldCount: number;
  tagInstanceCount: number;
  representativeFields: string[];
  operands: AlarmReviewOperand[];
  issues: AlarmReviewIssue[];
  boundaries: AlarmReviewBoundary[];
  message: string;
}

export interface AlarmReviewReport {
  rows: AlarmReviewRow[];
  alarmObjectCount: number;
  alarmTagCount: number;
  alarmInstructionCount: number;
  processAlarmDefinitionCount: number;
  analogCount: number;
  digitalCount: number;
  reviewableCount: number;
  metadataOnlyCount: number;
  issueCount: number;
  boundaries: AlarmReviewBoundary[];
  warnings: string[];
}

const registry = createDefaultRegistry();

const STATIC_BOUNDARIES: AlarmReviewBoundary[] = [
  "metadata-display-only",
  "no-alarm-evaluation",
  "no-alarm-condition-evaluation",
  "no-alarm-status-update",
  "no-alarm-latch-or-acknowledge",
  "no-alarm-deadband-or-delay-timing",
  "no-runtime-tag-writes",
  "no-controller-communication",
  "no-proprietary-binary-support",
];

const ALARM_TYPE_PATTERN = /^ALARM(_ANALOG|_DIGITAL)?$/i;
const ALARM_NAME_PATTERN = /alarm|almd|alma|alm_/i;

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

function resolveTag(controller: Controller, program: Program, value: string): Tag | undefined {
  const path = tagPath(value);
  if (!path) return undefined;
  if (path.programName) {
    return controller.programs
      .find((candidate) => candidate.name === path.programName)
      ?.programTags.find((candidate) => candidate.name === path.baseTag);
  }
  return (
    program.programTags.find((candidate) => candidate.name === path.baseTag) ??
    controller.controllerTags.find((candidate) => candidate.name === path.baseTag)
  );
}

function alarmKind(dataType: string | undefined, fallback: AlarmReviewRow["alarmKind"] = "custom"): AlarmReviewRow["alarmKind"] {
  const normalized = (dataType ?? "").toUpperCase();
  if (normalized === "ALARM_ANALOG") return "analog";
  if (normalized === "ALARM_DIGITAL") return "digital";
  if (normalized === "ALARM") return "legacy";
  return fallback;
}

function fields(values: readonly { name: string; dataType: string }[], limit = 6): string[] {
  return values
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((field) => `${field.name}: ${field.dataType}`);
}

function instanceCounts(project: PlcProject): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (tag: Tag): void => {
    counts.set(tag.dataType, (counts.get(tag.dataType) ?? 0) + 1);
  };
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) add(tag);
    for (const program of controller.programs) {
      for (const tag of program.programTags) add(tag);
    }
  }
  return counts;
}

function tagRow(tag: Tag, controllerName: string, programName?: string): AlarmReviewRow | undefined {
  if (!ALARM_TYPE_PATTERN.test(tag.dataType)) return undefined;
  const kind = alarmKind(tag.dataType);
  return {
    id: `alarm:tag:${controllerName}:${programName ?? "controller"}:${tag.name}`,
    kind: "alarm-tag",
    status: "reviewable",
    controllerName,
    ...(programName ? { programName } : {}),
    name: tag.name,
    dataType: tag.dataType,
    alarmKind: kind,
    fieldCount: 0,
    tagInstanceCount: 1,
    representativeFields: [],
    operands: [],
    issues: [],
    boundaries: STATIC_BOUNDARIES,
    message: `${tag.name} is an imported ${tag.dataType} alarm tag for offline review; alarm evaluation, status updates, latch/acknowledge, and timing are not simulated.`,
  };
}

function aoiRow(controllerName: string, aoi: AddOnInstruction, counts: Map<string, number>): AlarmReviewRow | undefined {
  if (!ALARM_NAME_PATTERN.test(aoi.name)) return undefined;
  const issues: AlarmReviewIssue[] = ["custom-alarm-definition"];
  if (aoi.protected) issues.push("source-protected-aoi");
  const fieldRows = [
    ...aoi.parameters.map((parameter) => ({ name: parameter.name, dataType: parameter.dataType })),
    ...aoi.localTags.map((tag) => ({ name: tag.name, dataType: tag.dataType })),
  ];
  return {
    id: `alarm:aoi:${controllerName}:${aoi.name}`,
    kind: "process-alarm-definition",
    status: "metadata-only",
    controllerName,
    name: aoi.name,
    dataType: aoi.name,
    alarmKind: "process",
    sourceProtected: Boolean(aoi.protected),
    fieldCount: fieldRows.length,
    tagInstanceCount: counts.get(aoi.name) ?? 0,
    representativeFields: fields(fieldRows),
    operands: [],
    issues,
    boundaries: STATIC_BOUNDARIES,
    message: `${aoi.name} is an imported process-alarm AOI definition for metadata review only; ESCO does not run vendor alarm faceplate logic or controller alarm state.`,
  };
}

function udtRow(controllerName: string, udt: UserDefinedType, counts: Map<string, number>): AlarmReviewRow | undefined {
  if (!ALARM_NAME_PATTERN.test(udt.name)) return undefined;
  return {
    id: `alarm:udt:${controllerName}:${udt.name}`,
    kind: "process-alarm-definition",
    status: "metadata-only",
    controllerName,
    name: udt.name,
    dataType: udt.name,
    alarmKind: "custom",
    fieldCount: udt.members.length,
    tagInstanceCount: counts.get(udt.name) ?? 0,
    representativeFields: fields(udt.members.map((member) => ({ name: member.name, dataType: member.dataType }))),
    operands: [],
    issues: ["custom-alarm-definition"],
    boundaries: STATIC_BOUNDARIES,
    message: `${udt.name} is an imported alarm-like UDT definition for structure review only; ESCO does not create a controller AlarmDefinitions runtime from it.`,
  };
}

function typeMatches(actual: string | undefined, expected: readonly string[] | undefined): boolean | undefined {
  if (!actual || !expected?.length) return undefined;
  return expected.some((candidate) => candidate.toUpperCase() === actual.toUpperCase());
}

function instructionRow(input: {
  controller: Controller;
  program: Program;
  routine: Routine;
  rungId: string;
  rungNumber: number;
  node: LadderNode;
}): AlarmReviewRow | undefined {
  const { controller, program, routine, rungId, rungNumber, node } = input;
  const def = registry.get(node.instructionType);
  if (!def || def.category !== "alarm" || supportLevel(def) !== "model-only") return undefined;
  const review = describeModelOnlyInstructionReview(def, node);
  if (!review) return undefined;

  const operands: AlarmReviewOperand[] = review.operands.map((operand) => {
    const tag = operand.value ? resolveTag(controller, program, operand.value) : undefined;
    return {
      index: operand.index,
      name: operand.name,
      label: operand.label,
      value: operand.value,
      direction: operand.declaredDirection,
      required: operand.required,
      resolved: Boolean(tag),
      dataType: tag?.dataType,
      expectedTypes: operand.allowedTypes,
      typeMatches: typeMatches(tag?.dataType, operand.allowedTypes),
    };
  });
  const alarmOperand = operands.find((operand) => operand.name === "alarm");
  const issues: AlarmReviewIssue[] = [];
  if (alarmOperand?.required && !alarmOperand.value) issues.push("missing-alarm-tag");
  if (alarmOperand?.value && !alarmOperand.resolved) issues.push("missing-alarm-tag");
  if (alarmOperand?.typeMatches === false) issues.push("alarm-tag-type-mismatch");
  if (operands.some((operand) => operand.required && !operand.value && operand.name !== "alarm")) {
    issues.push("missing-required-operand");
  }

  const status: AlarmReviewStatus = issues.length ? "needs-attention" : "reviewable";
  const boundaries = [...new Set<AlarmReviewBoundary>([...review.boundaries, ...STATIC_BOUNDARIES])].sort();
  return {
    id: `alarm:instruction:${rungId}:${node.id}`,
    kind: "alarm-instruction",
    status,
    controllerName: controller.name,
    programName: program.name,
    routineName: routine.name,
    rungNumber,
    name: alarmOperand?.value || node.instructionType,
    dataType: alarmOperand?.dataType,
    alarmKind: alarmKind(alarmOperand?.expectedTypes?.[0], node.instructionType === "ALMA" ? "analog" : "digital"),
    instructionType: node.instructionType,
    fieldCount: 0,
    tagInstanceCount: alarmOperand?.resolved ? 1 : 0,
    representativeFields: [],
    operands,
    issues,
    boundaries,
    message: issues.length
      ? `${node.instructionType} alarm instruction needs imported alarm tag/type cleanup before review is complete.`
      : `${node.instructionType} alarm instruction is reviewable offline; condition evaluation, status updates, latch/acknowledge, and timing remain unmodelled.`,
  };
}

export function alarmReviewReport(project: PlcProject): AlarmReviewReport {
  const rows: AlarmReviewRow[] = [];
  const counts = instanceCounts(project);

  for (const controller of project.controllers) {
    for (const aoi of controller.addOnInstructions) {
      const row = aoiRow(controller.name, aoi, counts);
      if (row) rows.push(row);
    }
    for (const udt of controller.dataTypes) {
      const row = udtRow(controller.name, udt, counts);
      if (row) rows.push(row);
    }
    for (const tag of controller.controllerTags) {
      const row = tagRow(tag, controller.name);
      if (row) rows.push(row);
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        const row = tagRow(tag, controller.name, program.name);
        if (row) rows.push(row);
      }
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const row = instructionRow({ controller, program, routine, rungId: rung.id, rungNumber: rung.number, node });
            if (row) rows.push(row);
          }
        }
      }
    }
  }

  rows.sort(
    (a, b) =>
      Number(b.status === "needs-attention") - Number(a.status === "needs-attention") ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );

  const boundaries = [...new Set(rows.flatMap((row) => row.boundaries))].sort();
  const warnings = rows.filter((row) => row.issues.length > 0).map((row) => row.message);
  return {
    rows,
    alarmObjectCount: rows.length,
    alarmTagCount: rows.filter((row) => row.kind === "alarm-tag").length,
    alarmInstructionCount: rows.filter((row) => row.kind === "alarm-instruction").length,
    processAlarmDefinitionCount: rows.filter((row) => row.kind === "process-alarm-definition").length,
    analogCount: rows.filter((row) => row.alarmKind === "analog").length,
    digitalCount: rows.filter((row) => row.alarmKind === "digital").length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    metadataOnlyCount: rows.filter((row) => row.status === "metadata-only").length,
    issueCount: rows.reduce((sum, row) => sum + row.issues.length, 0),
    boundaries: boundaries.length ? boundaries : STATIC_BOUNDARIES,
    warnings,
  };
}
