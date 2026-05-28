import { nowIso } from "@esco/shared";
import type { PlcProject } from "@esco/core";

/** Canonical file extension for ESCO Automation Studio project files. */
export const PLCPROJ_EXTENSION = ".plcproj.json";
export const PLCPROJ_FORMAT_VERSION = 1;

/** On-disk shape of a `.plcproj.json` file. */
export interface PlcProjectFile {
  formatVersion: typeof PLCPROJ_FORMAT_VERSION;
  savedAt: string;
  project: PlcProject;
}

/**
 * Serialize a project to the `.plcproj.json` text format. The ladder AST stored
 * in each routine is plain data, so it round-trips as ordinary JSON.
 */
export function serializeProject(project: PlcProject): string {
  const file: PlcProjectFile = {
    formatVersion: PLCPROJ_FORMAT_VERSION,
    savedAt: nowIso(),
    project,
  };
  return JSON.stringify(file, null, 2);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Structural guard for a project: enough to reject foreign/garbage JSON before
 * it is allowed to replace live app state. Does not deeply validate the ladder
 * AST (that stays opaque to the store).
 */
export function isPlcProject(value: unknown): value is PlcProject {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (!Array.isArray(value.controllers)) return false;
  return value.controllers.every(
    (controller) =>
      isObject(controller) &&
      Array.isArray(controller.tasks) &&
      Array.isArray(controller.programs) &&
      Array.isArray(controller.controllerTags),
  );
}

/**
 * Parse and validate a `.plcproj.json` string into a project. Throws an `Error`
 * with a human-readable message if the text is not a valid project file.
 */
export function deserializeProject(json: string): PlcProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not a valid .plcproj.json file: the file is not valid JSON.");
  }

  if (!isObject(parsed)) {
    throw new Error("Not a valid .plcproj.json file: expected a project object.");
  }
  if (parsed.formatVersion !== PLCPROJ_FORMAT_VERSION) {
    throw new Error(
      `Unsupported project format version: ${String(parsed.formatVersion)} (expected ${PLCPROJ_FORMAT_VERSION}).`,
    );
  }
  if (!isPlcProject(parsed.project)) {
    throw new Error("Not a valid .plcproj.json file: missing or malformed project data.");
  }

  return parsed.project;
}
