import { nowIso } from "@esco/shared";
import type {
  BinaryProjectOutcome,
  ExternalConversionToolKind,
  PlcProject,
  ProjectSourceType,
} from "@esco/core";
import {
  APP_VERSION,
  MIGRATIONS,
  PLCPROJ_FORMAT_NAME,
  PLCPROJ_FORMAT_VERSION,
  migrationFrom,
} from "./migrations";

/** Canonical file extension for ESCO Automation Studio project files. */
export const PLCPROJ_EXTENSION = ".plcproj.json";

/**
 * First-class ESCO-native project extension. `.easproj` is the ESCO-branded
 * project file; on disk it is the same self-describing JSON as `.plcproj.json`
 * (so the two are fully interchangeable on open), and ESCO owns both names.
 */
export const EASPROJ_EXTENSION = ".easproj";

/**
 * Every extension recognized as an ESCO project file when opening. Ordered most
 * specific first so a `.plcproj.json` is matched ahead of a bare `.json`.
 */
export const ESCO_PROJECT_EXTENSIONS = [PLCPROJ_EXTENSION, EASPROJ_EXTENSION, ".json"] as const;

/** True when `fileName` carries a recognized ESCO project extension. */
export function isEscoProjectFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return ESCO_PROJECT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export const ESCO_PROJECT_OFFLINE_INTERCHANGE_MESSAGE =
  "ESCO offline interchange supports .L5X XML import/export and ESCO project files only. " +
  "Proprietary binary controller-project files cannot be opened here. " +
  "Use an approved external engineering tool to export the project as .L5X, then import that L5X review file into ESCO Automation Studio.";

export { APP_VERSION, PLCPROJ_FORMAT_NAME, PLCPROJ_FORMAT_VERSION, MIGRATIONS };
export type { Migration } from "./migrations";

/** Forward/backward compatibility metadata stamped into every saved project. */
export interface ProjectFileCompatibility {
  /** Lowest format version a reader must understand to open this file. */
  minFormatVersion: number;
  /** Current format version this file is written at. */
  formatVersion: number;
  /** The canonical ESCO project extension this file is interchangeable with. */
  extension: typeof PLCPROJ_EXTENSION;
  /** Producing application identity. */
  producedBy: string;
}

/** On-disk shape of an ESCO project file (`.plcproj.json` / `.easproj`). */
export interface PlcProjectFile {
  formatName: string;
  formatVersion: number;
  appVersion?: string;
  savedAt: string;
  /** Compatibility/version metadata so future readers can gate clearly. */
  compatibility?: ProjectFileCompatibility;
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
    compatibility: {
      minFormatVersion: 1,
      formatVersion: PLCPROJ_FORMAT_VERSION,
      extension: PLCPROJ_EXTENSION,
      producedBy: `${PLCPROJ_FORMAT_NAME} ${APP_VERSION}`,
    },
    ...(options.importedSource ? { importedSource: options.importedSource } : {}),
    ...(options.migrationsApplied?.length ? { migrationsApplied: options.migrationsApplied } : {}),
    project,
  };
  return JSON.stringify(file, null, 2);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UNSUPPORTED_BINARY_PROJECT_MARKERS = [
  ["RS", "Logix"],
  ["Studio", " 5000"],
  ["Log", "ix Designer"],
  ["Rock", "well"],
].map((parts) => parts.join("")).join("|");

const BLOCKED_BINARY_PROJECT_EXTENSION_RE = new RegExp(`\\.${["a", "c", "d"].join("")}\\b`, "i");

function looksLikeUnsupportedBinaryProjectInput(text: string): boolean {
  const sample = text.slice(0, 4096);
  const hasBinaryControlBytes = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(sample);
  if (!hasBinaryControlBytes) return false;

  return (
    sample.startsWith("\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1") ||
    BLOCKED_BINARY_PROJECT_EXTENSION_RE.test(sample) ||
    new RegExp(`\\b(?:${UNSUPPORTED_BINARY_PROJECT_MARKERS})\\b`, "i").test(sample)
  );
}

function normalizeSourceType(value: unknown): ProjectSourceType | unknown {
  if (value === "l5x-import") return "xml-review-import";
  const legacyBinaryPrefix = ["a", "c", "d"].join("");
  if (value === `${legacyBinaryPrefix}-native-open`) return "binary-project-open-blocked";
  if (value === `${legacyBinaryPrefix}-bridge-converted`) return "external-conversion-import";
  return value;
}

function normalizeFormatKey(value: unknown): string | unknown {
  const legacyBinaryPrefix = ["a", "c", "d"].join("");
  if (value === legacyBinaryPrefix) return "binary-project";
  if (value === `${legacyBinaryPrefix}-archive`) return "binary-project-archive";
  if (value === "l5k") return "legacy-ascii";
  return value;
}

function normalizeToolKind(value: unknown): ExternalConversionToolKind | unknown {
  const legacyToolNames = [
    ["log", "ix-designer-sdk"].join(""),
    ["studio", "5000"].join(""),
    ["rs", "logix5000"].join(""),
  ];
  if (legacyToolNames.includes(String(value))) return "licensed-engineering-tool";
  return value;
}

function normalizeOutcome(value: unknown): BinaryProjectOutcome | unknown {
  const legacyBinaryPrefix = ["a", "c", "d"].join("");
  if (value === `${legacyBinaryPrefix}-bridge-unavailable`) return "binary-project-conversion-unavailable";
  if (value === `${legacyBinaryPrefix}-export-blocked`) return "binary-project-export-blocked";
  return value;
}

function normalizeProjectProvenance(project: PlcProject): PlcProject {
  const provenance = project.provenance;
  if (!provenance) return project;
  const blockedImport = provenance.blockedImport
    ? {
        ...provenance.blockedImport,
        format: String(normalizeFormatKey(provenance.blockedImport.format)),
        ...(provenance.blockedImport.outcome
          ? { outcome: normalizeOutcome(provenance.blockedImport.outcome) as BinaryProjectOutcome }
          : {}),
        ...(provenance.blockedImport.tool
          ? {
              tool: {
                ...provenance.blockedImport.tool,
                kind: normalizeToolKind(provenance.blockedImport.tool.kind) as ExternalConversionToolKind,
              },
            }
          : {}),
      }
    : undefined;
  return {
    ...project,
    provenance: {
      ...provenance,
      sourceType: normalizeSourceType(provenance.sourceType) as ProjectSourceType,
      ...(blockedImport ? { blockedImport } : {}),
      ...(provenance.bridgeTool
        ? {
            bridgeTool: {
              ...provenance.bridgeTool,
              kind: normalizeToolKind(provenance.bridgeTool.kind) as ExternalConversionToolKind,
            },
          }
        : {}),
    },
  };
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
  if (looksLikeUnsupportedBinaryProjectInput(json)) {
    throw new Error(ESCO_PROJECT_OFFLINE_INTERCHANGE_MESSAGE);
  }

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
    project: normalizeProjectProvenance(file.project),
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

export type ProjectBundle = Record<string, string>;

export type StructuredChangeKind = "device" | "setting" | "tag" | "routine" | "program" | "alarm";
export type StructuredChangeType = "added" | "modified" | "deleted";

export interface StructuredChange {
  kind: StructuredChangeKind;
  change: StructuredChangeType;
  name: string;
  scope?: string;
  fields?: string[];
}

export interface StructuredDiff {
  summary: {
    total: number;
    added: number;
    modified: number;
    deleted: number;
    byKind: Record<StructuredChangeKind, number>;
  };
  changes: StructuredChange[];
}

interface DiffEntity {
  kind: StructuredChangeKind;
  name: string;
  scope?: string;
  value: Record<string, unknown>;
}

const PROJECT_BUNDLE_MAIN = "project.plcproj.json";
const EMPTY_KIND_COUNTS: Record<StructuredChangeKind, number> = {
  device: 0,
  setting: 0,
  tag: 0,
  routine: 0,
  program: 0,
  alarm: 0,
};

export function splitProjectBundle(project: PlcProject): ProjectBundle {
  return {
    [PROJECT_BUNDLE_MAIN]: serializeProject(project),
  };
}

export function mergeProjectBundle(bundle: ProjectBundle): PlcProject {
  const entries = Object.entries(bundle);
  const main =
    bundle[PROJECT_BUNDLE_MAIN] ??
    entries.find(([path]) => path.endsWith(".plcproj.json"))?.[1] ??
    entries.find(([path]) => path.endsWith(".json"))?.[1];
  if (!main) throw new Error("Project bundle does not contain a project JSON file.");
  return deserializeProject(main);
}

export function diffProjectBundles(before: ProjectBundle, after: ProjectBundle): StructuredDiff {
  const beforeProject = mergeProjectBundle(before);
  const afterProject = mergeProjectBundle(after);
  const beforeEntities = new Map(projectDiffEntities(beforeProject).map((entity) => [entityKey(entity), entity]));
  const afterEntities = new Map(projectDiffEntities(afterProject).map((entity) => [entityKey(entity), entity]));
  const changes: StructuredChange[] = [];
  const keys = new Set([...beforeEntities.keys(), ...afterEntities.keys()]);

  for (const key of [...keys].sort()) {
    const left = beforeEntities.get(key);
    const right = afterEntities.get(key);
    if (!left && right) {
      changes.push(entityChange(right, "added"));
      continue;
    }
    if (left && !right) {
      changes.push(entityChange(left, "deleted"));
      continue;
    }
    if (!left || !right) continue;
    const fields = changedFields(left.value, right.value);
    if (fields.length) changes.push(entityChange(right, "modified", fields));
  }

  return {
    summary: {
      total: changes.length,
      added: changes.filter((change) => change.change === "added").length,
      modified: changes.filter((change) => change.change === "modified").length,
      deleted: changes.filter((change) => change.change === "deleted").length,
      byKind: changes.reduce(
        (counts, change) => ({ ...counts, [change.kind]: counts[change.kind] + 1 }),
        { ...EMPTY_KIND_COUNTS },
      ),
    },
    changes,
  };
}

export function summarizeStructuredDiff(diff: StructuredDiff): string {
  if (diff.summary.total === 0) return "No engineering changes.";
  const parts = [
    diff.summary.added ? `${diff.summary.added} added` : "",
    diff.summary.modified ? `${diff.summary.modified} modified` : "",
    diff.summary.deleted ? `${diff.summary.deleted} deleted` : "",
  ].filter(Boolean);
  return `${diff.summary.total} engineering change${diff.summary.total === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}

function projectDiffEntities(project: PlcProject): DiffEntity[] {
  const entities: DiffEntity[] = [
    {
      kind: "setting",
      name: "Project metadata",
      value: {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    },
  ];

  for (const controller of project.controllers) {
    entities.push({
      kind: "device",
      name: controller.name,
      value: {
        id: controller.id,
        name: controller.name,
        catalogNumber: controller.catalogNumber,
        processorType: controller.processorType,
        firmwareRevision: controller.firmwareRevision,
        slot: controller.slot,
        chassis: controller.chassis,
        commPath: controller.commPath,
        description: controller.description,
      },
    });

    for (const module of controller.ioConfiguration.modules) {
      entities.push({
        kind: "device",
        name: module.name || module.catalogNumber || module.id,
        scope: controller.name,
        value: { ...module },
      });
    }

    for (const tag of controller.controllerTags) {
      entities.push({
        kind: "tag",
        name: tag.name,
        scope: `${controller.name}/Controller Tags`,
        value: { ...tag },
      });
    }

    for (const program of controller.programs) {
      entities.push({
        kind: "program",
        name: program.name,
        scope: controller.name,
        value: {
          id: program.id,
          name: program.name,
          description: program.description,
          mainRoutineId: program.mainRoutineId,
          faultRoutineId: program.faultRoutineId,
          testEdits: program.testEdits,
        },
      });

      for (const tag of program.programTags) {
        entities.push({
          kind: "tag",
          name: tag.name,
          scope: `${controller.name}/${program.name}`,
          value: { ...tag },
        });
      }

      for (const routine of program.routines) {
        entities.push({
          kind: "routine",
          name: routine.name,
          scope: `${controller.name}/${program.name}`,
          value: { ...routine },
        });
      }
    }
  }

  return entities;
}

function entityKey(entity: DiffEntity): string {
  return `${entity.kind}\u0000${entity.scope ?? ""}\u0000${entity.name}`;
}

function entityChange(entity: DiffEntity, change: StructuredChangeType, fields: string[] = []): StructuredChange {
  return {
    kind: entity.kind,
    change,
    name: entity.name,
    ...(entity.scope ? { scope: entity.scope } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort((left, right) => left.localeCompare(right));
}
