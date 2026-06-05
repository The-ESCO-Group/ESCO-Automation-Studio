import type { Controller, ControllerSecurity, PlcProject } from "@esco/core";

/**
 * Offline review of a controller's change-detection scope (`<Security ChangesToDetect>`),
 * mirroring the "Changes to Detect" selection on the Security tab of Studio 5000
 * controller properties.
 *
 * This is intentionally distinct from {@link controllerSecurityReviewReport}: that report
 * only checks that `Code` and `ChangesToDetect` are *present* as a pair and that any
 * FactoryTalk authority metadata is complete — it treats the mask as an opaque token. This
 * report parses the `ChangesToDetect` value itself (a hex bitmask of the change categories
 * that contribute to the controller's change-detection audit value) and surfaces the two
 * states an engineer actually reviews: a malformed mask, and a mask of all zeros, which
 * means edits produce no change-detection audit value even though Security is configured.
 *
 * The mask can exceed the JS safe-integer range (Studio 5000 exports up to 16+ hex digits),
 * so it is never converted to a Number; classification works on the hex digit string
 * directly. Everything is read-only: ESCO never computes the audit value, writes a
 * controller audit log, or monitors online changes.
 */
export type ControllerChangeDetectionReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerChangeDetectionReviewIssue =
  | "unrecognized-change-detection-format"
  | "change-detection-disabled";

export type ControllerChangeDetectionReviewBoundary =
  | "no-change-detection-audit-value"
  | "no-controller-audit-log-write"
  | "no-online-change-monitoring";

export interface ControllerChangeDetectionReviewRow {
  controllerId: string;
  controllerName: string;
  /** Verbatim `ChangesToDetect` value, when present. */
  changesToDetect?: string;
  /**
   * Lower-cased hex digits of the mask with the optional `16#` radix prefix and any
   * `_` digit separators stripped, when the value is recognized as hex.
   */
  normalizedMask?: string;
  /** True when every mask digit is `f` (the Studio 5000 default "detect all changes"). */
  detectsAllChanges?: boolean;
  /** True when every mask digit is `0` (change detection effectively off). */
  detectsNoChanges?: boolean;
  changeDetectionPresent: boolean;
  status: ControllerChangeDetectionReviewStatus;
  issues: ControllerChangeDetectionReviewIssue[];
  changeDetectionAuditValueModelled: false;
  controllerAuditLogWriteModelled: false;
  onlineChangeMonitoringModelled: false;
  boundaries: ControllerChangeDetectionReviewBoundary[];
  message: string;
}

export interface ControllerChangeDetectionReviewReport {
  rows: ControllerChangeDetectionReviewRow[];
  controllerCount: number;
  changeDetectionCount: number;
  reviewableCount: number;
  issueCount: number;
  unrecognizedFormatCount: number;
  disabledCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerChangeDetectionReviewBoundary[] = [
  "no-change-detection-audit-value",
  "no-controller-audit-log-write",
  "no-online-change-monitoring",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

/**
 * Strip the optional `16#` radix prefix and `_` digit separators from a Studio 5000
 * hex mask and return the lower-cased hex digit string. Returns undefined when the
 * remaining value is empty or contains a non-hex character (so it can be surfaced as an
 * unrecognized format).
 */
function normalizeMask(value: string | undefined): string | undefined {
  if (blank(value)) return undefined;
  const digits = value!
    .trim()
    .replace(/^16#/i, "")
    .replace(/_/g, "")
    .toLowerCase();
  if (digits === "" || !/^[0-9a-f]+$/.test(digits)) return undefined;
  return digits;
}

function issuesFor(security: ControllerSecurity | undefined): ControllerChangeDetectionReviewIssue[] {
  const issues: ControllerChangeDetectionReviewIssue[] = [];
  if (blank(security?.changesToDetect)) return issues;

  const mask = normalizeMask(security?.changesToDetect);
  if (mask == null) {
    issues.push("unrecognized-change-detection-format");
    return issues;
  }
  if (/^0+$/.test(mask)) issues.push("change-detection-disabled");
  return issues;
}

function issueLabel(issue: ControllerChangeDetectionReviewIssue): string {
  switch (issue) {
    case "unrecognized-change-detection-format":
      return "ChangesToDetect is not a recognized hex bitmask";
    case "change-detection-disabled":
      return "ChangesToDetect is all zeros, so edits produce no change-detection audit value";
  }
}

function statusFor(
  security: ControllerSecurity | undefined,
  issues: ControllerChangeDetectionReviewIssue[],
): ControllerChangeDetectionReviewStatus {
  if (blank(security?.changesToDetect)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerChangeDetectionReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" change-detection scope needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.changeDetectionPresent) {
    return `Controller "${row.controllerName}" has no imported ChangesToDetect metadata to review.`;
  }
  if (row.detectsAllChanges) {
    return `Controller "${row.controllerName}" tracks all change categories for offline review; the change-detection audit value and controller audit log are not modelled.`;
  }
  return `Controller "${row.controllerName}" ChangesToDetect scope is reviewable offline; the change-detection audit value and controller audit log are not modelled.`;
}

function rowFor(controller: Controller): ControllerChangeDetectionReviewRow {
  const security = controller.security;
  const issues = issuesFor(security);
  const mask = normalizeMask(security?.changesToDetect);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    changesToDetect: present(security?.changesToDetect),
    normalizedMask: mask,
    detectsAllChanges: mask == null ? undefined : /^f+$/.test(mask),
    detectsNoChanges: mask == null ? undefined : /^0+$/.test(mask),
    changeDetectionPresent: !blank(security?.changesToDetect),
    status: statusFor(security, issues),
    issues,
    changeDetectionAuditValueModelled: false as const,
    controllerAuditLogWriteModelled: false as const,
    onlineChangeMonitoringModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerChangeDetectionReviewReport(
  project: PlcProject,
): ControllerChangeDetectionReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerChangeDetectionReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    changeDetectionCount: rows.filter((row) => row.changeDetectionPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    unrecognizedFormatCount: hasIssue("unrecognized-change-detection-format"),
    disabledCount: hasIssue("change-detection-disabled"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
