import type { Controller, PlcProject, Program, Routine, Tag } from "@esco/core";
import { baseTagName, createDefaultRegistry, supportLevel } from "@esco/instructions";
import { rungNodes, type LadderNode } from "@esco/ladder";
import { getLadder } from "./helpers";

export type SafetyMetadataReviewStatus = "reviewable" | "needs-attention";

export type SafetyMetadataObjectKind = "task" | "program" | "tag" | "add-on-instruction";

export type SafetyMetadataReviewIssue =
  | "unknown-safety-class"
  | "missing-backing-tag"
  | "backing-tag-not-safety-class";

export type SafetyMetadataReviewBoundary =
  | "no-safety-task-scheduling"
  | "no-safety-signature-verification"
  | "no-safety-lock-unlock"
  | "no-safety-memory-partition-enforcement"
  | "no-safety-instruction-execution"
  | "no-controller-safety-status";

export type NormalizedSafetyClass = "safety" | "standard" | "unknown";

export interface SafetyMetadataPartitionRow {
  controllerId: string;
  controllerName: string;
  objectKind: SafetyMetadataObjectKind;
  objectId: string;
  objectName: string;
  programId?: string;
  programName?: string;
  dataType?: string;
  safetyClass: string;
  normalizedSafetyClass: NormalizedSafetyClass;
  status: SafetyMetadataReviewStatus;
  issues: SafetyMetadataReviewIssue[];
  safetyTaskSchedulingModelled: false;
  safetySignatureVerified: false;
  safetyLockUnlockModelled: false;
  safetyMemoryPartitionEnforced: false;
  controllerSafetyStatusModelled: false;
  boundaries: SafetyMetadataReviewBoundary[];
  message: string;
}

export interface SafetyInstructionReviewRow {
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
  backingTag?: string;
  backingTagDataType?: string;
  backingTagSafetyClass?: string;
  backingTagResolved: boolean;
  status: SafetyMetadataReviewStatus;
  issues: SafetyMetadataReviewIssue[];
  modelOnly: true;
  safetyInstructionExecutionModelled: false;
  safetyEvaluationModelled: false;
  safetySignatureVerified: false;
  controllerSafetyStatusModelled: false;
  boundaries: SafetyMetadataReviewBoundary[];
  message: string;
}

export interface SafetyMetadataReviewReport {
  partitionRows: SafetyMetadataPartitionRow[];
  instructionRows: SafetyInstructionReviewRow[];
  partitionRowCount: number;
  safetyPartitionCount: number;
  standardPartitionCount: number;
  unknownPartitionCount: number;
  safetyTaskCount: number;
  safetyProgramCount: number;
  safetyTagCount: number;
  safetyAoiCount: number;
  instructionCount: number;
  reviewableInstructionCount: number;
  missingBackingTagCount: number;
  nonSafetyBackingTagCount: number;
  issueCount: number;
  warnings: string[];
}

const registry = createDefaultRegistry();

const BOUNDARIES: SafetyMetadataReviewBoundary[] = [
  "no-safety-task-scheduling",
  "no-safety-signature-verification",
  "no-safety-lock-unlock",
  "no-safety-memory-partition-enforcement",
  "no-safety-instruction-execution",
  "no-controller-safety-status",
];

interface TagPath {
  path: string;
  baseTag: string;
  programName?: string;
}

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function normalizeSafetyClass(value: string | undefined): NormalizedSafetyClass | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "safety") return "safety";
  if (normalized === "standard") return "standard";
  return "unknown";
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

function partitionIssue(safetyClass: string | undefined): SafetyMetadataReviewIssue[] {
  return normalizeSafetyClass(safetyClass) === "unknown" ? ["unknown-safety-class"] : [];
}

function partitionMessage(row: Omit<SafetyMetadataPartitionRow, "message">): string {
  if (row.issues.includes("unknown-safety-class")) {
    return `${row.objectKind} "${row.objectName}" has unrecognised safety Class "${row.safetyClass}".`;
  }
  return `${row.objectKind} "${row.objectName}" is marked ${row.safetyClass} for offline review; safety signatures, lock state, and controller safety status are not modelled.`;
}

function partitionRow(input: {
  controller: Controller;
  objectKind: SafetyMetadataObjectKind;
  objectId: string;
  objectName: string;
  safetyClass: string | undefined;
  programId?: string;
  programName?: string;
  dataType?: string;
}): SafetyMetadataPartitionRow | undefined {
  const { controller, safetyClass } = input;
  if (blank(safetyClass)) return undefined;
  const normalizedSafetyClass = normalizeSafetyClass(safetyClass) ?? "unknown";
  const issues = partitionIssue(safetyClass);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    objectKind: input.objectKind,
    objectId: input.objectId,
    objectName: input.objectName,
    programId: input.programId,
    programName: input.programName,
    dataType: input.dataType,
    safetyClass: safetyClass!,
    normalizedSafetyClass,
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    safetyTaskSchedulingModelled: false as const,
    safetySignatureVerified: false as const,
    safetyLockUnlockModelled: false as const,
    safetyMemoryPartitionEnforced: false as const,
    controllerSafetyStatusModelled: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: partitionMessage(rowBase) };
}

function partitionRowsForController(controller: Controller): SafetyMetadataPartitionRow[] {
  const rows: SafetyMetadataPartitionRow[] = [];
  for (const task of controller.tasks) {
    const row = partitionRow({
      controller,
      objectKind: "task",
      objectId: task.id,
      objectName: task.name,
      safetyClass: task.safetyClass,
    });
    if (row) rows.push(row);
  }
  for (const program of controller.programs) {
    const row = partitionRow({
      controller,
      objectKind: "program",
      objectId: program.id,
      objectName: program.name,
      safetyClass: program.safetyClass,
    });
    if (row) rows.push(row);
    for (const tag of program.programTags) {
      const tagRow = partitionRow({
        controller,
        objectKind: "tag",
        objectId: tag.id,
        objectName: tag.name,
        programId: program.id,
        programName: program.name,
        dataType: tag.dataType,
        safetyClass: tag.safetyClass,
      });
      if (tagRow) rows.push(tagRow);
    }
  }
  for (const tag of controller.controllerTags) {
    const row = partitionRow({
      controller,
      objectKind: "tag",
      objectId: tag.id,
      objectName: tag.name,
      dataType: tag.dataType,
      safetyClass: tag.safetyClass,
    });
    if (row) rows.push(row);
  }
  for (const aoi of controller.addOnInstructions) {
    const row = partitionRow({
      controller,
      objectKind: "add-on-instruction",
      objectId: aoi.id,
      objectName: aoi.name,
      safetyClass: aoi.safetyClass,
    });
    if (row) rows.push(row);
  }
  return rows;
}

function safetyInstructionIssues(backingTag: string | undefined, resolvedTag: Tag | undefined): SafetyMetadataReviewIssue[] {
  const issues: SafetyMetadataReviewIssue[] = [];
  if (blank(backingTag) || !resolvedTag) issues.push("missing-backing-tag");
  if (resolvedTag?.safetyClass && normalizeSafetyClass(resolvedTag.safetyClass) !== "safety") {
    issues.push("backing-tag-not-safety-class");
  }
  return issues;
}

function safetyInstructionMessage(row: Omit<SafetyInstructionReviewRow, "message">): string {
  if (row.issues.includes("missing-backing-tag")) {
    return `${row.instructionType} is missing its imported backing safety tag.`;
  }
  if (row.issues.includes("backing-tag-not-safety-class")) {
    return `${row.instructionType} backing tag "${row.backingTag}" is marked ${row.backingTagSafetyClass}; expected Safety for a GuardLogix safety block.`;
  }
  return `${row.instructionType} backing tag "${row.backingTag}" is reviewable offline; safety evaluation and controller safety status are not modelled.`;
}

function safetyInstructionRow(input: {
  controller: Controller;
  program: Program;
  routine: Routine;
  rungId: string;
  rungNumber: number;
  node: LadderNode;
}): SafetyInstructionReviewRow | undefined {
  const { controller, program, routine, rungId, rungNumber, node } = input;
  const def = registry.get(node.instructionType);
  if (!def || def.category !== "safety" || supportLevel(def) !== "model-only") return undefined;

  const backingTag = node.operands[0]?.value.trim();
  const resolvedTag = backingTag ? resolveTag(controller, program, backingTag) : undefined;
  const issues = safetyInstructionIssues(backingTag, resolvedTag);
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
    backingTag,
    backingTagDataType: resolvedTag?.dataType,
    backingTagSafetyClass: resolvedTag?.safetyClass,
    backingTagResolved: Boolean(resolvedTag),
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    modelOnly: true as const,
    safetyInstructionExecutionModelled: false as const,
    safetyEvaluationModelled: false as const,
    safetySignatureVerified: false as const,
    controllerSafetyStatusModelled: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: safetyInstructionMessage(rowBase) };
}

function instructionRowsForController(controller: Controller): SafetyInstructionReviewRow[] {
  const rows: SafetyInstructionReviewRow[] = [];
  for (const program of controller.programs) {
    for (const routine of program.routines) {
      const ladder = getLadder(routine);
      if (!ladder) continue;
      for (const rung of ladder.rungs) {
        for (const node of rungNodes(rung)) {
          const row = safetyInstructionRow({
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
  return rows;
}

function safetyPartition(row: SafetyMetadataPartitionRow): boolean {
  return row.normalizedSafetyClass === "safety";
}

export function safetyMetadataReviewReport(project: PlcProject): SafetyMetadataReviewReport {
  const partitionRows = project.controllers.flatMap(partitionRowsForController);
  const instructionRows = project.controllers.flatMap(instructionRowsForController);
  const warnings = [
    ...partitionRows.filter((row) => row.issues.length > 0).map((row) => row.message),
    ...instructionRows.filter((row) => row.issues.length > 0).map((row) => row.message),
  ];

  return {
    partitionRows,
    instructionRows,
    partitionRowCount: partitionRows.length,
    safetyPartitionCount: partitionRows.filter((row) => row.normalizedSafetyClass === "safety").length,
    standardPartitionCount: partitionRows.filter((row) => row.normalizedSafetyClass === "standard").length,
    unknownPartitionCount: partitionRows.filter((row) => row.normalizedSafetyClass === "unknown").length,
    safetyTaskCount: partitionRows.filter((row) => row.objectKind === "task" && safetyPartition(row)).length,
    safetyProgramCount: partitionRows.filter((row) => row.objectKind === "program" && safetyPartition(row)).length,
    safetyTagCount: partitionRows.filter((row) => row.objectKind === "tag" && safetyPartition(row)).length,
    safetyAoiCount: partitionRows.filter((row) => row.objectKind === "add-on-instruction" && safetyPartition(row)).length,
    instructionCount: instructionRows.length,
    reviewableInstructionCount: instructionRows.filter((row) => row.status === "reviewable").length,
    missingBackingTagCount: instructionRows.filter((row) => row.issues.includes("missing-backing-tag")).length,
    nonSafetyBackingTagCount: instructionRows.filter((row) => row.issues.includes("backing-tag-not-safety-class")).length,
    issueCount:
      partitionRows.filter((row) => row.issues.length > 0).length +
      instructionRows.filter((row) => row.issues.length > 0).length,
    warnings,
  };
}
