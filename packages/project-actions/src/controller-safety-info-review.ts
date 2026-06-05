import type { Controller, PlcProject, SafetyInfo } from "@esco/core";

export type ControllerSafetyInfoReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "safety-locked"
  | "needs-attention";

export type ControllerSafetyInfoReviewIssue =
  | "partial-safety-info"
  | "invalid-safety-enabled-flag"
  | "signature-id-without-timestamp"
  | "signature-timestamp-without-id"
  | "locked-without-signature"
  | "run-mode-protect-without-signature";

export type ControllerSafetyInfoReviewBoundary =
  | "no-controller-communication"
  | "no-safety-signature-verification"
  | "no-safety-lock-unlock"
  | "no-safety-enable-disable"
  | "no-safety-task-scheduling"
  | "no-safety-memory-partition-enforcement"
  | "no-safety-io-configuration"
  | "no-controller-safety-status";

export interface ControllerSafetyInfoReviewRow {
  controllerId: string;
  controllerName: string;
  safetyEnabled?: string;
  safetyEnabledValue?: boolean;
  safetyLocked?: boolean;
  safetySignatureId?: string;
  safetySignatureTimestamp?: string;
  signatureRunModeProtect?: boolean;
  configureSafetyIOAlways?: boolean;
  safetyLevel?: string;
  safetyInfoPresent: boolean;
  safetySignaturePresent: boolean;
  safetySignatureTimestampPresent: boolean;
  status: ControllerSafetyInfoReviewStatus;
  issues: ControllerSafetyInfoReviewIssue[];
  controllerCommunicationModelled: false;
  safetySignatureVerified: false;
  safetyLockUnlockModelled: false;
  safetyEnableDisableModelled: false;
  safetyTaskSchedulingModelled: false;
  safetyMemoryPartitionEnforced: false;
  safetyIoConfigurationModelled: false;
  controllerSafetyStatusModelled: false;
  boundaries: ControllerSafetyInfoReviewBoundary[];
  message: string;
}

export interface ControllerSafetyInfoReviewReport {
  rows: ControllerSafetyInfoReviewRow[];
  controllerCount: number;
  safetyInfoCount: number;
  reviewableCount: number;
  safetyLockedCount: number;
  safetyEnabledCount: number;
  safetySignatureCount: number;
  safetySignatureTimestampCount: number;
  runModeProtectCount: number;
  configureSafetyIOAlwaysCount: number;
  safetyLevelCount: number;
  issueCount: number;
  partialSafetyInfoCount: number;
  invalidSafetyEnabledCount: number;
  missingSignatureCount: number;
  signatureTimestampIssueCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerSafetyInfoReviewBoundary[] = [
  "no-controller-communication",
  "no-safety-signature-verification",
  "no-safety-lock-unlock",
  "no-safety-enable-disable",
  "no-safety-task-scheduling",
  "no-safety-memory-partition-enforcement",
  "no-safety-io-configuration",
  "no-controller-safety-status",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function definedCount(values: unknown[]): number {
  return values.filter((value) => value !== undefined).length;
}

function boolish(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

function safetyInfoPresent(info: SafetyInfo | undefined): boolean {
  return info != null && definedCount([
    info.safetyEnabled,
    info.safetyLocked,
    info.safetySignatureId,
    info.safetySignatureTimestamp,
    info.signatureRunModeProtect,
    info.configureSafetyIOAlways,
    info.safetyLevel,
  ]) > 0;
}

function issuesFor(info: SafetyInfo | undefined): ControllerSafetyInfoReviewIssue[] {
  const issues: ControllerSafetyInfoReviewIssue[] = [];
  if (!safetyInfoPresent(info)) return issues;

  const coreFieldCount = definedCount([
    info?.safetyLocked,
    info?.safetySignatureId,
    info?.safetySignatureTimestamp,
    info?.signatureRunModeProtect,
    info?.configureSafetyIOAlways,
  ]);
  if (coreFieldCount > 0 && coreFieldCount < 5) issues.push("partial-safety-info");

  if (!blank(info?.safetyEnabled) && boolish(info?.safetyEnabled) == null) {
    issues.push("invalid-safety-enabled-flag");
  }

  if (!blank(info?.safetySignatureId) && blank(info?.safetySignatureTimestamp)) {
    issues.push("signature-id-without-timestamp");
  }
  if (!blank(info?.safetySignatureTimestamp) && blank(info?.safetySignatureId)) {
    issues.push("signature-timestamp-without-id");
  }
  if (info?.safetyLocked === true && blank(info.safetySignatureId)) {
    issues.push("locked-without-signature");
  }
  if (info?.signatureRunModeProtect === true && blank(info.safetySignatureId)) {
    issues.push("run-mode-protect-without-signature");
  }
  return issues;
}

function issueLabel(issue: ControllerSafetyInfoReviewIssue): string {
  switch (issue) {
    case "partial-safety-info":
      return "partial SafetyInfo metadata";
    case "invalid-safety-enabled-flag":
      return "SafetyEnabled must be 1/0 or true/false";
    case "signature-id-without-timestamp":
      return "SafetySignatureID is present but SafetySignatureTimestamp is missing";
    case "signature-timestamp-without-id":
      return "SafetySignatureTimestamp is present but SafetySignatureID is missing";
    case "locked-without-signature":
      return "SafetyLocked is true but SafetySignatureID is missing";
    case "run-mode-protect-without-signature":
      return "SignatureRunModeProtect is true but SafetySignatureID is missing";
  }
}

function statusFor(
  info: SafetyInfo | undefined,
  issues: ControllerSafetyInfoReviewIssue[],
): ControllerSafetyInfoReviewStatus {
  if (!safetyInfoPresent(info)) return "no-metadata";
  if (issues.length) return "needs-attention";
  if (info?.safetyLocked || info?.signatureRunModeProtect) return "safety-locked";
  return "reviewable";
}

function messageFor(row: Omit<ControllerSafetyInfoReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" SafetyInfo metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.safetyInfoPresent) {
    return `Controller "${row.controllerName}" has no imported GuardLogix SafetyInfo metadata to review.`;
  }
  if (row.safetyLocked || row.signatureRunModeProtect) {
    return `Controller "${row.controllerName}" GuardLogix SafetyInfo is reviewable offline; safety signature verification, enable/disable, lock/unlock, and controller safety status are not modelled.`;
  }
  return `Controller "${row.controllerName}" GuardLogix SafetyInfo is reviewable offline; safety enable/disable, task scheduling, I/O configuration, and controller safety status are not modelled.`;
}

function rowFor(controller: Controller): ControllerSafetyInfoReviewRow {
  const info = controller.safetyInfo;
  const issues = issuesFor(info);
  const present = safetyInfoPresent(info);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    safetyEnabled: info?.safetyEnabled,
    safetyEnabledValue: boolish(info?.safetyEnabled),
    safetyLocked: info?.safetyLocked,
    safetySignatureId: info?.safetySignatureId,
    safetySignatureTimestamp: info?.safetySignatureTimestamp,
    signatureRunModeProtect: info?.signatureRunModeProtect,
    configureSafetyIOAlways: info?.configureSafetyIOAlways,
    safetyLevel: info?.safetyLevel,
    safetyInfoPresent: present,
    safetySignaturePresent: !blank(info?.safetySignatureId),
    safetySignatureTimestampPresent: !blank(info?.safetySignatureTimestamp),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    safetySignatureVerified: false as const,
    safetyLockUnlockModelled: false as const,
    safetyEnableDisableModelled: false as const,
    safetyTaskSchedulingModelled: false as const,
    safetyMemoryPartitionEnforced: false as const,
    safetyIoConfigurationModelled: false as const,
    controllerSafetyStatusModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerSafetyInfoReviewReport(project: PlcProject): ControllerSafetyInfoReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerSafetyInfoReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    safetyInfoCount: rows.filter((row) => row.safetyInfoPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "safety-locked").length,
    safetyLockedCount: rows.filter((row) => row.safetyLocked).length,
    safetyEnabledCount: rows.filter((row) => row.safetyEnabledValue === true).length,
    safetySignatureCount: rows.filter((row) => row.safetySignaturePresent).length,
    safetySignatureTimestampCount: rows.filter((row) => row.safetySignatureTimestampPresent).length,
    runModeProtectCount: rows.filter((row) => row.signatureRunModeProtect).length,
    configureSafetyIOAlwaysCount: rows.filter((row) => row.configureSafetyIOAlways).length,
    safetyLevelCount: rows.filter((row) => !blank(row.safetyLevel)).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialSafetyInfoCount: hasIssue("partial-safety-info"),
    invalidSafetyEnabledCount: hasIssue("invalid-safety-enabled-flag"),
    missingSignatureCount: hasIssue("locked-without-signature") + hasIssue("run-mode-protect-without-signature"),
    signatureTimestampIssueCount:
      hasIssue("signature-id-without-timestamp") + hasIssue("signature-timestamp-without-id"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
