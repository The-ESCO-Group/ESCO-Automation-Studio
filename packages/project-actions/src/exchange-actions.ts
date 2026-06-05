import { createProject, type PlcProject } from "@esco/core";
import { fail, ok } from "./helpers";
import { exportProjectJson, importProjectFile } from "./io-actions";
import {
  createNativeFileEnvelope,
  EASPROJ_EXTENSION,
  EASX_EXTENSION,
  getEscoNativeFormat,
  parseNativeFileEnvelope,
  serializeNativeFileEnvelope,
} from "./native-format";
import type { ProjectActionResult } from "./types";

function exchangeSlug(name: string): string {
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

const EXCHANGE_BOUNDARIES = [
  "offline-editable-project-only",
  "no-controller-communication",
  "no-physical-upload-download",
  "no-online-edit",
  "no-proprietary-binary-project",
] as const;

export interface EscoExchangePayload {
  exchangeKind: "editable-project-exchange";
  artifact: {
    path: string;
    format: "project";
    extension: typeof EASPROJ_EXTENSION;
    mediaType: string;
    bytes: number;
    text: string;
  };
  summary: {
    projectId: string;
    projectName: string;
    controllerCount: number;
    programCount: number;
    routineCount: number;
    tagCount: number;
    ioModuleCount: number;
    artifactCount: number;
    formats: readonly ["project"];
    boundaries: readonly string[];
  };
}

export interface ExportEscoExchangeOptions {
  createdAt?: string;
}

export interface ExportEscoExchangeData {
  fileName: string;
  text: string;
  checksum: string;
  mediaType: string;
  projectPath: string;
  projectBytes: number;
  summary: EscoExchangePayload["summary"];
}

export interface ImportEscoExchangeProjectData {
  checksumValid: boolean;
  projectPath: string;
  projectBytes: number;
  summary: EscoExchangePayload["summary"];
  migrationsApplied: string[];
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isExchangePayload(value: unknown): value is EscoExchangePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<EscoExchangePayload>;
  const artifact = record.artifact as Partial<EscoExchangePayload["artifact"]> | undefined;
  const summary = record.summary as Partial<EscoExchangePayload["summary"]> | undefined;
  return (
    record.exchangeKind === "editable-project-exchange" &&
    typeof artifact?.path === "string" &&
    artifact.format === "project" &&
    artifact.extension === EASPROJ_EXTENSION &&
    typeof artifact.text === "string" &&
    typeof summary?.projectName === "string" &&
    Array.isArray(summary.boundaries)
  );
}

function exchangePayload(project: PlcProject, projectText: string): EscoExchangePayload {
  const slug = exchangeSlug(project.name);
  const counts = projectCounts(project);
  const projectPath = `project/${slug}${EASPROJ_EXTENSION}`;
  return {
    exchangeKind: "editable-project-exchange",
    artifact: {
      path: projectPath,
      format: "project",
      extension: EASPROJ_EXTENSION,
      mediaType: getEscoNativeFormat("project").mediaType,
      bytes: byteLength(projectText),
      text: projectText,
    },
    summary: {
      projectId: project.id,
      projectName: project.name,
      controllerCount: counts.controllers,
      programCount: counts.programs,
      routineCount: counts.routines,
      tagCount: counts.tags,
      ioModuleCount: counts.ioModules,
      artifactCount: 1,
      formats: ["project"],
      boundaries: EXCHANGE_BOUNDARIES,
    },
  };
}

/** Export a portable, editable ESCO project exchange (`.easx`) with checksum-protected payload. */
export function exportEscoExchange(
  project: PlcProject,
  options: ExportEscoExchangeOptions = {},
): ProjectActionResult<ExportEscoExchangeData> {
  const projectExport = exportProjectJson(project);
  if (!projectExport.ok || !projectExport.data) {
    return fail(project, projectExport.error ?? "ESCO project export failed.");
  }

  const payload = exchangePayload(project, projectExport.data.text);
  const file = createNativeFileEnvelope("exchange", payload, options.createdAt ? { createdAt: options.createdAt } : {});
  const format = getEscoNativeFormat("exchange");
  return ok(project, {
    fileName: `${exchangeSlug(project.name)}${EASX_EXTENSION}`,
    text: serializeNativeFileEnvelope(file),
    checksum: file.native.checksum.value,
    mediaType: format.mediaType,
    projectPath: payload.artifact.path,
    projectBytes: payload.artifact.bytes,
    summary: payload.summary,
  });
}

/** Restore the editable ESCO project carried by a checksum-verified `.easx` exchange. */
export function importProjectFromEscoExchange(
  text: string,
  fileName?: string,
): ProjectActionResult<ImportEscoExchangeProjectData> {
  const loaded = parseNativeFileEnvelope<EscoExchangePayload>(text, {
    expectedKind: "exchange",
    ...(fileName ? { fileName } : {}),
  });
  if (!loaded.ok || !loaded.file) {
    return fail(createProject("Untitled"), loaded.error ?? "Invalid ESCO exchange.");
  }
  const payload = loaded.file.payload;
  if (!isExchangePayload(payload)) {
    return fail(createProject("Untitled"), "ESCO exchange payload is missing an editable .easproj project artifact.");
  }
  if (!payload.artifact.path.toLowerCase().endsWith(EASPROJ_EXTENSION)) {
    return fail(createProject("Untitled"), `ESCO exchange project artifact "${payload.artifact.path}" must end with ${EASPROJ_EXTENSION}.`);
  }
  if (payload.artifact.bytes !== byteLength(payload.artifact.text)) {
    return fail(createProject("Untitled"), `ESCO exchange project artifact "${payload.artifact.path}" byte count does not match embedded content.`);
  }

  const projectFile = importProjectFile(payload.artifact.text);
  if (!projectFile.ok || !projectFile.data) {
    return fail(
      createProject("Untitled"),
      `ESCO exchange project artifact "${payload.artifact.path}" could not be opened: ${projectFile.error ?? "invalid project file"}.`,
    );
  }

  return ok(
    projectFile.project,
    {
      checksumValid: loaded.checksum?.valid ?? false,
      projectPath: payload.artifact.path,
      projectBytes: payload.artifact.bytes,
      summary: payload.summary,
      migrationsApplied: projectFile.data.migrationsApplied,
    },
    [
      "Restored an ESCO editable project exchange. No controller connection, upload, download, or online edit was attempted.",
      ...(projectFile.warnings ?? []),
    ],
  );
}
