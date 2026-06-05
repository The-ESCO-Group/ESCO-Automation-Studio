import type { Controller, PlcProject, SafetyInfo } from "@esco/core";

/**
 * Reviews the GuardLogix certified safety level (`SafetyInfo.SafetyLevel`,
 * e.g. "SIL2/PLd", "SIL3/PLe"). The existing controller SafetyInfo review only
 * surfaces and counts the raw level string; this projection validates its
 * canonical `SIL<n>/PL<letter>` shape so corruption / typos in a safety-critical
 * field are flagged for the engineer. It never enforces a safety rating,
 * certifies SIL/PL compliance, or talks to a controller (this tool is
 * offline-only) — it only classifies the imported metadata for review.
 *
 * Kept as an isolated sibling module (not folded into
 * `controller-safety-info-review`) to mirror the established one-concept-per-file
 * controller review pattern and avoid contending the actively-edited SafetyInfo
 * review; the format issue here never overlaps with that review's findings.
 */
export type ControllerSafetyLevelReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerSafetyLevelReviewIssue = "unrecognized-safety-level-format";

export type ControllerSafetyLevelReviewBoundary =
  | "no-controller-communication"
  | "no-safety-rating-enforcement"
  | "no-safety-certification-verification";

export interface ControllerSafetyLevelReviewRow {
  controllerId: string;
  controllerName: string;
  safetyLevel?: string;
  safetyIntegrityLevel?: string;
  performanceLevel?: string;
  safetyLevelPresent: boolean;
  status: ControllerSafetyLevelReviewStatus;
  issues: ControllerSafetyLevelReviewIssue[];
  controllerCommunicationModelled: false;
  safetyRatingEnforced: false;
  safetyCertificationVerified: false;
  boundaries: ControllerSafetyLevelReviewBoundary[];
  message: string;
}

export interface ControllerSafetyLevelReviewReport {
  rows: ControllerSafetyLevelReviewRow[];
  controllerCount: number;
  safetyLevelCount: number;
  reviewableCount: number;
  issueCount: number;
  unrecognizedFormatCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerSafetyLevelReviewBoundary[] = [
  "no-controller-communication",
  "no-safety-rating-enforcement",
  "no-safety-certification-verification",
];

// Canonical GuardLogix SafetyLevel string: a Safety Integrity Level (SIL plus a
// digit) paired with a Performance Level (PL plus a letter a-e), e.g.
// "SIL2/PLd". Case-insensitive; rejects partials ("SIL2", "PLd"), embedded
// whitespace, and any other corruption.
const SAFETY_LEVEL_PATTERN = /^SIL(\d+)\/PL([A-E])$/i;

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

interface ParsedSafetyLevel {
  recognized: boolean;
  safetyIntegrityLevel?: string;
  performanceLevel?: string;
}

function parseSafetyLevel(value: string | undefined): ParsedSafetyLevel {
  if (blank(value)) return { recognized: false };
  const match = SAFETY_LEVEL_PATTERN.exec(value!.trim());
  if (!match) return { recognized: false };
  return {
    recognized: true,
    safetyIntegrityLevel: `SIL${match[1]}`,
    performanceLevel: `PL${match[2]!.toLowerCase()}`,
  };
}

function issuesFor(info: SafetyInfo | undefined): ControllerSafetyLevelReviewIssue[] {
  if (blank(info?.safetyLevel)) return [];
  return parseSafetyLevel(info?.safetyLevel).recognized ? [] : ["unrecognized-safety-level-format"];
}

function statusFor(
  info: SafetyInfo | undefined,
  issues: ControllerSafetyLevelReviewIssue[],
): ControllerSafetyLevelReviewStatus {
  if (blank(info?.safetyLevel)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerSafetyLevelReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" SafetyLevel "${row.safetyLevel}" is not a recognized SIL/PL rating (expected e.g. "SIL2/PLd").`;
  }
  if (!row.safetyLevelPresent) {
    return `Controller "${row.controllerName}" has no imported SafetyLevel metadata to review.`;
  }
  return `Controller "${row.controllerName}" SafetyLevel ${row.safetyLevel} is reviewable offline; the safety rating is not enforced or certified against the safety task or I/O.`;
}

function rowFor(controller: Controller): ControllerSafetyLevelReviewRow {
  const info = controller.safetyInfo;
  const issues = issuesFor(info);
  const parsed = parseSafetyLevel(info?.safetyLevel);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    safetyLevel: present(info?.safetyLevel),
    safetyIntegrityLevel: parsed.safetyIntegrityLevel,
    performanceLevel: parsed.performanceLevel,
    safetyLevelPresent: !blank(info?.safetyLevel),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    safetyRatingEnforced: false as const,
    safetyCertificationVerified: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerSafetyLevelReviewReport(project: PlcProject): ControllerSafetyLevelReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerSafetyLevelReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    safetyLevelCount: rows.filter((row) => row.safetyLevelPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    unrecognizedFormatCount: hasIssue("unrecognized-safety-level-format"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
