import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import { exportEscoLibrary, type EscoLibraryPayload } from "./library-actions";
import { parseNativeFileEnvelope, validateEscoNativeArtifact } from "./native-format";

function fixture(): PlcProject {
  const project = {
    ...createProject("Packaging Library"),
    id: "project-lib",
    updatedAt: "2026-06-04T12:00:00.000Z",
  };
  const controller = {
    ...createController(project.id, "Controller_1"),
    id: "controller-1",
  };
  const program = {
    ...createProgram(controller.id, "MainProgram"),
    id: "program-1",
  };
  program.routines.push({
    ...createRoutine(program.id, "MainRoutine", "structured-text"),
    id: "routine-1",
    structuredText: "MotorRun := StartPB;",
  });
  program.programTags.push({
    ...createTag(controller.id, "LocalSpeed", "REAL", { scope: "program", programId: program.id }),
    id: "tag-local-speed",
  });
  controller.programs.push(program);
  controller.controllerTags.push(
    { ...createTag(controller.id, "StartPB", "BOOL"), id: "tag-start" },
    { ...createTag(controller.id, "MotorRun", "BOOL"), id: "tag-run" },
  );
  controller.dataTypes.push({
    id: "udt-1",
    name: "MotorStatus",
    members: [{ name: "Ready", dataType: "BOOL" }],
  });
  controller.addOnInstructions.push({
    id: "aoi-1",
    name: "ScaleValue",
    revision: "1.0",
    parameters: [{ name: "In", dataType: "REAL", usage: "Input" }],
    localTags: [],
    routineNames: [],
  });
  controller.ioConfiguration.modules.push({
    id: "module-1",
    name: "AI_01",
    catalogNumber: "1756-IF8H",
    productType: "Analog Input",
  });
  (controller.trends ??= []).push({ id: "trend-1", name: "LineSpeed", pens: [] });
  project.controllers.push(controller);
  return project;
}

describe("exportEscoLibrary", () => {
  it("exports a checksummed .easlib native library artifact with offline boundaries", () => {
    const result = exportEscoLibrary(fixture(), {
      createdAt: "2026-06-04T13:00:00.000Z",
      hmiProject: {
        screens: [{ id: "screen-1" }],
        popupScreens: [{ id: "popup-1" }],
        alarmDefinitions: [{ id: "alarm-1" }],
        trends: [{ id: "hmi-trend-1" }],
        dataLogs: [{ id: "log-1" }],
        languages: [{ id: "en-US" }],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("packaging-library.easlib");
    expect(result.data?.mediaType).toBe("application/vnd.esco.library+json");
    expect(result.data?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data?.summary).toMatchObject({
      controllers: 1,
      programs: 1,
      routines: 1,
      controllerTags: 2,
      programTags: 1,
      dataTypes: 1,
      addOnInstructions: 1,
      ioModules: 1,
      trends: 1,
      hmiScreens: 2,
      hmiAssets: 4,
    });

    const parsed = parseNativeFileEnvelope<EscoLibraryPayload>(result.data!.text, {
      fileName: result.data!.fileName,
      expectedKind: "library",
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.checksum?.valid).toBe(true);
    expect(parsed.file?.payload.boundaries).toEqual({
      noProprietaryBinaryProjectFiles: true,
      noControllerTransfer: true,
      noControllerCommunication: true,
      noOnlineEdits: true,
      noPhysicalControllerImport: true,
    });
    expect(validateEscoNativeArtifact(result.data!.text, result.data!.fileName).summary).toMatchObject({
      validationType: "native-envelope",
      kind: "library",
      extension: ".easlib",
      checksumValid: true,
    });
  });
});
