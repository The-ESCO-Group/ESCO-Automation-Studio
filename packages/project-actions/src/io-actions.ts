import { createProject, type PlcProject } from "@esco/core";
import { exportL5X, importL5X, type ImportSummary } from "@esco/parser-l5x";
import { deserializeProjectFile, serializeProject } from "@esco/project-store";
import { fail, ok, validate } from "./helpers";
import type { ProjectActionResult } from "./types";

export interface ProjectFileImportData {
  importedSource?: string;
  migrationsApplied: string[];
}

/** Parse a `.plcproj.json` string into a project. */
export function importProjectFile(text: string): ProjectActionResult<ProjectFileImportData> {
  try {
    const result = deserializeProjectFile(text);
    return ok(result.project, {
      migrationsApplied: result.migrationsApplied,
      importedSource: result.importedSource,
    }, result.warnings);
  } catch (error) {
    return fail(
      createProject("Untitled"),
      error instanceof Error ? error.message : "Invalid project file.",
    );
  }
}

/** Import an L5X string, returning the project, warnings, and an import summary. */
export function importL5XFile(text: string): ProjectActionResult<{ summary: ImportSummary }> {
  try {
    const { project, warnings, summary } = importL5X(text);
    return { ok: true, project, warnings, findings: validate(project), data: { summary } };
  } catch (error) {
    return fail(
      createProject("Untitled"),
      error instanceof Error ? error.message : "Invalid L5X file.",
    );
  }
}

/** Serialize the project to `.plcproj.json` text. */
export function exportProjectJson(project: PlcProject): ProjectActionResult<{ text: string }> {
  return { ok: true, project, data: { text: serializeProject(project) } };
}

/**
 * Generate a new offline `.L5X` for the project (review-only). The original
 * project is never mutated and no `.ACD` file or controller is touched; the
 * `warnings` describe anything exported with caveats.
 */
export function exportProjectL5X(
  project: PlcProject,
): ProjectActionResult<{ text: string; warnings: string[] }> {
  const { xml, warnings } = exportL5X(project);
  return { ok: true, project, warnings, data: { text: xml, warnings } };
}
