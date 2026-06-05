import type { Controller, PlcProject } from "@esco/core";

export type ControllerSfcExecutionReviewStatus = "reviewable" | "empty" | "needs-attention";

export type ControllerSfcExecutionReviewIssue =
  | "missing-execution-control"
  | "missing-restart-position"
  | "missing-last-scan";

export type ControllerSfcExecutionReviewBoundary =
  | "no-sfc-step-engine"
  | "no-sfc-transition-evaluation"
  | "no-sfc-restart-state"
  | "no-sfc-last-scan-execution"
  | "no-controller-verified-sfc-scheduling";

export interface ControllerSfcExecutionReviewRow {
  controllerId: string;
  controllerName: string;
  sfcExecutionControl?: string;
  sfcRestartPosition?: string;
  sfcLastScan?: string;
  hasSfcMetadata: boolean;
  status: ControllerSfcExecutionReviewStatus;
  issues: ControllerSfcExecutionReviewIssue[];
  sfcStepEngineModelled: false;
  transitionEvaluationModelled: false;
  restartStateModelled: false;
  lastScanExecutionModelled: false;
  controllerVerifiedSfcScheduling: false;
  boundaries: ControllerSfcExecutionReviewBoundary[];
  message: string;
}

export interface ControllerSfcExecutionReviewReport {
  rows: ControllerSfcExecutionReviewRow[];
  controllerCount: number;
  controllersWithSfcMetadataCount: number;
  emptyControllerCount: number;
  reviewableCount: number;
  issueCount: number;
  missingExecutionControlCount: number;
  missingRestartPositionCount: number;
  missingLastScanCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerSfcExecutionReviewBoundary[] = [
  "no-sfc-step-engine",
  "no-sfc-transition-evaluation",
  "no-sfc-restart-state",
  "no-sfc-last-scan-execution",
  "no-controller-verified-sfc-scheduling",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function hasSfcMetadata(controller: Controller): boolean {
  return !blank(controller.sfcExecutionControl) || !blank(controller.sfcRestartPosition) || !blank(controller.sfcLastScan);
}

function issuesFor(controller: Controller, hasMetadata: boolean): ControllerSfcExecutionReviewIssue[] {
  if (!hasMetadata) return [];
  const issues: ControllerSfcExecutionReviewIssue[] = [];
  if (blank(controller.sfcExecutionControl)) issues.push("missing-execution-control");
  if (blank(controller.sfcRestartPosition)) issues.push("missing-restart-position");
  if (blank(controller.sfcLastScan)) issues.push("missing-last-scan");
  return issues;
}

function issueLabel(issue: ControllerSfcExecutionReviewIssue): string {
  switch (issue) {
    case "missing-execution-control":
      return "missing SFCExecutionControl";
    case "missing-restart-position":
      return "missing SFCRestartPosition";
    case "missing-last-scan":
      return "missing SFCLastScan";
  }
}

function statusFor(hasMetadata: boolean, issues: ControllerSfcExecutionReviewIssue[]): ControllerSfcExecutionReviewStatus {
  if (!hasMetadata) return "empty";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerSfcExecutionReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" SFC execution settings need attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.status === "empty") {
    return `Controller "${row.controllerName}" has no imported SFC execution-control metadata to review.`;
  }
  return `Controller "${row.controllerName}" SFC execution settings are reviewable offline; SFC step execution, transition evaluation, restart state, and last-scan behavior are not modelled.`;
}

function rowFor(controller: Controller): ControllerSfcExecutionReviewRow {
  const hasMetadata = hasSfcMetadata(controller);
  const issues = issuesFor(controller, hasMetadata);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    sfcExecutionControl: controller.sfcExecutionControl,
    sfcRestartPosition: controller.sfcRestartPosition,
    sfcLastScan: controller.sfcLastScan,
    hasSfcMetadata: hasMetadata,
    status: statusFor(hasMetadata, issues),
    issues,
    sfcStepEngineModelled: false as const,
    transitionEvaluationModelled: false as const,
    restartStateModelled: false as const,
    lastScanExecutionModelled: false as const,
    controllerVerifiedSfcScheduling: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerSfcExecutionReviewReport(project: PlcProject): ControllerSfcExecutionReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerSfcExecutionReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: rows.length,
    controllersWithSfcMetadataCount: rows.filter((row) => row.hasSfcMetadata).length,
    emptyControllerCount: rows.filter((row) => row.status === "empty").length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    missingExecutionControlCount: hasIssue("missing-execution-control"),
    missingRestartPositionCount: hasIssue("missing-restart-position"),
    missingLastScanCount: hasIssue("missing-last-scan"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
