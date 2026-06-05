import type { Controller, PlcProject, WallClockTimeInfo } from "@esco/core";

/**
 * Offline review of a controller's configured time zone (`<WallClockTime TimeZone>`),
 * mirroring the Date/Time tab of Studio 5000 controller properties.
 *
 * This is intentionally distinct from {@link controllerWallClockReviewReport}: that
 * report validates the raw `LocalTimeAdjustment` microsecond offset and flags partial
 * metadata. This report parses the canonical "(GMT±HH:MM) Label" time-zone string and
 * cross-checks its GMT offset against `LocalTimeAdjustment` — the same derivation Studio
 * 5000 performs when an engineer picks a zone from the dropdown. Everything is read-only;
 * no clock is read or set, and daylight-saving transitions are never modelled.
 */
export type ControllerTimeZoneReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerTimeZoneReviewIssue =
  | "unrecognized-time-zone-format"
  | "time-zone-offset-mismatch";

export type ControllerTimeZoneReviewBoundary =
  | "no-time-zone-dialog"
  | "no-daylight-saving-runtime"
  | "no-controller-clock-runtime";

export interface ControllerTimeZoneReviewRow {
  controllerId: string;
  controllerName: string;
  timeZone?: string;
  /** GMT offset in hours parsed from the "(GMT±HH:MM)" prefix, when recognized. */
  timeZoneGmtOffsetHours?: number;
  /** Offset in hours derived from `LocalTimeAdjustment`, when it parses. */
  localTimeAdjustmentHours?: number;
  timeZonePresent: boolean;
  localTimeAdjustmentPresent: boolean;
  status: ControllerTimeZoneReviewStatus;
  issues: ControllerTimeZoneReviewIssue[];
  timeZoneDialogModelled: false;
  daylightSavingRuntimeModelled: false;
  controllerClockRuntimeModelled: false;
  boundaries: ControllerTimeZoneReviewBoundary[];
  message: string;
}

export interface ControllerTimeZoneReviewReport {
  rows: ControllerTimeZoneReviewRow[];
  controllerCount: number;
  timeZoneCount: number;
  reviewableCount: number;
  issueCount: number;
  unrecognizedFormatCount: number;
  offsetMismatchCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerTimeZoneReviewBoundary[] = [
  "no-time-zone-dialog",
  "no-daylight-saving-runtime",
  "no-controller-clock-runtime",
];

const MICROSECONDS_PER_HOUR = 3_600_000_000;
/** Allowable disagreement between the two offsets: one minute, in hours. */
const OFFSET_TOLERANCE_HOURS = 1 / 60;
/** Studio 5000 time-zone offsets fall within the +/-14 hour UTC range. */
const MAX_OFFSET_HOURS = 14;

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

/**
 * Parse the leading "(GMT±HH:MM)" token of a Studio 5000 time-zone label into a signed
 * hour offset. Returns undefined when the token is absent, malformed, or names an
 * impossible offset (so it can be surfaced as an unrecognized format).
 */
function gmtOffsetHours(timeZone: string | undefined): number | undefined {
  if (blank(timeZone)) return undefined;
  const match = /^\(GMT([+-])(\d{2}):(\d{2})\)/.exec(timeZone!.trim());
  if (!match) return undefined;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (minutes > 59) return undefined;
  const offset = sign * (hours + minutes / 60);
  if (Math.abs(offset) > MAX_OFFSET_HOURS) return undefined;
  return offset;
}

function localTimeAdjustmentHours(value: string | undefined): number | undefined {
  if (blank(value)) return undefined;
  const trimmed = value!.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return Number(trimmed) / MICROSECONDS_PER_HOUR;
}

function issuesFor(info: WallClockTimeInfo | undefined): ControllerTimeZoneReviewIssue[] {
  const issues: ControllerTimeZoneReviewIssue[] = [];
  if (blank(info?.timeZone)) return issues;

  const gmtOffset = gmtOffsetHours(info?.timeZone);
  if (gmtOffset == null) {
    issues.push("unrecognized-time-zone-format");
    return issues;
  }

  const adjustment = localTimeAdjustmentHours(info?.localTimeAdjustment);
  if (adjustment != null && Math.abs(adjustment - gmtOffset) > OFFSET_TOLERANCE_HOURS) {
    issues.push("time-zone-offset-mismatch");
  }
  return issues;
}

function issueLabel(issue: ControllerTimeZoneReviewIssue): string {
  switch (issue) {
    case "unrecognized-time-zone-format":
      return 'TimeZone is not a recognized "(GMT±HH:MM) Label" value';
    case "time-zone-offset-mismatch":
      return "TimeZone GMT offset disagrees with LocalTimeAdjustment";
  }
}

function statusFor(
  info: WallClockTimeInfo | undefined,
  issues: ControllerTimeZoneReviewIssue[],
): ControllerTimeZoneReviewStatus {
  if (blank(info?.timeZone)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerTimeZoneReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" TimeZone metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.timeZonePresent) {
    return `Controller "${row.controllerName}" has no imported TimeZone metadata to review.`;
  }
  return `Controller "${row.controllerName}" TimeZone metadata is reviewable offline; the time-zone dialog, daylight-saving transitions, and controller clock runtime are not modelled.`;
}

function rowFor(controller: Controller): ControllerTimeZoneReviewRow {
  const info = controller.wallClockTime;
  const issues = issuesFor(info);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    timeZone: present(info?.timeZone),
    timeZoneGmtOffsetHours: gmtOffsetHours(info?.timeZone),
    localTimeAdjustmentHours: localTimeAdjustmentHours(info?.localTimeAdjustment),
    timeZonePresent: !blank(info?.timeZone),
    localTimeAdjustmentPresent: !blank(info?.localTimeAdjustment),
    status: statusFor(info, issues),
    issues,
    timeZoneDialogModelled: false as const,
    daylightSavingRuntimeModelled: false as const,
    controllerClockRuntimeModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerTimeZoneReviewReport(project: PlcProject): ControllerTimeZoneReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerTimeZoneReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    timeZoneCount: rows.filter((row) => row.timeZonePresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    unrecognizedFormatCount: hasIssue("unrecognized-time-zone-format"),
    offsetMismatchCount: hasIssue("time-zone-offset-mismatch"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
