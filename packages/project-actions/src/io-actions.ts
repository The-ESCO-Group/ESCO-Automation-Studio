import { createProject, type PlcProject } from "@esco/core";
import { importL5X, type ImportSummary } from "@esco/parser-l5x";
import { deserializeProject, serializeProject } from "@esco/project-store";
import { fail, ok, validate } from "./helpers";
import type { ProjectActionResult } from "./types";

/** Parse a `.plcproj.json` string into a project. */
export function importProjectFile(text: string): ProjectActionResult {
  try {
    return ok(deserializeProject(text));
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
