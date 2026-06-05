import type { Controller, PlcProject } from "@esco/core";

export type ControllerProjectMatchingReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "project-matched"
  | "needs-attention";

export type ControllerProjectMatchingReviewIssue =
  | "partial-project-matching-metadata"
  | "missing-project-serial-number"
  | "project-serial-without-matching"
  | "invalid-match-project-to-controller-flag"
  | "invalid-inhibit-automatic-firmware-update-flag";

export type ControllerProjectMatchingReviewBoundary =
  | "no-controller-communication"
  | "no-controller-serial-number-match"
  | "no-download-preflight"
  | "no-firmware-update"
  | "no-firmware-update-inhibit"
  | "no-controller-replacement-workflow";

export interface ControllerProjectMatchingReviewRow {
  controllerId: string;
  controllerName: string;
  matchProjectToController?: string;
  matchProjectToControllerEnabled?: boolean;
  /** Target controller serial number paired with project matching (display-only). */
  projectSN?: string;
  inhibitAutomaticFirmwareUpdate?: string;
  inhibitAutomaticFirmwareUpdateEnabled?: boolean;
  projectMatchingMetadataPresent: boolean;
  firmwareUpdateMetadataPresent: boolean;
  status: ControllerProjectMatchingReviewStatus;
  issues: ControllerProjectMatchingReviewIssue[];
  controllerCommunicationModelled: false;
  controllerSerialNumberMatchModelled: false;
  downloadPreflightModelled: false;
  firmwareUpdateModelled: false;
  firmwareUpdateInhibitModelled: false;
  controllerReplacementWorkflowModelled: false;
  boundaries: ControllerProjectMatchingReviewBoundary[];
  message: string;
}

export interface ControllerProjectMatchingReviewReport {
  rows: ControllerProjectMatchingReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  projectMatchedCount: number;
  projectSerialCount: number;
  firmwareUpdateInhibitCount: number;
  issueCount: number;
  partialMetadataCount: number;
  missingProjectSerialCount: number;
  orphanProjectSerialCount: number;
  invalidFlagCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerProjectMatchingReviewBoundary[] = [
  "no-controller-communication",
  "no-controller-serial-number-match",
  "no-download-preflight",
  "no-firmware-update",
  "no-firmware-update-inhibit",
  "no-controller-replacement-workflow",
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

function metadataPresent(controller: Controller): boolean {
  return (
    !blank(controller.matchProjectToController) ||
    !blank(controller.projectSN) ||
    !blank(controller.inhibitAutomaticFirmwareUpdate)
  );
}

function issuesFor(controller: Controller): ControllerProjectMatchingReviewIssue[] {
  const issues: ControllerProjectMatchingReviewIssue[] = [];
  const hasMatch = !blank(controller.matchProjectToController);
  const matchEnabled = boolish(controller.matchProjectToController);
  const hasProjectSerial = !blank(controller.projectSN);
  const hasInhibit = !blank(controller.inhibitAutomaticFirmwareUpdate);
  if (hasMatch !== hasInhibit) issues.push("partial-project-matching-metadata");
  if (matchEnabled === true && !hasProjectSerial) issues.push("missing-project-serial-number");
  if (hasProjectSerial && matchEnabled !== true) issues.push("project-serial-without-matching");
  if (hasMatch && boolish(controller.matchProjectToController) == null) {
    issues.push("invalid-match-project-to-controller-flag");
  }
  if (hasInhibit && boolish(controller.inhibitAutomaticFirmwareUpdate) == null) {
    issues.push("invalid-inhibit-automatic-firmware-update-flag");
  }
  return issues;
}

function issueLabel(issue: ControllerProjectMatchingReviewIssue): string {
  switch (issue) {
    case "partial-project-matching-metadata":
      return "partial project/controller matching metadata";
    case "missing-project-serial-number":
      return "ProjectSN is missing while MatchProjectToController is enabled";
    case "project-serial-without-matching":
      return "ProjectSN is present without enabled MatchProjectToController";
    case "invalid-match-project-to-controller-flag":
      return "MatchProjectToController must be true/false or 1/0";
    case "invalid-inhibit-automatic-firmware-update-flag":
      return "InhibitAutomaticFirmwareUpdate must be true/false or 1/0";
  }
}

function statusFor(
  controller: Controller,
  issues: ControllerProjectMatchingReviewIssue[],
): ControllerProjectMatchingReviewStatus {
  if (!metadataPresent(controller)) return "no-metadata";
  if (issues.length) return "needs-attention";
  if (boolish(controller.matchProjectToController)) return "project-matched";
  return "reviewable";
}

function messageFor(row: Omit<ControllerProjectMatchingReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" project/controller matching metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.projectMatchingMetadataPresent && !row.firmwareUpdateMetadataPresent) {
    return `Controller "${row.controllerName}" has no imported project/controller matching metadata to review.`;
  }
  if (row.matchProjectToControllerEnabled) {
    return `Controller "${row.controllerName}" is marked for project/controller matching; serial-number matching, download preflight, and firmware update behavior are not modelled.`;
  }
  return `Controller "${row.controllerName}" project/controller matching metadata is reviewable offline; firmware updates and controller replacement workflows are not modelled.`;
}

function rowFor(controller: Controller): ControllerProjectMatchingReviewRow {
  const issues = issuesFor(controller);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    matchProjectToController: present(controller.matchProjectToController),
    matchProjectToControllerEnabled: boolish(controller.matchProjectToController),
    projectSN: present(controller.projectSN),
    inhibitAutomaticFirmwareUpdate: present(controller.inhibitAutomaticFirmwareUpdate),
    inhibitAutomaticFirmwareUpdateEnabled: boolish(controller.inhibitAutomaticFirmwareUpdate),
    projectMatchingMetadataPresent: !blank(controller.matchProjectToController) || !blank(controller.projectSN),
    firmwareUpdateMetadataPresent: !blank(controller.inhibitAutomaticFirmwareUpdate),
    status: statusFor(controller, issues),
    issues,
    controllerCommunicationModelled: false as const,
    controllerSerialNumberMatchModelled: false as const,
    downloadPreflightModelled: false as const,
    firmwareUpdateModelled: false as const,
    firmwareUpdateInhibitModelled: false as const,
    controllerReplacementWorkflowModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerProjectMatchingReviewReport(project: PlcProject): ControllerProjectMatchingReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerProjectMatchingReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.projectMatchingMetadataPresent || row.firmwareUpdateMetadataPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "project-matched").length,
    projectMatchedCount: rows.filter((row) => row.matchProjectToControllerEnabled).length,
    projectSerialCount: rows.filter((row) => row.projectSN).length,
    firmwareUpdateInhibitCount: rows.filter((row) => row.inhibitAutomaticFirmwareUpdateEnabled).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialMetadataCount: hasIssue("partial-project-matching-metadata"),
    missingProjectSerialCount: hasIssue("missing-project-serial-number"),
    orphanProjectSerialCount: hasIssue("project-serial-without-matching"),
    invalidFlagCount:
      hasIssue("invalid-match-project-to-controller-flag") +
      hasIssue("invalid-inhibit-automatic-firmware-update-flag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
