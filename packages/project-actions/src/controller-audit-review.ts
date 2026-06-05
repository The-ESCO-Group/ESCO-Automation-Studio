import type { Controller, PlcProject } from "@esco/core";

export type ControllerAuditReviewStatus = "no-metadata" | "reviewable" | "needs-attention";

export type ControllerAuditReviewIssue = "partial-audit-timestamps";

export type ControllerAuditReviewBoundary =
  | "no-controller-communication"
  | "no-controller-audit-log-read"
  | "no-project-history-sync"
  | "no-timestamp-verification"
  | "no-controller-download";

export interface ControllerAuditReviewRow {
  controllerId: string;
  controllerName: string;
  projectCreationDate?: string;
  lastModifiedDate?: string;
  auditMetadataPresent: boolean;
  status: ControllerAuditReviewStatus;
  issues: ControllerAuditReviewIssue[];
  controllerCommunicationModelled: false;
  controllerAuditLogRead: false;
  projectHistorySyncModelled: false;
  timestampVerified: false;
  controllerDownloadModelled: false;
  boundaries: ControllerAuditReviewBoundary[];
  message: string;
}

export interface ControllerAuditReviewReport {
  rows: ControllerAuditReviewRow[];
  controllerCount: number;
  reviewableCount: number;
  configuredAuditCount: number;
  issueCount: number;
  partialAuditTimestampCount: number;
  warnings: string[];
}

const BASE_BOUNDARIES: ControllerAuditReviewBoundary[] = [
  "no-controller-communication",
  "no-controller-audit-log-read",
  "no-project-history-sync",
  "no-timestamp-verification",
  "no-controller-download",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function issuesFor(controller: Controller): ControllerAuditReviewIssue[] {
  const creationPresent = !blank(controller.projectCreationDate);
  const modifiedPresent = !blank(controller.lastModifiedDate);
  return creationPresent !== modifiedPresent ? ["partial-audit-timestamps"] : [];
}

function messageFor(row: Omit<ControllerAuditReviewRow, "message">): string {
  if (row.issues.includes("partial-audit-timestamps")) {
    return `Controller "${row.controllerName}" project audit timestamp metadata needs attention: ProjectCreationDate and LastModifiedDate should be reviewed together.`;
  }
  if (row.auditMetadataPresent) {
    return `Controller "${row.controllerName}" project audit timestamps are reviewable offline; controller audit logs, project history sync, and timestamp verification are not modelled.`;
  }
  return `Controller "${row.controllerName}" has no imported project audit timestamp metadata to review.`;
}

function statusFor(issues: ControllerAuditReviewIssue[], auditMetadataPresent: boolean): ControllerAuditReviewStatus {
  if (issues.length) return "needs-attention";
  return auditMetadataPresent ? "reviewable" : "no-metadata";
}

function rowFor(controller: Controller): ControllerAuditReviewRow {
  const issues = issuesFor(controller);
  const auditMetadataPresent = !blank(controller.projectCreationDate) || !blank(controller.lastModifiedDate);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    projectCreationDate: controller.projectCreationDate,
    lastModifiedDate: controller.lastModifiedDate,
    auditMetadataPresent,
    status: statusFor(issues, auditMetadataPresent),
    issues,
    controllerCommunicationModelled: false as const,
    controllerAuditLogRead: false as const,
    projectHistorySyncModelled: false as const,
    timestampVerified: false as const,
    controllerDownloadModelled: false as const,
    boundaries: [...BASE_BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerAuditReviewReport(project: PlcProject): ControllerAuditReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerAuditReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    configuredAuditCount: rows.filter((row) => row.auditMetadataPresent).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialAuditTimestampCount: hasIssue("partial-audit-timestamps"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
