import { nowIso } from "@esco/shared";
import type { PlcProject } from "@esco/core";

/** Canonical file extension for ESCO Automation Studio project files. */
export const PLCPROJ_EXTENSION = ".plcproj.json";
/** Human-readable format identifier embedded in every saved file. */
export const PLCPROJ_FORMAT_NAME = "ESCO Automation Studio Project";
/** Current on-disk format version. Files below this are migrated on load. */
export const PLCPROJ_FORMAT_VERSION = 2;
/** App version stamped into saved files (informational). */
export const APP_VERSION = "0.1.0";

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

/** A single forward migration between two adjacent format versions. */
interface Migration {
  from: number;
  to: number;
  name: string;
  migrate: (file: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered forward migrations. v1 files predate the format metadata block, so the
 * v1→v2 migration simply stamps the name/app version; the project shape is
 * unchanged. Future structural migrations slot in here.
 */
const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    name: "v1->v2: add format metadata",
    migrate: (file) => ({ ...file, formatName: PLCPROJ_FORMAT_NAME, appVersion: APP_VERSION }),
  },
];

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
    const migration = MIGRATIONS.find((candidate) => candidate.from === version);
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
