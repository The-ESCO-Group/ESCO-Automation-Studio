import type { Controller, PlcProject } from "@esco/core";

/**
 * Offline review projection for L5X export provenance — the originating
 * Studio 5000 software version (`<RSLogix5000Content SoftwareRevision>`, e.g.
 * "32.04") and export owner (`Owner`, e.g. "John Doe, Acme Corp") recorded on
 * the root element. ESCO surfaces these read-only for review and preserves them
 * on export; it never compares the version against the installed Studio 5000,
 * enforces firmware/software compatibility, or talks to a controller.
 */
export type ControllerExportProvenanceReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerExportProvenanceReviewIssue =
  | "invalid-software-revision-format";

export type ControllerExportProvenanceReviewBoundary =
  | "no-controller-communication"
  | "no-software-version-enforcement"
  | "no-firmware-compatibility-check"
  | "no-download-preflight";

export interface ControllerExportProvenanceReviewRow {
  controllerId: string;
  controllerName: string;
  softwareRevision?: string;
  exportOwner?: string;
  softwareRevisionPresent: boolean;
  exportOwnerPresent: boolean;
  provenancePresent: boolean;
  status: ControllerExportProvenanceReviewStatus;
  issues: ControllerExportProvenanceReviewIssue[];
  controllerCommunicationModelled: false;
  softwareVersionEnforcementModelled: false;
  firmwareCompatibilityModelled: false;
  downloadPreflightModelled: false;
  boundaries: ControllerExportProvenanceReviewBoundary[];
  message: string;
}

export interface ControllerExportProvenanceReviewReport {
  rows: ControllerExportProvenanceReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  softwareRevisionCount: number;
  exportOwnerCount: number;
  issueCount: number;
  invalidSoftwareRevisionCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerExportProvenanceReviewBoundary[] = [
  "no-controller-communication",
  "no-software-version-enforcement",
  "no-firmware-compatibility-check",
  "no-download-preflight",
];

/** Studio 5000 software revisions are dotted numerics, e.g. "32.04" or "33.01.00". */
const SOFTWARE_REVISION_PATTERN = /^\d+(\.\d+)+$/;

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function issuesFor(controller: Controller): ControllerExportProvenanceReviewIssue[] {
  const revision = present(controller.softwareRevision);
  if (revision != null && !SOFTWARE_REVISION_PATTERN.test(revision)) {
    return ["invalid-software-revision-format"];
  }
  return [];
}

function issueLabel(issue: ControllerExportProvenanceReviewIssue): string {
  switch (issue) {
    case "invalid-software-revision-format":
      return "SoftwareRevision should be a dotted version such as 32.04";
  }
}

function statusFor(
  row: { provenancePresent: boolean },
  issues: ControllerExportProvenanceReviewIssue[],
): ControllerExportProvenanceReviewStatus {
  if (!row.provenancePresent) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerExportProvenanceReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" export provenance needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.provenancePresent) {
    return `Controller "${row.controllerName}" has no imported export provenance (SoftwareRevision / Owner) to review.`;
  }
  const parts: string[] = [];
  if (row.softwareRevisionPresent) parts.push(`software revision ${row.softwareRevision}`);
  if (row.exportOwnerPresent) parts.push(`owner ${row.exportOwner}`);
  return `Controller "${row.controllerName}" was exported by ${parts.join(", ")} (read-only provenance); software-version enforcement, firmware compatibility, and download preflight are not modelled.`;
}

function rowFor(controller: Controller): ControllerExportProvenanceReviewRow {
  const issues = issuesFor(controller);
  const softwareRevisionPresent = !blank(controller.softwareRevision);
  const exportOwnerPresent = !blank(controller.exportOwner);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    softwareRevision: present(controller.softwareRevision),
    exportOwner: present(controller.exportOwner),
    softwareRevisionPresent,
    exportOwnerPresent,
    provenancePresent: softwareRevisionPresent || exportOwnerPresent,
    status: statusFor({ provenancePresent: softwareRevisionPresent || exportOwnerPresent }, issues),
    issues,
    controllerCommunicationModelled: false as const,
    softwareVersionEnforcementModelled: false as const,
    firmwareCompatibilityModelled: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerExportProvenanceReviewReport(
  project: PlcProject,
): ControllerExportProvenanceReviewReport {
  const rows = project.controllers.map(rowFor);

  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.provenancePresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    softwareRevisionCount: rows.filter((row) => row.softwareRevisionPresent).length,
    exportOwnerCount: rows.filter((row) => row.exportOwnerPresent).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    invalidSoftwareRevisionCount: rows.filter((row) =>
      row.issues.includes("invalid-software-revision-format")
    ).length,
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
