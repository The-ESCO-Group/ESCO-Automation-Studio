import type { Controller, PlcProject } from "@esco/core";

export type ControllerDocumentationReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerDocumentationReviewIssue =
  | "partial-language-metadata"
  | "partial-download-metadata"
  | "invalid-download-project-documentation-flag"
  | "invalid-download-custom-properties-flag";

export type ControllerDocumentationReviewBoundary =
  | "no-controller-communication"
  | "no-project-documentation-download"
  | "no-controller-pass-through-storage"
  | "no-language-merge"
  | "no-language-selection-dialog"
  | "no-extended-properties-sync"
  | "no-custom-properties-sync";

export interface ControllerDocumentationReviewRow {
  controllerId: string;
  controllerName: string;
  currentProjectLanguage?: string;
  defaultProjectLanguage?: string;
  controllerLanguage?: string;
  passThroughConfiguration?: string;
  downloadProjectDocumentationAndExtendedProperties?: string;
  downloadProjectDocumentationAndExtendedPropertiesEnabled?: boolean;
  downloadProjectCustomProperties?: string;
  downloadProjectCustomPropertiesEnabled?: boolean;
  languageMetadataPresent: boolean;
  downloadMetadataPresent: boolean;
  status: ControllerDocumentationReviewStatus;
  issues: ControllerDocumentationReviewIssue[];
  controllerCommunicationModelled: false;
  projectDocumentationDownloadModelled: false;
  languageMergeModelled: false;
  languageSelectionDialogModelled: false;
  extendedPropertiesSyncModelled: false;
  customPropertiesSyncModelled: false;
  boundaries: ControllerDocumentationReviewBoundary[];
  message: string;
}

export interface ControllerDocumentationReviewReport {
  rows: ControllerDocumentationReviewRow[];
  controllerCount: number;
  reviewableCount: number;
  configuredLanguageCount: number;
  configuredDownloadCount: number;
  issueCount: number;
  partialLanguageCount: number;
  partialDownloadCount: number;
  invalidDownloadFlagCount: number;
  warnings: string[];
}

const BASE_BOUNDARIES: ControllerDocumentationReviewBoundary[] = [
  "no-controller-communication",
  "no-project-documentation-download",
  "no-controller-pass-through-storage",
  "no-language-merge",
  "no-language-selection-dialog",
  "no-extended-properties-sync",
  "no-custom-properties-sync",
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

function presentCount(values: Array<string | undefined>): number {
  return values.filter((value) => !blank(value)).length;
}

function issuesFor(controller: Controller): ControllerDocumentationReviewIssue[] {
  const issues: ControllerDocumentationReviewIssue[] = [];
  const languageCount = presentCount([
    controller.currentProjectLanguage,
    controller.defaultProjectLanguage,
    controller.controllerLanguage,
  ]);
  if (languageCount > 0 && languageCount < 3) issues.push("partial-language-metadata");

  const downloadCount = presentCount([
    controller.passThroughConfiguration,
    controller.downloadProjectDocumentationAndExtendedProperties,
    controller.downloadProjectCustomProperties,
  ]);
  if (downloadCount > 0 && downloadCount < 3) issues.push("partial-download-metadata");
  if (
    !blank(controller.downloadProjectDocumentationAndExtendedProperties) &&
    boolish(controller.downloadProjectDocumentationAndExtendedProperties) == null
  ) {
    issues.push("invalid-download-project-documentation-flag");
  }
  if (!blank(controller.downloadProjectCustomProperties) && boolish(controller.downloadProjectCustomProperties) == null) {
    issues.push("invalid-download-custom-properties-flag");
  }
  return issues;
}

function issueLabel(issue: ControllerDocumentationReviewIssue): string {
  switch (issue) {
    case "partial-language-metadata":
      return "partial project documentation language metadata";
    case "partial-download-metadata":
      return "partial project documentation download metadata";
    case "invalid-download-project-documentation-flag":
      return "DownloadProjectDocumentationAndExtendedProperties must be true/false or 1/0";
    case "invalid-download-custom-properties-flag":
      return "DownloadProjectCustomProperties must be true/false or 1/0";
  }
}

function statusFor(
  issues: ControllerDocumentationReviewIssue[],
  languageMetadataPresent: boolean,
  downloadMetadataPresent: boolean,
): ControllerDocumentationReviewStatus {
  if (issues.length) return "needs-attention";
  if (languageMetadataPresent || downloadMetadataPresent) return "reviewable";
  return "no-metadata";
}

function messageFor(row: Omit<ControllerDocumentationReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" project documentation metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.languageMetadataPresent && row.downloadMetadataPresent) {
    return `Controller "${row.controllerName}" project documentation language and download settings are reviewable offline; language merge and controller documentation download are not modelled.`;
  }
  if (row.languageMetadataPresent) {
    return `Controller "${row.controllerName}" project documentation language settings are reviewable offline; language selection and merge behavior are not modelled.`;
  }
  if (row.downloadMetadataPresent) {
    return `Controller "${row.controllerName}" project documentation download settings are reviewable offline; pass-through storage and controller download are not modelled.`;
  }
  return `Controller "${row.controllerName}" has no imported project documentation language/download metadata to review.`;
}

function rowFor(controller: Controller): ControllerDocumentationReviewRow {
  const issues = issuesFor(controller);
  const languageMetadataPresent = presentCount([
    controller.currentProjectLanguage,
    controller.defaultProjectLanguage,
    controller.controllerLanguage,
  ]) > 0;
  const downloadMetadataPresent = presentCount([
    controller.passThroughConfiguration,
    controller.downloadProjectDocumentationAndExtendedProperties,
    controller.downloadProjectCustomProperties,
  ]) > 0;
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    currentProjectLanguage: controller.currentProjectLanguage,
    defaultProjectLanguage: controller.defaultProjectLanguage,
    controllerLanguage: controller.controllerLanguage,
    passThroughConfiguration: controller.passThroughConfiguration,
    downloadProjectDocumentationAndExtendedProperties: controller.downloadProjectDocumentationAndExtendedProperties,
    downloadProjectDocumentationAndExtendedPropertiesEnabled: boolish(
      controller.downloadProjectDocumentationAndExtendedProperties,
    ),
    downloadProjectCustomProperties: controller.downloadProjectCustomProperties,
    downloadProjectCustomPropertiesEnabled: boolish(controller.downloadProjectCustomProperties),
    languageMetadataPresent,
    downloadMetadataPresent,
    status: statusFor(issues, languageMetadataPresent, downloadMetadataPresent),
    issues,
    controllerCommunicationModelled: false as const,
    projectDocumentationDownloadModelled: false as const,
    languageMergeModelled: false as const,
    languageSelectionDialogModelled: false as const,
    extendedPropertiesSyncModelled: false as const,
    customPropertiesSyncModelled: false as const,
    boundaries: [...BASE_BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerDocumentationReviewReport(project: PlcProject): ControllerDocumentationReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerDocumentationReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    configuredLanguageCount: rows.filter((row) => row.languageMetadataPresent).length,
    configuredDownloadCount: rows.filter((row) => row.downloadMetadataPresent).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialLanguageCount: hasIssue("partial-language-metadata"),
    partialDownloadCount: hasIssue("partial-download-metadata"),
    invalidDownloadFlagCount:
      hasIssue("invalid-download-project-documentation-flag") +
      hasIssue("invalid-download-custom-properties-flag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
