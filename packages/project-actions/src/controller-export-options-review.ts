import type { Controller, PlcProject } from "@esco/core";

/**
 * Offline review projection for the root `<RSLogix5000Content ExportOptions>`
 * token list — the space-separated set of data classes Studio 5000 stamped on
 * the L5X (e.g. "References NoRawData L5KData DecoratedData Context
 * Dependencies"). These options describe *what the file contains*, which an
 * engineer reviews before importing: an export with no decoded/raw tag data, a
 * partial `Context` export, or a self-contradictory raw-data flag is worth
 * surfacing read-only.
 *
 * This is intentionally distinct from {@link controllerExportProvenanceReviewReport},
 * which reviews the originating SoftwareRevision / Owner. ESCO never re-derives
 * the export options, enforces a particular set of data classes, regenerates the
 * file, or talks to a controller; the token list is preserved verbatim on
 * export.
 */
export type ControllerExportOptionsReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerExportOptionsReviewIssue =
  | "contradictory-raw-data-options"
  | "duplicate-export-option"
  | "no-decoded-tag-data";

export type ControllerExportOptionsReviewBoundary =
  | "no-controller-communication"
  | "no-export-regeneration"
  | "no-data-class-enforcement";

export interface ControllerExportOptionsReviewRow {
  controllerId: string;
  controllerName: string;
  exportOptions?: string;
  /** The parsed, whitespace-separated tokens, preserved in original order/case. */
  options: string[];
  exportOptionsPresent: boolean;
  /** A `Context` token marks a partial (single-component-with-context) export. */
  partialContextExport: boolean;
  status: ControllerExportOptionsReviewStatus;
  issues: ControllerExportOptionsReviewIssue[];
  controllerCommunicationModelled: false;
  exportRegenerationModelled: false;
  dataClassEnforcementModelled: false;
  boundaries: ControllerExportOptionsReviewBoundary[];
  message: string;
}

export interface ControllerExportOptionsReviewReport {
  rows: ControllerExportOptionsReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  issueCount: number;
  contradictoryRawDataCount: number;
  duplicateOptionCount: number;
  noDecodedTagDataCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerExportOptionsReviewBoundary[] = [
  "no-controller-communication",
  "no-export-regeneration",
  "no-data-class-enforcement",
];

/** Tokens that indicate the file actually carries tag data, not just structure. */
const TAG_DATA_TOKENS = ["decorateddata", "l5kdata", "rawdata"];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function parseOptions(value: string | undefined): string[] {
  if (blank(value)) return [];
  return value!.trim().split(/\s+/);
}

function hasToken(options: string[], token: string): boolean {
  return options.some((opt) => opt.toLowerCase() === token);
}

function issuesFor(options: string[]): ControllerExportOptionsReviewIssue[] {
  if (options.length === 0) return [];
  const issues: ControllerExportOptionsReviewIssue[] = [];

  if (hasToken(options, "rawdata") && hasToken(options, "norawdata")) {
    issues.push("contradictory-raw-data-options");
  }

  const seen = new Set<string>();
  for (const opt of options) {
    const key = opt.toLowerCase();
    if (seen.has(key)) {
      issues.push("duplicate-export-option");
      break;
    }
    seen.add(key);
  }

  if (!TAG_DATA_TOKENS.some((token) => hasToken(options, token))) {
    issues.push("no-decoded-tag-data");
  }

  return issues;
}

function issueLabel(issue: ControllerExportOptionsReviewIssue): string {
  switch (issue) {
    case "contradictory-raw-data-options":
      return "ExportOptions lists both RawData and NoRawData";
    case "duplicate-export-option":
      return "ExportOptions lists a data class more than once";
    case "no-decoded-tag-data":
      return "ExportOptions carries no decoded/raw tag data (DecoratedData, L5KData, or RawData)";
  }
}

function statusFor(
  exportOptionsPresent: boolean,
  issues: ControllerExportOptionsReviewIssue[],
): ControllerExportOptionsReviewStatus {
  if (!exportOptionsPresent) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerExportOptionsReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" export options need attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.exportOptionsPresent) {
    return `Controller "${row.controllerName}" has no imported ExportOptions to review.`;
  }
  const scope = row.partialContextExport ? "partial (Context) export" : "export";
  return `Controller "${row.controllerName}" ${scope} options are reviewable offline (${row.options.join(", ")}); ESCO never regenerates the export, enforces data classes, or talks to a controller.`;
}

function rowFor(controller: Controller): ControllerExportOptionsReviewRow {
  const options = parseOptions(controller.exportOptions);
  const issues = issuesFor(options);
  const exportOptionsPresent = options.length > 0;
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    exportOptions: present(controller.exportOptions),
    options,
    exportOptionsPresent,
    partialContextExport: hasToken(options, "context"),
    status: statusFor(exportOptionsPresent, issues),
    issues,
    controllerCommunicationModelled: false as const,
    exportRegenerationModelled: false as const,
    dataClassEnforcementModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerExportOptionsReviewReport(
  project: PlcProject,
): ControllerExportOptionsReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerExportOptionsReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.exportOptionsPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    contradictoryRawDataCount: hasIssue("contradictory-raw-data-options"),
    duplicateOptionCount: hasIssue("duplicate-export-option"),
    noDecodedTagDataCount: hasIssue("no-decoded-tag-data"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
