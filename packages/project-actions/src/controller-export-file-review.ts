import type { Controller, PlcProject } from "@esco/core";

/**
 * Offline review projection for the two remaining root
 * `<RSLogix5000Content>` attributes that describe the export *file itself* —
 * when Studio 5000 generated it (`ExportDate`, e.g. "Tue Jan 02 14:03:11 2024")
 * and whether it embeds the surrounding project context beyond the exported
 * target (`ContainsContext`, "true"/"false"). Both are read-only provenance an
 * engineer reviews before importing: a malformed export date, or a partial
 * export that does not embed context (so cross-references to omitted objects
 * cannot be resolved offline), is worth surfacing.
 *
 * This is intentionally distinct from {@link controllerExportProvenanceReviewReport}
 * (originating SoftwareRevision / Owner) and {@link controllerExportOptionsReviewReport}
 * (the ExportOptions data-class token list). ESCO never parses the export date as
 * a real timestamp, regenerates the file, resolves omitted context, or talks to a
 * controller; both attributes are preserved verbatim on export.
 */
export type ControllerExportFileReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerExportFileReviewIssue =
  | "invalid-export-date-format"
  | "unrecognized-contains-context-flag";

export type ControllerExportFileReviewBoundary =
  | "no-controller-communication"
  | "no-export-time-verification"
  | "no-export-regeneration"
  | "no-context-resolution"
  | "no-download-preflight";

export interface ControllerExportFileReviewRow {
  controllerId: string;
  controllerName: string;
  exportDate?: string;
  containsContext?: string;
  exportDatePresent: boolean;
  containsContextPresent: boolean;
  /** True only when ContainsContext parses to a recognized truthy flag. */
  embedsProjectContext: boolean;
  exportFileMetadataPresent: boolean;
  status: ControllerExportFileReviewStatus;
  issues: ControllerExportFileReviewIssue[];
  controllerCommunicationModelled: false;
  exportTimeVerified: false;
  exportRegenerationModelled: false;
  contextResolutionModelled: false;
  downloadPreflightModelled: false;
  boundaries: ControllerExportFileReviewBoundary[];
  message: string;
}

export interface ControllerExportFileReviewReport {
  rows: ControllerExportFileReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  exportDateCount: number;
  containsContextCount: number;
  partialContextExportCount: number;
  issueCount: number;
  invalidExportDateCount: number;
  unrecognizedContainsContextCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerExportFileReviewBoundary[] = [
  "no-controller-communication",
  "no-export-time-verification",
  "no-export-regeneration",
  "no-context-resolution",
  "no-download-preflight",
];

/**
 * Studio 5000 stamps the export date in C `ctime` style:
 * "Ddd Mmm DD HH:MM:SS YYYY" (e.g. "Tue Jan 02 14:03:11 2024"). The day of month
 * is either two digits or a space-padded single digit ("Jan  2"). The date is
 * never parsed as a real timestamp — this only validates the shape so a garbled
 * value surfaces for review.
 */
const EXPORT_DATE_PATTERN =
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} (?: \d|\d\d) \d{2}:\d{2}:\d{2} \d{4}$/;

const CONTAINS_CONTEXT_FLAGS = new Set(["true", "false"]);

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function issuesFor(controller: Controller): ControllerExportFileReviewIssue[] {
  const issues: ControllerExportFileReviewIssue[] = [];
  const exportDate = present(controller.exportDate);
  if (exportDate != null && !EXPORT_DATE_PATTERN.test(exportDate)) {
    issues.push("invalid-export-date-format");
  }
  const containsContext = present(controller.containsContext);
  if (containsContext != null && !CONTAINS_CONTEXT_FLAGS.has(containsContext.toLowerCase())) {
    issues.push("unrecognized-contains-context-flag");
  }
  return issues;
}

function issueLabel(issue: ControllerExportFileReviewIssue): string {
  switch (issue) {
    case "invalid-export-date-format":
      return "ExportDate should use the expected controller-editor timestamp format, such as Tue Jan 02 14:03:11 2024";
    case "unrecognized-contains-context-flag":
      return "ContainsContext should be true or false";
  }
}

function statusFor(
  exportFileMetadataPresent: boolean,
  issues: ControllerExportFileReviewIssue[],
): ControllerExportFileReviewStatus {
  if (!exportFileMetadataPresent) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerExportFileReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" export file metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.exportFileMetadataPresent) {
    return `Controller "${row.controllerName}" has no imported export file metadata (ExportDate / ContainsContext) to review.`;
  }
  const parts: string[] = [];
  if (row.exportDatePresent) parts.push(`exported ${row.exportDate}`);
  if (row.containsContextPresent) {
    parts.push(row.embedsProjectContext ? "embeds project context" : "no embedded project context (partial export)");
  }
  return `Controller "${row.controllerName}" export file is reviewable offline (${parts.join(", ")}); ESCO never verifies the export time, regenerates the file, resolves omitted context, or talks to a controller.`;
}

function rowFor(controller: Controller): ControllerExportFileReviewRow {
  const issues = issuesFor(controller);
  const exportDatePresent = !blank(controller.exportDate);
  const containsContext = present(controller.containsContext);
  const containsContextPresent = containsContext != null;
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    exportDate: present(controller.exportDate),
    containsContext,
    exportDatePresent,
    containsContextPresent,
    embedsProjectContext: containsContext?.toLowerCase() === "true",
    exportFileMetadataPresent: exportDatePresent || containsContextPresent,
    status: statusFor(exportDatePresent || containsContextPresent, issues),
    issues,
    controllerCommunicationModelled: false as const,
    exportTimeVerified: false as const,
    exportRegenerationModelled: false as const,
    contextResolutionModelled: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerExportFileReviewReport(
  project: PlcProject,
): ControllerExportFileReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerExportFileReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.exportFileMetadataPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    exportDateCount: rows.filter((row) => row.exportDatePresent).length,
    containsContextCount: rows.filter((row) => row.containsContextPresent).length,
    // A controller that records ContainsContext="false" is a partial export that
    // does not embed surrounding project context — surfaced read-only, not an issue.
    partialContextExportCount: rows.filter(
      (row) => row.containsContextPresent && !row.embedsProjectContext,
    ).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    invalidExportDateCount: hasIssue("invalid-export-date-format"),
    unrecognizedContainsContextCount: hasIssue("unrecognized-contains-context-flag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
