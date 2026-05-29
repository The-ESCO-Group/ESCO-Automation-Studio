/**
 * Project file migration registry.
 *
 * Each migration moves a `.plcproj.json` file from one format version to the next
 * adjacent version. The loader (see index.ts) chains them in order, so a very old
 * file is upgraded one step at a time to the current version. Migrations are pure
 * functions over the parsed file object and MUST be idempotent on already-correct
 * data, so a current-shape project round-trips unchanged (the round-trip tests
 * depend on this).
 *
 * Keeping migrations in their own module makes the registry easy to extend and
 * unit-test independently of the (de)serialization plumbing.
 */

export const PLCPROJ_FORMAT_NAME = "ESCO Automation Studio Project";
/** Current on-disk format version. Files below this are migrated on load. */
export const PLCPROJ_FORMAT_VERSION = 4;
/** App version stamped into saved files (informational). */
export const APP_VERSION = "0.1.0";

/** A single forward migration between two adjacent format versions. */
export interface Migration {
  from: number;
  to: number;
  name: string;
  migrate: (file: Record<string, unknown>) => Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ensure an object has an array at `key`, defaulting to `[]`. Returns whether it changed. */
function ensureArray(host: Record<string, unknown>, key: string): boolean {
  if (!Array.isArray(host[key])) {
    host[key] = [];
    return true;
  }
  return false;
}

/**
 * v2→v3: normalize the project's optional collections.
 *
 * Older and hand-authored files sometimes omit empty arrays (tasks, programs,
 * tags, dataTypes, AOIs, I/O modules, per-program routines/tags). v3 backfills
 * them so downstream code can iterate without defensive checks. This is a no-op
 * for a complete, well-formed project, so it does not change the round-trip
 * result for current files. If the project shape is too broken to normalize
 * safely (e.g. no controllers array), the file is returned unchanged and the
 * loader's structural guard reports it as malformed.
 */
export function migrateV2toV3(file: Record<string, unknown>): Record<string, unknown> {
  const project = file.project;
  if (!isObject(project) || !Array.isArray(project.controllers)) return file;

  for (const controller of project.controllers) {
    if (!isObject(controller)) continue;
    ensureArray(controller, "tasks");
    ensureArray(controller, "programs");
    ensureArray(controller, "controllerTags");
    ensureArray(controller, "dataTypes");
    ensureArray(controller, "addOnInstructions");
    if (!isObject(controller.ioConfiguration)) {
      controller.ioConfiguration = { modules: [] };
    } else {
      ensureArray(controller.ioConfiguration as Record<string, unknown>, "modules");
    }
    for (const program of controller.programs as unknown[]) {
      if (!isObject(program)) continue;
      ensureArray(program, "routines");
      ensureArray(program, "programTags");
    }
  }
  return file;
}

/**
 * v3->v4: backfill durable identity/timestamp metadata.
 *
 * Early project files allowed a structurally valid project to omit createdAt /
 * updatedAt and some parent ids. The app now treats those fields as durable
 * project metadata, so v4 fills them from the file's savedAt timestamp where
 * possible and repairs parent references for controllers, tasks, and programs.
 */
export function migrateV3toV4(file: Record<string, unknown>): Record<string, unknown> {
  const project = file.project;
  if (!isObject(project) || !Array.isArray(project.controllers)) return file;

  const savedAt = typeof file.savedAt === "string" ? file.savedAt : new Date(0).toISOString();
  if (typeof project.createdAt !== "string" || !project.createdAt) project.createdAt = savedAt;
  if (typeof project.updatedAt !== "string" || !project.updatedAt) project.updatedAt = savedAt;
  if (typeof project.description !== "string") project.description = "";

  for (const controller of project.controllers) {
    if (!isObject(controller)) continue;
    if (typeof controller.projectId !== "string" || !controller.projectId) {
      controller.projectId = project.id;
    }
    if (!Array.isArray(controller.tasks)) controller.tasks = [];
    if (!Array.isArray(controller.programs)) controller.programs = [];

    for (const task of controller.tasks as unknown[]) {
      if (!isObject(task)) continue;
      if (typeof task.controllerId !== "string" || !task.controllerId) {
        task.controllerId = controller.id;
      }
      if (!Array.isArray(task.scheduledProgramIds)) task.scheduledProgramIds = [];
    }

    for (const program of controller.programs as unknown[]) {
      if (!isObject(program)) continue;
      if (typeof program.controllerId !== "string" || !program.controllerId) {
        program.controllerId = controller.id;
      }
      if (!Array.isArray(program.routines)) program.routines = [];
      if (!Array.isArray(program.programTags)) program.programTags = [];
      for (const routine of program.routines as unknown[]) {
        if (isObject(routine) && (typeof routine.programId !== "string" || !routine.programId)) {
          routine.programId = program.id;
        }
      }
    }
  }

  return file;
}

/**
 * Ordered forward migrations. v1 files predate the format metadata block, so the
 * v1→v2 migration stamps the name/app version; v2→v3 normalizes collections.
 * Future structural migrations slot in here.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    name: "v1->v2: add format metadata",
    migrate: (file) => ({ ...file, formatName: PLCPROJ_FORMAT_NAME, appVersion: APP_VERSION }),
  },
  {
    from: 2,
    to: 3,
    name: "v2->v3: normalize project collections",
    migrate: migrateV2toV3,
  },
  {
    from: 3,
    to: 4,
    name: "v3->v4: normalize project metadata",
    migrate: migrateV3toV4,
  },
];

/** Find the migration that advances `version`, or undefined if none exists. */
export function migrationFrom(version: number): Migration | undefined {
  return MIGRATIONS.find((candidate) => candidate.from === version);
}
