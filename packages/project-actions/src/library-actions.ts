import type { AddOnInstruction, ControllerTrend, IoModule, PlcProject, Program, Routine, Tag, UserDefinedType } from "@esco/core";
import {
  EASLIB_EXTENSION,
  createNativeFileEnvelope,
  serializeNativeFileEnvelope,
  type EscoNativeFileEnvelope,
} from "./native-format";
import { ok } from "./helpers";
import type { ProjectActionResult } from "./types";

export interface EscoLibraryHmiSummary {
  screenCount: number;
  popupCount: number;
  alarmCount: number;
  trendCount: number;
  dataLogCount: number;
  languageCount: number;
}

export interface ExportEscoLibraryOptions {
  createdAt?: string;
  hmiProject?: {
    screens?: readonly unknown[];
    popupScreens?: readonly unknown[];
    alarmDefinitions?: readonly unknown[];
    trends?: readonly unknown[];
    dataLogs?: readonly unknown[];
    languages?: readonly unknown[];
  };
}

export interface EscoLibraryPayload {
  libraryVersion: 1;
  scope: "project-library";
  project: {
    id: string;
    name: string;
  };
  exportedAt: string;
  counts: {
    controllers: number;
    programs: number;
    routines: number;
    controllerTags: number;
    programTags: number;
    dataTypes: number;
    addOnInstructions: number;
    ioModules: number;
    trends: number;
    hmiScreens: number;
    hmiAssets: number;
  };
  controllers: Array<{
    id: string;
    name: string;
    programs: Program[];
    routines: Routine[];
    controllerTags: Tag[];
    programTags: Tag[];
    dataTypes: UserDefinedType[];
    addOnInstructions: AddOnInstruction[];
    ioModules: IoModule[];
    trends: ControllerTrend[];
  }>;
  hmi?: EscoLibraryHmiSummary;
  boundaries: {
    noProprietaryBinaryProjectFiles: true;
    noControllerTransfer: true;
    noControllerCommunication: true;
    noOnlineEdits: true;
    noPhysicalControllerImport: true;
  };
}

export interface ExportEscoLibraryData {
  fileName: string;
  mediaType: "application/vnd.esco.library+json";
  text: string;
  checksum: string;
  summary: EscoLibraryPayload["counts"];
  file: EscoNativeFileEnvelope<EscoLibraryPayload>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeFilePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "library";
}

function hmiSummary(hmiProject: ExportEscoLibraryOptions["hmiProject"]): EscoLibraryHmiSummary | undefined {
  if (!hmiProject) return undefined;
  return {
    screenCount: hmiProject.screens?.length ?? 0,
    popupCount: hmiProject.popupScreens?.length ?? 0,
    alarmCount: hmiProject.alarmDefinitions?.length ?? 0,
    trendCount: hmiProject.trends?.length ?? 0,
    dataLogCount: hmiProject.dataLogs?.length ?? 0,
    languageCount: hmiProject.languages?.length ?? 0,
  };
}

function buildLibraryPayload(project: PlcProject, options: ExportEscoLibraryOptions = {}): EscoLibraryPayload {
  const controllers = project.controllers.map((controller) => {
    const routines = controller.programs.flatMap((program) => program.routines);
    const programTags = controller.programs.flatMap((program) => program.programTags);
    return {
      id: controller.id,
      name: controller.name,
      programs: cloneJson(controller.programs),
      routines: cloneJson(routines),
      controllerTags: cloneJson(controller.controllerTags),
      programTags: cloneJson(programTags),
      dataTypes: cloneJson(controller.dataTypes),
      addOnInstructions: cloneJson(controller.addOnInstructions),
      ioModules: cloneJson(controller.ioConfiguration.modules),
      trends: cloneJson(controller.trends ?? []),
    };
  });
  const hmi = hmiSummary(options.hmiProject);
  const counts = {
    controllers: controllers.length,
    programs: controllers.reduce((sum, controller) => sum + controller.programs.length, 0),
    routines: controllers.reduce((sum, controller) => sum + controller.routines.length, 0),
    controllerTags: controllers.reduce((sum, controller) => sum + controller.controllerTags.length, 0),
    programTags: controllers.reduce((sum, controller) => sum + controller.programTags.length, 0),
    dataTypes: controllers.reduce((sum, controller) => sum + controller.dataTypes.length, 0),
    addOnInstructions: controllers.reduce((sum, controller) => sum + controller.addOnInstructions.length, 0),
    ioModules: controllers.reduce((sum, controller) => sum + controller.ioModules.length, 0),
    trends: controllers.reduce((sum, controller) => sum + controller.trends.length, 0),
    hmiScreens: (hmi?.screenCount ?? 0) + (hmi?.popupCount ?? 0),
    hmiAssets:
      (hmi?.alarmCount ?? 0) +
      (hmi?.trendCount ?? 0) +
      (hmi?.dataLogCount ?? 0) +
      (hmi?.languageCount ?? 0),
  };
  return {
    libraryVersion: 1,
    scope: "project-library",
    project: { id: project.id, name: project.name },
    exportedAt: options.createdAt ?? project.updatedAt,
    counts,
    controllers,
    ...(hmi ? { hmi } : {}),
    boundaries: {
      noProprietaryBinaryProjectFiles: true,
      noControllerTransfer: true,
      noControllerCommunication: true,
      noOnlineEdits: true,
      noPhysicalControllerImport: true,
    },
  };
}

export function exportEscoLibrary(
  project: PlcProject,
  options: ExportEscoLibraryOptions = {},
): ProjectActionResult<ExportEscoLibraryData> {
  const payload = buildLibraryPayload(project, options);
  const file = createNativeFileEnvelope("library", payload, options.createdAt ? { createdAt: options.createdAt } : {});
  return ok(project, {
    fileName: `${safeFilePart(project.name)}${EASLIB_EXTENSION}`,
    mediaType: "application/vnd.esco.library+json",
    text: serializeNativeFileEnvelope(file),
    checksum: file.native.checksum.value,
    summary: payload.counts,
    file,
  });
}
