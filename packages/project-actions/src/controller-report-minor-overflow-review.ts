import type { Controller, PlcProject } from "@esco/core";

export type ControllerReportMinorOverflowReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "overflow-reporting-enabled"
  | "needs-attention";

export type ControllerReportMinorOverflowReviewIssue =
  | "invalid-report-minor-overflow-flag";

export type ControllerReportMinorOverflowReviewBoundary =
  | "no-controller-communication"
  | "no-arithmetic-overflow-fault-generation"
  | "no-minor-fault-status"
  | "no-controller-fault-log"
  | "no-download-preflight";

export interface ControllerReportMinorOverflowReviewRow {
  controllerId: string;
  controllerName: string;
  reportMinorOverflow?: string;
  reportMinorOverflowEnabled?: boolean;
  reportMinorOverflowPresent: boolean;
  status: ControllerReportMinorOverflowReviewStatus;
  issues: ControllerReportMinorOverflowReviewIssue[];
  controllerCommunicationModelled: false;
  arithmeticOverflowFaultGenerationModelled: false;
  minorFaultStatusModelled: false;
  controllerFaultLogModelled: false;
  downloadPreflightModelled: false;
  boundaries: ControllerReportMinorOverflowReviewBoundary[];
  message: string;
}

export interface ControllerReportMinorOverflowReviewReport {
  rows: ControllerReportMinorOverflowReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  enabledCount: number;
  disabledCount: number;
  issueCount: number;
  invalidFlagCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerReportMinorOverflowReviewBoundary[] = [
  "no-controller-communication",
  "no-arithmetic-overflow-fault-generation",
  "no-minor-fault-status",
  "no-controller-fault-log",
  "no-download-preflight",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function boolish(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

function issuesFor(controller: Controller): ControllerReportMinorOverflowReviewIssue[] {
  if (blank(controller.reportMinorOverflow)) return [];
  if (boolish(controller.reportMinorOverflow) == null) return ["invalid-report-minor-overflow-flag"];
  return [];
}

function issueLabel(issue: ControllerReportMinorOverflowReviewIssue): string {
  switch (issue) {
    case "invalid-report-minor-overflow-flag":
      return "ReportMinorOverflow must be true/false or 1/0";
  }
}

function statusFor(
  controller: Controller,
  issues: ControllerReportMinorOverflowReviewIssue[],
): ControllerReportMinorOverflowReviewStatus {
  if (blank(controller.reportMinorOverflow)) return "no-metadata";
  if (issues.length) return "needs-attention";
  if (boolish(controller.reportMinorOverflow)) return "overflow-reporting-enabled";
  return "reviewable";
}

function messageFor(row: Omit<ControllerReportMinorOverflowReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" ReportMinorOverflow metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.reportMinorOverflowPresent) {
    return `Controller "${row.controllerName}" has no imported ReportMinorOverflow metadata to review.`;
  }
  if (row.reportMinorOverflowEnabled) {
    return `Controller "${row.controllerName}" has arithmetic-overflow minor-fault reporting enabled for offline review; overflow fault generation, minor-fault status, and controller fault logs are not modelled.`;
  }
  return `Controller "${row.controllerName}" has arithmetic-overflow minor-fault reporting disabled for offline review; overflow fault generation, minor-fault status, and controller fault logs are not modelled.`;
}

function rowFor(controller: Controller): ControllerReportMinorOverflowReviewRow {
  const issues = issuesFor(controller);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    reportMinorOverflow: present(controller.reportMinorOverflow),
    reportMinorOverflowEnabled: boolish(controller.reportMinorOverflow),
    reportMinorOverflowPresent: !blank(controller.reportMinorOverflow),
    status: statusFor(controller, issues),
    issues,
    controllerCommunicationModelled: false as const,
    arithmeticOverflowFaultGenerationModelled: false as const,
    minorFaultStatusModelled: false as const,
    controllerFaultLogModelled: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerReportMinorOverflowReviewReport(
  project: PlcProject,
): ControllerReportMinorOverflowReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerReportMinorOverflowReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.reportMinorOverflowPresent).length,
    reviewableCount: rows.filter((row) =>
      row.status === "reviewable" || row.status === "overflow-reporting-enabled"
    ).length,
    enabledCount: rows.filter((row) => row.reportMinorOverflowEnabled === true).length,
    disabledCount: rows.filter((row) => row.reportMinorOverflowEnabled === false).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    invalidFlagCount: hasIssue("invalid-report-minor-overflow-flag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
