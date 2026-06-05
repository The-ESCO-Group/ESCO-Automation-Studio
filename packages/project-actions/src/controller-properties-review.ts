import type { Controller, PlcProject, RedundancyInfo } from "@esco/core";

export type ControllerPropertiesReviewStatus =
  | "reviewable"
  | "redundancy-enabled"
  | "needs-attention";

export type ControllerPropertiesReviewIssue =
  | "missing-processor-type"
  | "missing-catalog-number"
  | "missing-firmware-revision"
  | "invalid-time-slice"
  | "invalid-share-unused-time-slice"
  | "invalid-redundancy-pad"
  | "invalid-front-port-crossload-security-flag";

export type ControllerPropertiesReviewBoundary =
  | "no-controller-communication"
  | "no-firmware-compatibility-check"
  | "no-system-overhead-scheduling"
  | "no-controller-status-words"
  | "no-redundancy-switchover"
  | "no-redundancy-memory-pad-enforcement"
  | "no-front-port-crossload";

export interface ControllerRedundancyReview {
  enabled?: boolean;
  keepTestEditsOnSwitchOver?: boolean;
  ioMemoryPadPercentage?: string;
  dataTablePadPercentage?: string;
  frontPortCrossloadEnabledPorts?: string;
  frontPortCrossloadSecurityEnabled?: string;
  frontPortCrossloadSecurityEnabledValue?: boolean;
  redundancyModelled: false;
  frontPortCrossloadModelled: false;
}

export interface ControllerPropertiesReviewRow {
  controllerId: string;
  controllerName: string;
  description?: string;
  processorType?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  chassis?: string;
  slot?: number;
  timeSlice?: string;
  timeSlicePercent?: number;
  shareUnusedTimeSlice?: string;
  shareUnusedTimeSliceEnabled?: boolean;
  redundancy?: ControllerRedundancyReview;
  status: ControllerPropertiesReviewStatus;
  issues: ControllerPropertiesReviewIssue[];
  controllerCommunicationModelled: false;
  firmwareCompatibilityChecked: false;
  systemOverheadSchedulingModelled: false;
  controllerStatusWordsModelled: false;
  boundaries: ControllerPropertiesReviewBoundary[];
  message: string;
}

export interface ControllerPropertiesReviewReport {
  rows: ControllerPropertiesReviewRow[];
  controllerCount: number;
  reviewableCount: number;
  redundancyEnabledCount: number;
  frontPortCrossloadConfiguredCount: number;
  frontPortCrossloadSecurityEnabledCount: number;
  issueCount: number;
  missingIdentityCount: number;
  schedulingIssueCount: number;
  redundancyIssueCount: number;
  warnings: string[];
}

const BASE_BOUNDARIES: ControllerPropertiesReviewBoundary[] = [
  "no-controller-communication",
  "no-firmware-compatibility-check",
  "no-system-overhead-scheduling",
  "no-controller-status-words",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function percent(value: string | undefined): number | undefined {
  if (blank(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function invalidPercent(value: string | undefined): boolean {
  if (blank(value)) return false;
  const parsed = percent(value);
  return parsed == null || parsed < 0 || parsed > 100;
}

function boolish(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

function redundancyReview(info: RedundancyInfo | undefined): ControllerRedundancyReview | undefined {
  if (!info) return undefined;
  return {
    enabled: info.enabled,
    keepTestEditsOnSwitchOver: info.keepTestEditsOnSwitchOver,
    ioMemoryPadPercentage: info.ioMemoryPadPercentage,
    dataTablePadPercentage: info.dataTablePadPercentage,
    frontPortCrossloadEnabledPorts: info.frontPortCrossloadEnabledPorts,
    frontPortCrossloadSecurityEnabled: info.frontPortCrossloadSecurityEnabled,
    frontPortCrossloadSecurityEnabledValue: boolish(info.frontPortCrossloadSecurityEnabled),
    redundancyModelled: false,
    frontPortCrossloadModelled: false,
  };
}

function issuesFor(controller: Controller): ControllerPropertiesReviewIssue[] {
  const issues: ControllerPropertiesReviewIssue[] = [];
  if (blank(controller.processorType)) issues.push("missing-processor-type");
  if (blank(controller.catalogNumber)) issues.push("missing-catalog-number");
  if (blank(controller.firmwareRevision)) issues.push("missing-firmware-revision");
  if (invalidPercent(controller.timeSlice)) issues.push("invalid-time-slice");
  if (!blank(controller.shareUnusedTimeSlice) && boolish(controller.shareUnusedTimeSlice) == null) {
    issues.push("invalid-share-unused-time-slice");
  }
  const redundancy = controller.redundancyInfo;
  if (invalidPercent(redundancy?.ioMemoryPadPercentage) || invalidPercent(redundancy?.dataTablePadPercentage)) {
    issues.push("invalid-redundancy-pad");
  }
  if (
    !blank(redundancy?.frontPortCrossloadSecurityEnabled) &&
    boolish(redundancy?.frontPortCrossloadSecurityEnabled) == null
  ) {
    issues.push("invalid-front-port-crossload-security-flag");
  }
  return issues;
}

function boundariesFor(controller: Controller): ControllerPropertiesReviewBoundary[] {
  const boundaries = new Set<ControllerPropertiesReviewBoundary>(BASE_BOUNDARIES);
  if (controller.redundancyInfo) {
    boundaries.add("no-redundancy-switchover");
    boundaries.add("no-redundancy-memory-pad-enforcement");
    if (
      !blank(controller.redundancyInfo.frontPortCrossloadEnabledPorts) ||
      !blank(controller.redundancyInfo.frontPortCrossloadSecurityEnabled)
    ) {
      boundaries.add("no-front-port-crossload");
    }
  }
  return [...boundaries];
}

function issueLabel(issue: ControllerPropertiesReviewIssue): string {
  switch (issue) {
    case "missing-processor-type":
      return "missing processor type";
    case "missing-catalog-number":
      return "missing catalog number";
    case "missing-firmware-revision":
      return "missing firmware revision";
    case "invalid-time-slice":
      return "time slice must be a percentage from 0 to 100";
    case "invalid-share-unused-time-slice":
      return "ShareUnusedTimeSlice must be 1/0 or true/false";
    case "invalid-redundancy-pad":
      return "redundancy memory pad percentages must be 0 to 100";
    case "invalid-front-port-crossload-security-flag":
      return "FrontPortCrossloadSecurityEnabled must be 1/0 or true/false";
  }
}

function messageFor(row: Omit<ControllerPropertiesReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" properties need attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.redundancy?.enabled) {
    return `Controller "${row.controllerName}" has redundancy enabled for offline review; switchover, memory-pad enforcement, and front-port crossload are not modelled.`;
  }
  if (row.redundancy?.frontPortCrossloadEnabledPorts || row.redundancy?.frontPortCrossloadSecurityEnabled) {
    return `Controller "${row.controllerName}" front-port crossload metadata is reviewable offline; crossload transfer and security enforcement are not modelled.`;
  }
  return `Controller "${row.controllerName}" properties are reviewable offline; firmware compatibility, status words, and system-overhead scheduling are not modelled.`;
}

function statusFor(controller: Controller, issues: ControllerPropertiesReviewIssue[]): ControllerPropertiesReviewStatus {
  if (issues.length) return "needs-attention";
  if (controller.redundancyInfo?.enabled) return "redundancy-enabled";
  return "reviewable";
}

function rowFor(controller: Controller): ControllerPropertiesReviewRow {
  const issues = issuesFor(controller);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    description: controller.description,
    processorType: controller.processorType,
    catalogNumber: controller.catalogNumber,
    firmwareRevision: controller.firmwareRevision,
    chassis: controller.chassis,
    slot: controller.slot,
    timeSlice: controller.timeSlice,
    timeSlicePercent: percent(controller.timeSlice),
    shareUnusedTimeSlice: controller.shareUnusedTimeSlice,
    shareUnusedTimeSliceEnabled: boolish(controller.shareUnusedTimeSlice),
    redundancy: redundancyReview(controller.redundancyInfo),
    status: statusFor(controller, issues),
    issues,
    controllerCommunicationModelled: false as const,
    firmwareCompatibilityChecked: false as const,
    systemOverheadSchedulingModelled: false as const,
    controllerStatusWordsModelled: false as const,
    boundaries: boundariesFor(controller),
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerPropertiesReviewReport(project: PlcProject): ControllerPropertiesReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerPropertiesReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "redundancy-enabled").length,
    redundancyEnabledCount: rows.filter((row) => row.redundancy?.enabled).length,
    frontPortCrossloadConfiguredCount: rows.filter(
      (row) => row.redundancy?.frontPortCrossloadEnabledPorts || row.redundancy?.frontPortCrossloadSecurityEnabled,
    ).length,
    frontPortCrossloadSecurityEnabledCount: rows.filter(
      (row) => row.redundancy?.frontPortCrossloadSecurityEnabledValue === true,
    ).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    missingIdentityCount:
      hasIssue("missing-processor-type") +
      hasIssue("missing-catalog-number") +
      hasIssue("missing-firmware-revision"),
    schedulingIssueCount: hasIssue("invalid-time-slice") + hasIssue("invalid-share-unused-time-slice"),
    redundancyIssueCount:
      hasIssue("invalid-redundancy-pad") + hasIssue("invalid-front-port-crossload-security-flag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
