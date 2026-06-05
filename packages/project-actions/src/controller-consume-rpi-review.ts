import type { Controller, PlcProject } from "@esco/core";

export type ControllerConsumeRpiReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "rpi-from-producer-enabled"
  | "needs-attention";

export type ControllerConsumeRpiReviewIssue =
  | "invalid-can-use-rpi-from-producer-flag"
  | "invalid-can-use-rpi-from-controller-flag"
  | "conflicting-rpi-source-flags";

export type ControllerConsumeRpiReviewBoundary =
  | "no-controller-communication"
  | "no-produced-tag-connection"
  | "no-consumed-tag-connection"
  | "no-rpi-negotiation"
  | "no-rpi-scheduling"
  | "no-download-preflight";

export interface ControllerConsumeRpiReviewRow {
  controllerId: string;
  controllerName: string;
  canUseRPIFromProducer?: string;
  canUseRPIFromController?: string;
  canUseRPIFromProducerValue?: boolean;
  canUseRPIFromControllerValue?: boolean;
  effectiveCanUseRPIFromProducer?: boolean;
  status: ControllerConsumeRpiReviewStatus;
  issues: ControllerConsumeRpiReviewIssue[];
  controllerCommunicationModelled: false;
  producedTagConnectionModelled: false;
  consumedTagConnectionModelled: false;
  rpiNegotiationModelled: false;
  rpiSchedulingModelled: false;
  downloadPreflightModelled: false;
  boundaries: ControllerConsumeRpiReviewBoundary[];
  message: string;
}

export interface ControllerConsumeRpiReviewReport {
  rows: ControllerConsumeRpiReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  enabledCount: number;
  issueCount: number;
  invalidFlagCount: number;
  conflictingFlagCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerConsumeRpiReviewBoundary[] = [
  "no-controller-communication",
  "no-produced-tag-connection",
  "no-consumed-tag-connection",
  "no-rpi-negotiation",
  "no-rpi-scheduling",
  "no-download-preflight",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function boolish(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

function metadataPresent(controller: Controller): boolean {
  return !blank(controller.canUseRPIFromProducer) || !blank(controller.canUseRPIFromController);
}

function issuesFor(controller: Controller): ControllerConsumeRpiReviewIssue[] {
  const issues: ControllerConsumeRpiReviewIssue[] = [];
  const producerValue = boolish(controller.canUseRPIFromProducer);
  const controllerValue = boolish(controller.canUseRPIFromController);

  if (!blank(controller.canUseRPIFromProducer) && producerValue == null) {
    issues.push("invalid-can-use-rpi-from-producer-flag");
  }
  if (!blank(controller.canUseRPIFromController) && controllerValue == null) {
    issues.push("invalid-can-use-rpi-from-controller-flag");
  }
  if (producerValue != null && controllerValue != null && producerValue !== controllerValue) {
    issues.push("conflicting-rpi-source-flags");
  }
  return issues;
}

function effectiveValue(controller: Controller): boolean | undefined {
  const producerValue = boolish(controller.canUseRPIFromProducer);
  const controllerValue = boolish(controller.canUseRPIFromController);
  if (producerValue != null) return producerValue;
  return controllerValue;
}

function statusFor(
  controller: Controller,
  issues: ControllerConsumeRpiReviewIssue[],
): ControllerConsumeRpiReviewStatus {
  if (!metadataPresent(controller)) return "no-metadata";
  if (issues.length) return "needs-attention";
  if (effectiveValue(controller)) return "rpi-from-producer-enabled";
  return "reviewable";
}

function issueLabel(issue: ControllerConsumeRpiReviewIssue): string {
  switch (issue) {
    case "invalid-can-use-rpi-from-producer-flag":
      return "CanUseRPIFromProducer must be 1/0 or true/false";
    case "invalid-can-use-rpi-from-controller-flag":
      return "CanUseRPIFromController must be 1/0 or true/false";
    case "conflicting-rpi-source-flags":
      return "CanUseRPIFromProducer and CanUseRPIFromController disagree";
  }
}

function messageFor(row: Omit<ControllerConsumeRpiReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" consumed-tag RPI source metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.status === "no-metadata") {
    return `Controller "${row.controllerName}" has no imported consumed-tag RPI source metadata to review.`;
  }
  if (row.effectiveCanUseRPIFromProducer) {
    return `Controller "${row.controllerName}" allows consumed tags to use producer-requested RPI metadata offline; RPI negotiation and scheduling are not modelled.`;
  }
  return `Controller "${row.controllerName}" consumed-tag RPI source metadata is reviewable offline; RPI negotiation and scheduling are not modelled.`;
}

function rowFor(controller: Controller): ControllerConsumeRpiReviewRow {
  const issues = issuesFor(controller);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    canUseRPIFromProducer: controller.canUseRPIFromProducer,
    canUseRPIFromController: controller.canUseRPIFromController,
    canUseRPIFromProducerValue: boolish(controller.canUseRPIFromProducer),
    canUseRPIFromControllerValue: boolish(controller.canUseRPIFromController),
    effectiveCanUseRPIFromProducer: effectiveValue(controller),
    status: statusFor(controller, issues),
    issues,
    controllerCommunicationModelled: false as const,
    producedTagConnectionModelled: false as const,
    consumedTagConnectionModelled: false as const,
    rpiNegotiationModelled: false as const,
    rpiSchedulingModelled: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerConsumeRpiReviewReport(project: PlcProject): ControllerConsumeRpiReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerConsumeRpiReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.status !== "no-metadata").length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "rpi-from-producer-enabled")
      .length,
    enabledCount: rows.filter((row) => row.effectiveCanUseRPIFromProducer === true).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    invalidFlagCount:
      hasIssue("invalid-can-use-rpi-from-producer-flag") +
      hasIssue("invalid-can-use-rpi-from-controller-flag"),
    conflictingFlagCount: hasIssue("conflicting-rpi-source-flags"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
