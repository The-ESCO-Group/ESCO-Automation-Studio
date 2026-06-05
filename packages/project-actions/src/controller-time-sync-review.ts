import type { Controller, PlcProject, TimeSyncInfo } from "@esco/core";

export type ControllerTimeSyncReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerTimeSyncReviewIssue =
  | "partial-time-sync"
  | "invalid-priority1"
  | "invalid-priority2";

export type ControllerTimeSyncReviewBoundary =
  | "no-controller-communication"
  | "no-controller-clock-sync"
  | "no-cip-sync-runtime"
  | "no-ptp-grandmaster-election"
  | "no-controller-time-quality";

export interface ControllerTimeSyncReviewRow {
  controllerId: string;
  controllerName: string;
  ptpEnable?: boolean;
  priority1?: string;
  priority1Value?: number;
  priority2?: string;
  priority2Value?: number;
  timeSyncPresent: boolean;
  ptpEnablePresent: boolean;
  priority1Present: boolean;
  priority2Present: boolean;
  status: ControllerTimeSyncReviewStatus;
  issues: ControllerTimeSyncReviewIssue[];
  controllerCommunicationModelled: false;
  controllerClockSyncModelled: false;
  cipSyncRuntimeModelled: false;
  ptpGrandmasterElectionModelled: false;
  controllerTimeQualityModelled: false;
  boundaries: ControllerTimeSyncReviewBoundary[];
  message: string;
}

export interface ControllerTimeSyncReviewReport {
  rows: ControllerTimeSyncReviewRow[];
  controllerCount: number;
  timeSyncCount: number;
  reviewableCount: number;
  ptpEnabledCount: number;
  issueCount: number;
  partialTimeSyncCount: number;
  invalidPriorityCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerTimeSyncReviewBoundary[] = [
  "no-controller-communication",
  "no-controller-clock-sync",
  "no-cip-sync-runtime",
  "no-ptp-grandmaster-election",
  "no-controller-time-quality",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function timeSyncPresent(info: TimeSyncInfo | undefined): boolean {
  return info != null && (info.ptpEnable != null || !blank(info.priority1) || !blank(info.priority2));
}

function parsePriority(value: string | undefined): number | undefined {
  if (blank(value)) return undefined;
  const trimmed = value!.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : undefined;
}

function invalidPriority(value: string | undefined): boolean {
  return !blank(value) && parsePriority(value) == null;
}

function issuesFor(info: TimeSyncInfo | undefined): ControllerTimeSyncReviewIssue[] {
  const issues: ControllerTimeSyncReviewIssue[] = [];
  if (!timeSyncPresent(info)) return issues;

  const hasPtpEnable = info?.ptpEnable != null;
  const hasPriority1 = !blank(info?.priority1);
  const hasPriority2 = !blank(info?.priority2);
  if (!hasPtpEnable || !hasPriority1 || !hasPriority2) issues.push("partial-time-sync");
  if (invalidPriority(info?.priority1)) issues.push("invalid-priority1");
  if (invalidPriority(info?.priority2)) issues.push("invalid-priority2");
  return issues;
}

function issueLabel(issue: ControllerTimeSyncReviewIssue): string {
  switch (issue) {
    case "partial-time-sync":
      return "partial TimeSynchronize metadata";
    case "invalid-priority1":
      return "Priority1 must be an integer from 0 to 255";
    case "invalid-priority2":
      return "Priority2 must be an integer from 0 to 255";
  }
}

function statusFor(
  info: TimeSyncInfo | undefined,
  issues: ControllerTimeSyncReviewIssue[],
): ControllerTimeSyncReviewStatus {
  if (!timeSyncPresent(info)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerTimeSyncReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" TimeSynchronize metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.timeSyncPresent) {
    return `Controller "${row.controllerName}" has no imported TimeSynchronize metadata to review.`;
  }
  return `Controller "${row.controllerName}" TimeSynchronize metadata is reviewable offline; controller clock synchronization, PTP grandmaster election, and CIP Sync runtime behavior are not modelled.`;
}

function rowFor(controller: Controller): ControllerTimeSyncReviewRow {
  const info = controller.timeSync;
  const issues = issuesFor(info);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    ptpEnable: info?.ptpEnable,
    priority1: present(info?.priority1),
    priority1Value: parsePriority(info?.priority1),
    priority2: present(info?.priority2),
    priority2Value: parsePriority(info?.priority2),
    timeSyncPresent: timeSyncPresent(info),
    ptpEnablePresent: info?.ptpEnable != null,
    priority1Present: !blank(info?.priority1),
    priority2Present: !blank(info?.priority2),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    controllerClockSyncModelled: false as const,
    cipSyncRuntimeModelled: false as const,
    ptpGrandmasterElectionModelled: false as const,
    controllerTimeQualityModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerTimeSyncReviewReport(project: PlcProject): ControllerTimeSyncReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerTimeSyncReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    timeSyncCount: rows.filter((row) => row.timeSyncPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    ptpEnabledCount: rows.filter((row) => row.ptpEnable === true).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialTimeSyncCount: hasIssue("partial-time-sync"),
    invalidPriorityCount: hasIssue("invalid-priority1") + hasIssue("invalid-priority2"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
