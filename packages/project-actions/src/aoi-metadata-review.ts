import type { AddOnInstruction, PlcProject } from "@esco/core";

/**
 * Add-On Instruction identity / documentation metadata review.
 *
 * {@link describeAoiExecutionReview} projects the AOI *body* (which routine, if
 * any, runs offline) and {@link describeAoiInterfaceReview} projects the AOI
 * *interface* (its public call signature). This third projection covers the
 * AOI's *identity and documentation* metadata: revision, vendor, signature,
 * authoring history, free-text documentation, scan-mode flags, and the
 * safety/standard partition. It is the AOI-level analogue of the controller
 * identity / documentation / safety-info review projections.
 *
 * Like the interface projection, every field is read from imported attributes,
 * so the whole review **survives source protection**: a protected AOI hides its
 * logic body but still publishes its identity and documentation metadata, which
 * this projection surfaces read-only. That is the hardening point — the metadata
 * is shown for review but is *never* used to verify a signature, enforce the
 * source-protection lock, drive the offline scan from the scan-mode flags,
 * schedule a safety task from the partition, or talk to a controller. The
 * projection is display-only and edits/executes nothing.
 */

export type AoiMetadataReviewStatus = "no-metadata" | "reviewable" | "needs-attention";

export type AoiMetadataReviewIssue =
  | "invalid-revision-format"
  | "partial-created-identity"
  | "partial-edited-identity"
  | "unsigned-safety-aoi";

export type AoiMetadataReviewBoundary =
  | "metadata-display-only"
  | "no-controller-communication"
  | "no-signature-enforcement"
  | "no-source-protection-bypass"
  | "no-scan-mode-execution"
  | "no-safety-partition-enforcement";

export type AoiSafetyPartition = "safety" | "standard" | "unspecified";

export interface AoiScanModeReview {
  executePrescan?: boolean;
  executePostscan?: boolean;
  executeEnableInFalse?: boolean;
}

export interface AoiMetadataReview {
  aoiName: string;
  protectedSource: boolean;
  protectionType?: string;
  revision?: string;
  revisionExtension?: string;
  softwareRevision?: string;
  revisionMajor?: number;
  revisionMinor?: number;
  vendor?: string;
  signature?: string;
  signaturePresent: boolean;
  safetyClass?: string;
  safetyPartition: AoiSafetyPartition;
  createdDate?: string;
  createdBy?: string;
  editedDate?: string;
  editedBy?: string;
  revisionNote?: string;
  additionalHelpText?: string;
  description?: string;
  scanModes: AoiScanModeReview;
  identityMetadataPresent: boolean;
  documentationMetadataPresent: boolean;
  authoringMetadataPresent: boolean;
  scanModeMetadataPresent: boolean;
  status: AoiMetadataReviewStatus;
  issues: AoiMetadataReviewIssue[];
  /** Offline guarantees: each modelled side effect is explicitly absent. */
  signatureEnforcementModelled: false;
  sourceProtectionBypassModelled: false;
  scanModeExecutionModelled: false;
  safetyPartitionEnforcementModelled: false;
  boundaries: AoiMetadataReviewBoundary[];
  message: string;
}

export interface AoiMetadataReviewReport {
  rows: AoiMetadataReview[];
  aoiCount: number;
  reviewableCount: number;
  protectedCount: number;
  signedCount: number;
  safetyClassCount: number;
  issueCount: number;
  invalidRevisionCount: number;
  partialAuthoringCount: number;
  unsignedSafetyCount: number;
  warnings: string[];
}

const BASE_BOUNDARIES: AoiMetadataReviewBoundary[] = [
  "metadata-display-only",
  "no-controller-communication",
  "no-signature-enforcement",
  "no-source-protection-bypass",
  "no-scan-mode-execution",
  "no-safety-partition-enforcement",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function safetyPartition(safetyClass: string | undefined): AoiSafetyPartition {
  const normalized = safetyClass?.trim().toLowerCase();
  if (normalized === "safety") return "safety";
  if (normalized === "standard") return "standard";
  return "unspecified";
}

/** Parse a Logix AOI revision ("Major.Minor" or "Major"); undefined when unparseable. */
function parseRevision(revision: string | undefined): { major?: number; minor?: number; valid: boolean } {
  if (blank(revision)) return { valid: true };
  const match = revision!.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return { valid: false };
  return { major: Number(match[1]), minor: match[2] != null ? Number(match[2]) : undefined, valid: true };
}

export function aoiMetadataReviewBoundaryLabel(boundary: AoiMetadataReviewBoundary): string {
  switch (boundary) {
    case "metadata-display-only":
      return "identity/documentation metadata display only";
    case "no-controller-communication":
      return "no controller communication";
    case "no-signature-enforcement":
      return "signature shown, never verified or enforced";
    case "no-source-protection-bypass":
      return "source protection never bypassed; logic never reverse-engineered";
    case "no-scan-mode-execution":
      return "scan-mode flags not used to drive the offline scan";
    case "no-safety-partition-enforcement":
      return "safety/standard partition never schedules a safety task";
  }
}

export function aoiMetadataReviewIssueLabel(issue: AoiMetadataReviewIssue): string {
  switch (issue) {
    case "invalid-revision-format":
      return "revision is not in Major or Major.Minor form";
    case "partial-created-identity":
      return "created date/user is only partially specified";
    case "partial-edited-identity":
      return "edited date/user is only partially specified";
    case "unsigned-safety-aoi":
      return "safety-class AOI carries no instruction signature";
  }
}

function issuesFor(aoi: AddOnInstruction): AoiMetadataReviewIssue[] {
  const issues: AoiMetadataReviewIssue[] = [];
  if (!parseRevision(aoi.revision).valid) issues.push("invalid-revision-format");
  // A date with no author (or an author with no date) is partial authoring
  // history — worth surfacing without blocking review.
  if (blank(aoi.createdDate) !== blank(aoi.createdBy)) issues.push("partial-created-identity");
  if (blank(aoi.editedDate) !== blank(aoi.editedBy)) issues.push("partial-edited-identity");
  // A GuardLogix safety-class AOI (Class="Safety") is expected to carry an
  // instruction signature before it can be sealed and used in a safety task;
  // an unsigned one is incomplete for safety use. Surface it as advisory
  // "needs-attention" (never enforced — the partition still schedules nothing
  // offline; see no-safety-partition-enforcement) so a reviewer catches it.
  if (safetyPartition(aoi.safetyClass) === "safety" && blank(aoi.signature)) issues.push("unsigned-safety-aoi");
  return issues;
}

function messageFor(row: Omit<AoiMetadataReview, "message">): string {
  if (row.issues.length) {
    return `AOI "${row.aoiName}" identity/documentation metadata needs attention: ${row.issues.map(aoiMetadataReviewIssueLabel).join("; ")}.`;
  }
  if (row.protectedSource) {
    return `AOI "${row.aoiName}" is source-protected; its identity/documentation metadata is reviewable offline while the logic body stays sealed.`;
  }
  if (row.status === "reviewable") {
    return `AOI "${row.aoiName}" identity/documentation metadata is reviewable offline; signature, scan-mode, and safety-partition behavior are not modelled.`;
  }
  return `AOI "${row.aoiName}" has no imported identity/documentation metadata to review.`;
}

export function describeAoiMetadataReview(aoi: AddOnInstruction): AoiMetadataReview {
  const revision = parseRevision(aoi.revision);
  const scanModes: AoiScanModeReview = {
    ...(aoi.executePrescan !== undefined ? { executePrescan: aoi.executePrescan } : {}),
    ...(aoi.executePostscan !== undefined ? { executePostscan: aoi.executePostscan } : {}),
    ...(aoi.executeEnableInFalse !== undefined ? { executeEnableInFalse: aoi.executeEnableInFalse } : {}),
  };

  const identityMetadataPresent =
    !blank(aoi.revision) ||
    !blank(aoi.revisionExtension) ||
    !blank(aoi.softwareRevision) ||
    !blank(aoi.vendor) ||
    !blank(aoi.safetyClass);
  const documentationMetadataPresent =
    !blank(aoi.revisionNote) || !blank(aoi.additionalHelpText) || !blank(aoi.description);
  const authoringMetadataPresent =
    !blank(aoi.createdDate) || !blank(aoi.createdBy) || !blank(aoi.editedDate) || !blank(aoi.editedBy);
  const scanModeMetadataPresent = Object.keys(scanModes).length > 0;

  const issues = issuesFor(aoi);
  const anyMetadata =
    identityMetadataPresent ||
    documentationMetadataPresent ||
    authoringMetadataPresent ||
    scanModeMetadataPresent ||
    !blank(aoi.signature) ||
    Boolean(aoi.protected);
  const status: AoiMetadataReviewStatus = issues.length
    ? "needs-attention"
    : anyMetadata
      ? "reviewable"
      : "no-metadata";

  const rowBase: Omit<AoiMetadataReview, "message"> = {
    aoiName: aoi.name,
    protectedSource: Boolean(aoi.protected),
    ...(present(aoi.protectionType) ? { protectionType: present(aoi.protectionType) } : {}),
    ...(present(aoi.revision) ? { revision: present(aoi.revision) } : {}),
    ...(present(aoi.revisionExtension) ? { revisionExtension: present(aoi.revisionExtension) } : {}),
    ...(present(aoi.softwareRevision) ? { softwareRevision: present(aoi.softwareRevision) } : {}),
    ...(revision.major !== undefined ? { revisionMajor: revision.major } : {}),
    ...(revision.minor !== undefined ? { revisionMinor: revision.minor } : {}),
    ...(present(aoi.vendor) ? { vendor: present(aoi.vendor) } : {}),
    ...(present(aoi.signature) ? { signature: present(aoi.signature) } : {}),
    signaturePresent: !blank(aoi.signature),
    ...(present(aoi.safetyClass) ? { safetyClass: present(aoi.safetyClass) } : {}),
    safetyPartition: safetyPartition(aoi.safetyClass),
    ...(present(aoi.createdDate) ? { createdDate: present(aoi.createdDate) } : {}),
    ...(present(aoi.createdBy) ? { createdBy: present(aoi.createdBy) } : {}),
    ...(present(aoi.editedDate) ? { editedDate: present(aoi.editedDate) } : {}),
    ...(present(aoi.editedBy) ? { editedBy: present(aoi.editedBy) } : {}),
    ...(present(aoi.revisionNote) ? { revisionNote: present(aoi.revisionNote) } : {}),
    ...(present(aoi.additionalHelpText) ? { additionalHelpText: present(aoi.additionalHelpText) } : {}),
    ...(present(aoi.description) ? { description: present(aoi.description) } : {}),
    scanModes,
    identityMetadataPresent,
    documentationMetadataPresent,
    authoringMetadataPresent,
    scanModeMetadataPresent,
    status,
    issues,
    signatureEnforcementModelled: false as const,
    sourceProtectionBypassModelled: false as const,
    scanModeExecutionModelled: false as const,
    safetyPartitionEnforcementModelled: false as const,
    boundaries: [...BASE_BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function aoiMetadataReviewReport(project: PlcProject): AoiMetadataReviewReport {
  // AOIs are defined per controller; flatten across all controllers, mirroring
  // the other AOI-scoped projections (which take a single AddOnInstruction).
  const rows = project.controllers.flatMap((controller) =>
    controller.addOnInstructions.map(describeAoiMetadataReview),
  );
  const hasIssue = (issue: AoiMetadataReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    aoiCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    protectedCount: rows.filter((row) => row.protectedSource).length,
    signedCount: rows.filter((row) => row.signaturePresent).length,
    safetyClassCount: rows.filter((row) => row.safetyPartition !== "unspecified").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    invalidRevisionCount: hasIssue("invalid-revision-format"),
    partialAuthoringCount: hasIssue("partial-created-identity") + hasIssue("partial-edited-identity"),
    unsignedSafetyCount: hasIssue("unsigned-safety-aoi"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
