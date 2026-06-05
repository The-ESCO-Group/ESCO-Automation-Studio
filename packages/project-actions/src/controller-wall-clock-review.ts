import type { Controller, PlcProject, WallClockTimeInfo } from "@esco/core";

export type ControllerWallClockReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerWallClockReviewIssue =
  | "partial-wall-clock-time"
  | "invalid-local-time-adjustment"
  | "local-time-adjustment-out-of-range";

export type ControllerWallClockReviewBoundary =
  | "no-controller-communication"
  | "no-controller-clock-read"
  | "no-controller-clock-set"
  | "no-time-sync-service"
  | "no-time-zone-dialog"
  | "no-scheduled-time-change"
  | "no-wall-clock-runtime";

export interface ControllerWallClockReviewRow {
  controllerId: string;
  controllerName: string;
  localTimeAdjustment?: string;
  localTimeAdjustmentHours?: number;
  timeZone?: string;
  wallClockTimePresent: boolean;
  localTimeAdjustmentPresent: boolean;
  timeZonePresent: boolean;
  status: ControllerWallClockReviewStatus;
  issues: ControllerWallClockReviewIssue[];
  controllerCommunicationModelled: false;
  controllerClockReadModelled: false;
  controllerClockSetModelled: false;
  timeSyncServiceModelled: false;
  timeZoneDialogModelled: false;
  scheduledTimeChangeModelled: false;
  wallClockRuntimeModelled: false;
  boundaries: ControllerWallClockReviewBoundary[];
  message: string;
}

export interface ControllerWallClockReviewReport {
  rows: ControllerWallClockReviewRow[];
  controllerCount: number;
  wallClockTimeCount: number;
  reviewableCount: number;
  issueCount: number;
  partialWallClockTimeCount: number;
  invalidLocalTimeAdjustmentCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerWallClockReviewBoundary[] = [
  "no-controller-communication",
  "no-controller-clock-read",
  "no-controller-clock-set",
  "no-time-sync-service",
  "no-time-zone-dialog",
  "no-scheduled-time-change",
  "no-wall-clock-runtime",
];

const MICROSECONDS_PER_HOUR = 3_600_000_000n;
const MAX_OFFSET_MICROSECONDS = 86_400_000_000n;

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function parseIntegerMicroseconds(value: string | undefined): bigint | undefined {
  if (blank(value)) return undefined;
  const trimmed = value!.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return BigInt(trimmed);
}

function wallClockTimePresent(info: WallClockTimeInfo | undefined): boolean {
  return info != null && (!blank(info.localTimeAdjustment) || !blank(info.timeZone));
}

function issuesFor(info: WallClockTimeInfo | undefined): ControllerWallClockReviewIssue[] {
  const issues: ControllerWallClockReviewIssue[] = [];
  if (!wallClockTimePresent(info)) return issues;

  const hasOffset = !blank(info?.localTimeAdjustment);
  const hasTimeZone = !blank(info?.timeZone);
  if (hasOffset !== hasTimeZone) issues.push("partial-wall-clock-time");

  const adjustment = parseIntegerMicroseconds(info?.localTimeAdjustment);
  if (hasOffset && adjustment == null) {
    issues.push("invalid-local-time-adjustment");
  } else if (adjustment != null && (adjustment < -MAX_OFFSET_MICROSECONDS || adjustment > MAX_OFFSET_MICROSECONDS)) {
    issues.push("local-time-adjustment-out-of-range");
  }
  return issues;
}

function issueLabel(issue: ControllerWallClockReviewIssue): string {
  switch (issue) {
    case "partial-wall-clock-time":
      return "partial WallClockTime metadata";
    case "invalid-local-time-adjustment":
      return "LocalTimeAdjustment must be an integer microsecond offset";
    case "local-time-adjustment-out-of-range":
      return "LocalTimeAdjustment is outside a +/-24 hour offset";
  }
}

function statusFor(
  info: WallClockTimeInfo | undefined,
  issues: ControllerWallClockReviewIssue[],
): ControllerWallClockReviewStatus {
  if (!wallClockTimePresent(info)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function offsetHours(value: string | undefined): number | undefined {
  const adjustment = parseIntegerMicroseconds(value);
  if (adjustment == null) return undefined;
  return Number(adjustment) / Number(MICROSECONDS_PER_HOUR);
}

function messageFor(row: Omit<ControllerWallClockReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" WallClockTime metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.wallClockTimePresent) {
    return `Controller "${row.controllerName}" has no imported WallClockTime metadata to review.`;
  }
  return `Controller "${row.controllerName}" WallClockTime metadata is reviewable offline; controller clock read/set, time synchronization, and wall-clock runtime behavior are not modelled.`;
}

function rowFor(controller: Controller): ControllerWallClockReviewRow {
  const info = controller.wallClockTime;
  const issues = issuesFor(info);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    localTimeAdjustment: present(info?.localTimeAdjustment),
    localTimeAdjustmentHours: offsetHours(info?.localTimeAdjustment),
    timeZone: present(info?.timeZone),
    wallClockTimePresent: wallClockTimePresent(info),
    localTimeAdjustmentPresent: !blank(info?.localTimeAdjustment),
    timeZonePresent: !blank(info?.timeZone),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    controllerClockReadModelled: false as const,
    controllerClockSetModelled: false as const,
    timeSyncServiceModelled: false as const,
    timeZoneDialogModelled: false as const,
    scheduledTimeChangeModelled: false as const,
    wallClockRuntimeModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerWallClockReviewReport(project: PlcProject): ControllerWallClockReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerWallClockReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    wallClockTimeCount: rows.filter((row) => row.wallClockTimePresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialWallClockTimeCount: hasIssue("partial-wall-clock-time"),
    invalidLocalTimeAdjustmentCount:
      hasIssue("invalid-local-time-adjustment") +
      hasIssue("local-time-adjustment-out-of-range"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
