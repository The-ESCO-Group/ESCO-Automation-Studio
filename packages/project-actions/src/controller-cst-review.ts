import type { Controller, CstInfo, PlcProject } from "@esco/core";

export type ControllerCstReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerCstReviewIssue =
  | "missing-master-id"
  | "invalid-master-id";

export type ControllerCstReviewBoundary =
  | "no-controller-communication"
  | "no-cst-clock-coordination"
  | "no-cst-master-election"
  | "no-chassis-time-sync"
  | "no-live-time-status";

export interface ControllerCstReviewRow {
  controllerId: string;
  controllerName: string;
  masterId?: string;
  masterIdValue?: number;
  cstPresent: boolean;
  masterIdPresent: boolean;
  status: ControllerCstReviewStatus;
  issues: ControllerCstReviewIssue[];
  controllerCommunicationModelled: false;
  cstClockCoordinationModelled: false;
  cstMasterElectionModelled: false;
  chassisTimeSyncModelled: false;
  liveTimeStatusModelled: false;
  boundaries: ControllerCstReviewBoundary[];
  message: string;
}

export interface ControllerCstReviewReport {
  rows: ControllerCstReviewRow[];
  controllerCount: number;
  cstCount: number;
  reviewableCount: number;
  issueCount: number;
  missingMasterIdCount: number;
  invalidMasterIdCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerCstReviewBoundary[] = [
  "no-controller-communication",
  "no-cst-clock-coordination",
  "no-cst-master-election",
  "no-chassis-time-sync",
  "no-live-time-status",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function cstPresent(info: CstInfo | undefined): boolean {
  return info != null;
}

function parseMasterId(value: string | undefined): number | undefined {
  if (blank(value)) return undefined;
  const trimmed = value!.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function issuesFor(info: CstInfo | undefined): ControllerCstReviewIssue[] {
  if (!cstPresent(info)) return [];
  if (blank(info?.masterId)) return ["missing-master-id"];
  if (parseMasterId(info?.masterId) == null) return ["invalid-master-id"];
  return [];
}

function issueLabel(issue: ControllerCstReviewIssue): string {
  switch (issue) {
    case "missing-master-id":
      return "CST MasterID is missing";
    case "invalid-master-id":
      return "CST MasterID must be a non-negative integer";
  }
}

function statusFor(
  info: CstInfo | undefined,
  issues: ControllerCstReviewIssue[],
): ControllerCstReviewStatus {
  if (!cstPresent(info)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerCstReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" CST metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.cstPresent) {
    return `Controller "${row.controllerName}" has no imported CST metadata to review.`;
  }
  return `Controller "${row.controllerName}" CST metadata is reviewable offline; CST clock coordination, master election, chassis time synchronization, and live time status are not modelled.`;
}

function rowFor(controller: Controller): ControllerCstReviewRow {
  const info = controller.cst;
  const issues = issuesFor(info);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    masterId: present(info?.masterId),
    masterIdValue: parseMasterId(info?.masterId),
    cstPresent: cstPresent(info),
    masterIdPresent: !blank(info?.masterId),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    cstClockCoordinationModelled: false as const,
    cstMasterElectionModelled: false as const,
    chassisTimeSyncModelled: false as const,
    liveTimeStatusModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerCstReviewReport(project: PlcProject): ControllerCstReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerCstReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: rows.length,
    cstCount: rows.filter((row) => row.cstPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    missingMasterIdCount: hasIssue("missing-master-id"),
    invalidMasterIdCount: hasIssue("invalid-master-id"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
