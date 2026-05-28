import type { PlcProject } from "@esco/core";
import { validate } from "./helpers";
import type { ProjectActionResult } from "./types";

/** Run validation over the project (no mutation) and return the findings. */
export function validateProject(
  project: PlcProject,
): ProjectActionResult<{ findingCount: number }> {
  const findings = validate(project);
  return { ok: true, project, findings, data: { findingCount: findings.length } };
}
