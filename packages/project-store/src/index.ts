import { nowIso } from "@esco/shared";
import type { PlcProject } from "@esco/core";
import {
  APP_VERSION,
  MIGRATIONS,
  PLCPROJ_FORMAT_NAME,
  PLCPROJ_FORMAT_VERSION,
  migrationFrom,
} from "./migrations";

/** Canonical file extension for ESCO Automation Studio project files. */
export const PLCPROJ_EXTENSION = ".plcproj.json";

export { APP_VERSION, PLCPROJ_FORMAT_NAME, PLCPROJ_FORMAT_VERSION, MIGRATIONS };
export type { Migration } from "./migrations";

/** On-disk shape of a `.plcproj.json` file. */
export interface PlcProjectFile {
  formatName: string;
  formatVersion: number;
  appVersion?: string;
  savedAt: string;
  /** Where the project originally came from, e.g. "L5X: Plant.L5X". */
  importedSource?: string;
  /** Names of migrations applied when this file was last loaded. */
  migrationsApplied?: string[];
  project: PlcProject;
}

export interface SerializeOptions {
  importedSource?: string;
  migrationsApplied?: string[];
}

/**
 * Serialize a project to the `.plcproj.json` text format. The ladder AST stored
 * in each routine is plain data, so it round-trips as ordinary JSON.
 */
export function serializeProject(project: PlcProject, options: SerializeOptions = {}): string {
  const file: PlcProjectFile = {
    formatName: PLCPROJ_FORMAT_NAME,
    formatVersion: PLCPROJ_FORMAT_VERSION,
    appVersion: APP_VERSION,
    savedAt: nowIso(),
    ...(options.importedSource ? { importedSource: options.importedSource } : {}),
    ...(options.migrationsApplied?.length ? { migrationsApplied: options.migrationsApplied } : {}),
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

export interface LoadResult {
  project: PlcProject;
  /** Human-readable notes (e.g. migrations performed). */
  warnings: string[];
  migrationsApplied: string[];
  importedSource?: string;
}

/**
 * Parse, migrate, and validate a `.plcproj.json` string. Returns the project
 * plus any migration warnings. Throws an `Error` with a human-readable message
 * for invalid / unsupported / malformed files.
 */
export function deserializeProjectFile(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not a valid .plcproj.json file: the file is not valid JSON.");
  }
  if (!isObject(parsed)) {
    throw new Error("Not a valid .plcproj.json file: expected a project object.");
  }
  if (typeof parsed.formatVersion !== "number") {
    throw new Error("Not a valid .plcproj.json file: missing format version.");
  }
  if (parsed.formatVersion > PLCPROJ_FORMAT_VERSION) {
    throw new Error(
      `Unsupported project format version: ${parsed.formatVersion} (this app supports up to ${PLCPROJ_FORMAT_VERSION}). Please update ESCO Automation Studio.`,
    );
  }

  let file = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  const migrationsApplied: string[] = [];
  while ((file.formatVersion as number) < PLCPROJ_FORMAT_VERSION) {
    const version = file.formatVersion as number;
    const migration = migrationFrom(version);
    if (!migration) {
      throw new Error(`Cannot migrate project from format version ${version}: no migration path.`);
    }
    file = migration.migrate(file);
    file.formatVersion = migration.to;
    migrationsApplied.push(migration.name);
    warnings.push(`Migrated project (${migration.name}).`);
  }

  if (!isPlcProject(file.project)) {
    throw new Error("Not a valid .plcproj.json file: missing or malformed project data.");
  }

  return {
    project: file.project,
    warnings,
    migrationsApplied,
    ...(typeof file.importedSource === "string" ? { importedSource: file.importedSource } : {}),
  };
}

/**
 * Parse and validate a `.plcproj.json` string into a project (migrating older
 * versions). Throws an `Error` with a human-readable message on failure.
 */
export function deserializeProject(json: string): PlcProject {
  return deserializeProjectFile(json).project;
}

/**
 * Suggest a backup filename for the original project text before a migration
 * overwrites it on disk. The host (desktop shell / UI) is responsible for
 * actually writing the backup; this only derives a stable, sortable name so the
 * pre-migration file is never silently lost. `at` is passed in so the function
 * stays pure/testable.
 */
export function backupFileName(originalName: string, fromVersion: number, at = nowIso()): string {
  const base = originalName.replace(new RegExp(`${PLCPROJ_EXTENSION.replace(".", "\\.")}$`), "");
  const stamp = at.replace(/[:.]/g, "-");
  return `${base}.v${fromVersion}.${stamp}.bak${PLCPROJ_EXTENSION}`;
}

/**
 * Returns true when loading `json` would migrate it (i.e. its format version is
 * older than the current one). Useful for the UI to offer a backup before the
 * migrating open path rewrites the file.
 */
export function willMigrate(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { formatVersion?: unknown };
    return typeof parsed.formatVersion === "number" && parsed.formatVersion < PLCPROJ_FORMAT_VERSION;
  } catch {
    return false;
  }
}
