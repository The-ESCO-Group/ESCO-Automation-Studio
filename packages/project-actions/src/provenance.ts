/**
 * Project provenance helpers.
 *
 * ESCO Automation Studio is offline-safe and never opens proprietary binary
 * controller-project files. Every project model in memory therefore carries
 * honest provenance describing where it actually came from (an L5X import, an
 * ESCO-native project, a new project, ...) plus an audit record of the most
 * recent blocked unsupported-format import attempt.
 *
 * These are pure functions over {@link PlcProject}; the UI decides when to call
 * them. They never mutate the input project — they return a new one — and the
 * provenance is read-only metadata that the simulator and exporter ignore.
 */

import type {
  BinaryProjectOutcome,
  BlockedImportRecord,
  ExternalConversionTool,
  PlcProject,
  ProjectProvenance,
  ProjectSourceType,
  SoftControllerProvenance,
} from "@esco/core";
import { nowIso } from "@esco/shared";
import type { FormatGuardResult } from "./format-guard";

export interface RecordImportProvenanceInput {
  sourceType: ProjectSourceType;
  fileName?: string;
  path?: string;
  /** ISO timestamp; defaults to now. Injectable to keep callers testable. */
  importedAt?: string;
  /** The external tool that converted/opened this project from a proprietary binary source, when applicable. */
  bridgeTool?: ExternalConversionTool;
  /** SoftController upload audit detail; set only for `"esco-softcontroller-upload"`. */
  softController?: SoftControllerProvenance;
}

/** A short label for an unsupported-import attempt, used in the activity log / UI. */
export function describeProjectSource(sourceType: ProjectSourceType): string {
  switch (sourceType) {
    case "xml-review-import":
      return "XML review import";
    case "esco-project":
      return "ESCO project";
    case "component-import":
      return "Component import";
    case "recovered":
      return "Recovered autosave";
    case "binary-project-open-blocked":
      return "Unsupported binary project";
    case "external-conversion-import":
      return "Unsupported external conversion";
    case "esco-runtime":
      return "ESCO Runtime (compiled, read-only)";
    case "esco-softcontroller-upload":
      return "ESCO SoftController upload (reconstructed, read-only)";
    case "new":
    default:
      return "New project";
  }
}

/**
 * Stamp a project with the provenance of how it was loaded. Preserves any
 * existing `blockedImport` audit record so a blocked attempt is not lost when
 * the same project is re-imported/refreshed.
 */
export function recordImportProvenance(
  project: PlcProject,
  input: RecordImportProvenanceInput,
): PlcProject {
  const provenance: ProjectProvenance = {
    sourceType: input.sourceType,
    importedAt: input.importedAt ?? nowIso(),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.bridgeTool ? { bridgeTool: input.bridgeTool } : {}),
    ...(input.softController ? { softController: input.softController } : {}),
    ...(project.provenance?.blockedImport
      ? { blockedImport: project.provenance.blockedImport }
      : {}),
  };
  return { ...project, provenance };
}

export interface BlockedImportInput {
  fileName: string;
  path?: string;
  /** A format guard result whose `unsupported` is true. */
  guard: FormatGuardResult;
  /** ISO timestamp; defaults to now. Injectable to keep callers testable. */
  blockedAt?: string;
  /** What this block represents; defaults to "format-blocked". */
  outcome?: BinaryProjectOutcome;
  /** A detected tool that *could* perform the conversion (e.g. when a bridge is unavailable). */
  tool?: ExternalConversionTool;
}

/** Build a {@link BlockedImportRecord} from a format-guard result. */
export function buildBlockedImportRecord(input: BlockedImportInput): BlockedImportRecord {
  const { guard } = input;
  return {
    fileName: input.fileName,
    ...(input.path ? { path: input.path } : {}),
    format: guard.format ?? "unknown",
    formatLabel: guard.formatLabel ?? "Unsupported project format",
    reason: guard.reason ?? "This file format is not supported for offline interchange.",
    blockedAt: input.blockedAt ?? nowIso(),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.tool ? { tool: input.tool } : {}),
  };
}

/**
 * Attach an audit record of a blocked unsupported-format import to the project's
 * provenance. The project's `sourceType` is left intact — a blocked attempt
 * never becomes the project's origin — but the attempt is preserved so Project
 * Properties can show it honestly.
 */
export function recordBlockedImport(
  project: PlcProject,
  input: BlockedImportInput,
): PlcProject {
  const blockedImport = buildBlockedImportRecord(input);
  const provenance: ProjectProvenance = {
    sourceType: project.provenance?.sourceType ?? "new",
    importedAt: project.provenance?.importedAt ?? blockedImport.blockedAt,
    ...(project.provenance?.fileName ? { fileName: project.provenance.fileName } : {}),
    ...(project.provenance?.path ? { path: project.provenance.path } : {}),
    blockedImport,
  };
  return { ...project, provenance };
}
