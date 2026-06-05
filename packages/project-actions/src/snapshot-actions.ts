import type { PlcProject } from "@esco/core";
import { isHmiProject, type HmiProject, withHmiProject } from "@esco/hmi-model";
import { createProject } from "@esco/core";
import { fail, ok } from "./helpers";
import {
  createNativeFileEnvelope,
  EASSNAPSHOT_EXTENSION,
  parseNativeFileEnvelope,
  serializeNativeFileEnvelope,
} from "./native-format";
import type { ProjectActionResult } from "./types";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function projectCounts(project: PlcProject) {
  const controllers = project.controllers.length;
  const programs = project.controllers.reduce((sum, controller) => sum + controller.programs.length, 0);
  const routines = project.controllers.reduce(
    (sum, controller) => sum + controller.programs.reduce((inner, program) => inner + program.routines.length, 0),
    0,
  );
  const tags = project.controllers.reduce(
    (sum, controller) =>
      sum +
      controller.controllerTags.length +
      controller.programs.reduce((inner, program) => inner + program.programTags.length, 0),
    0,
  );
  const ioModules = project.controllers.reduce((sum, controller) => sum + controller.ioConfiguration.modules.length, 0);
  return { controllers, programs, routines, tags, ioModules };
}

export interface EscoSnapshotPayload {
  snapshotKind: "offline-project-snapshot";
  project: PlcProject;
  hmiProject?: HmiProject;
  summary: {
    projectId: string;
    projectName: string;
    controllerCount: number;
    programCount: number;
    routineCount: number;
    tagCount: number;
    ioModuleCount: number;
    hmiScreenCount: number;
    hmiAlarmCount: number;
    boundaries: string[];
  };
}

export interface ExportEscoSnapshotOptions {
  createdAt?: string;
  hmiProject?: HmiProject;
}

export interface ExportEscoSnapshotData {
  fileName: string;
  text: string;
  checksum: string;
  summary: EscoSnapshotPayload["summary"];
}

export interface ImportEscoSnapshotData {
  checksumValid: boolean;
  summary: EscoSnapshotPayload["summary"];
  restoredHmiProject: boolean;
}

function snapshotPayload(project: PlcProject, hmiProject?: HmiProject): EscoSnapshotPayload {
  const counts = projectCounts(project);
  return {
    snapshotKind: "offline-project-snapshot",
    project: cloneJson(project),
    ...(hmiProject ? { hmiProject: cloneJson(hmiProject) } : {}),
    summary: {
      projectId: project.id,
      projectName: project.name,
      controllerCount: counts.controllers,
      programCount: counts.programs,
      routineCount: counts.routines,
      tagCount: counts.tags,
      ioModuleCount: counts.ioModules,
      hmiScreenCount: hmiProject?.screens.length ?? 0,
      hmiAlarmCount: hmiProject?.alarms.length ?? 0,
      boundaries: [
        "offline-project-state-only",
        "no-controller-communication",
        "no-physical-upload-download",
        "no-online-edit",
      ],
    },
  };
}

function isSnapshotPayload(value: unknown): value is EscoSnapshotPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<EscoSnapshotPayload>;
  return record.snapshotKind === "offline-project-snapshot" && typeof record.project?.name === "string";
}

/** Export a restorable, checksum-protected ESCO offline project snapshot. */
export function exportEscoSnapshot(
  project: PlcProject,
  options: ExportEscoSnapshotOptions = {},
): ProjectActionResult<ExportEscoSnapshotData> {
  const payload = snapshotPayload(project, options.hmiProject);
  const file = createNativeFileEnvelope("snapshot", payload, options.createdAt ? { createdAt: options.createdAt } : {});
  return ok(project, {
    fileName: `${snapshotSlug(project.name)}${EASSNAPSHOT_EXTENSION}`,
    text: serializeNativeFileEnvelope(file),
    checksum: file.native.checksum.value,
    summary: payload.summary,
  });
}

/** Restore a project from a checksum-verified `.eassnap` snapshot. */
export function importProjectFromEscoSnapshot(
  text: string,
  fileName?: string,
): ProjectActionResult<ImportEscoSnapshotData> {
  const loaded = parseNativeFileEnvelope<EscoSnapshotPayload>(text, {
    expectedKind: "snapshot",
    ...(fileName ? { fileName } : {}),
  });
  if (!loaded.ok || !loaded.file) {
    return fail(createProject("Untitled"), loaded.error ?? "Invalid ESCO snapshot.");
  }
  const payload = loaded.file.payload;
  if (!isSnapshotPayload(payload)) {
    return fail(createProject("Untitled"), "ESCO snapshot payload is missing a restorable project image.");
  }

  const restoredProject = cloneJson(payload.project);
  const hmiPayload = payload.hmiProject;
  const restoredHmiProject = isHmiProject(hmiPayload);
  const project = restoredHmiProject ? withHmiProject(restoredProject, cloneJson(hmiPayload)) : restoredProject;

  return ok(
    project,
    {
      checksumValid: loaded.checksum?.valid ?? false,
      summary: payload.summary,
      restoredHmiProject,
    },
    [
      "Restored an ESCO offline project snapshot. No controller connection, upload, download, or online edit was attempted.",
      ...(payload.hmiProject && !restoredHmiProject ? ["Snapshot carried HMI state that could not be validated and was skipped."] : []),
    ],
  );
}
