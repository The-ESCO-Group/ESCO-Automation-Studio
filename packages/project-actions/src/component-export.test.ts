import { describe, expect, it } from "vitest";
import {
  createController,
  createContinuousTask,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import {
  exportControllerComponent,
  exportCustomInstructionComponent,
  exportDataTypeComponent,
  exportDeviceDefinitionComponent,
  exportDeviceTreeComponent,
  exportProgramComponent,
  exportRoutineComponent,
  exportTagComponent,
  exportTaskComponent,
} from "./component-export";

function buildProject(): PlcProject {
  const project = {
    ...createProject("Packaging Line"),
    id: "proj-demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  const controller = {
    ...createController(project.id, "Controller_1"),
    id: "ctrl-1",
    controllerTags: [
      { ...createTag("ctrl-1", "StartPB", "BOOL"), id: "tag-start" },
      { ...createTag("ctrl-1", "MotorRun", "BOOL"), id: "tag-run" },
    ],
  };
  const program = {
    ...createProgram(controller.id, "MainProgram"),
    id: "prog-1",
    programTags: [
      {
        ...createTag(controller.id, "LocalSpeed", "MotorStatus", { scope: "program", programId: "prog-1" }),
        id: "tag-local-speed",
      },
    ],
  };
  const routine = {
    ...createRoutine(program.id, "MainRoutine", "structured-text"),
    id: "rtn-1",
    structuredText: "MotorRun := StartPB AND LocalSpeed.Ready;",
  };
  const helperRoutine = { ...createRoutine(program.id, "HelperRoutine"), id: "rtn-2" };
  const task = { ...createContinuousTask(controller.id, "MainTask", [program.id]), id: "task-1" };
  const dataType: UserDefinedType = {
    id: "udt-1",
    name: "MotorStatus",
    members: [
      { name: "Ready", dataType: "BOOL" },
      { name: "Speed", dataType: "REAL" },
    ],
  };
  const instruction: AddOnInstruction = {
    id: "aoi-1",
    name: "ScaleValue",
    revision: "1.0",
    parameters: [
      { name: "In", dataType: "REAL", usage: "Input" },
      { name: "Out", dataType: "REAL", usage: "Output" },
    ],
    localTags: [{ name: "Span", dataType: "REAL" }],
    routineNames: ["Logic"],
    routines: [{ ...createRoutine("aoi-1", "Logic", "structured-text"), id: "aoi-rtn-1", structuredText: "Out := In * Span;" }],
  };

  return {
    ...project,
    controllers: [
      {
        ...controller,
        tasks: [task],
        programs: [{ ...program, routines: [routine, helperRoutine], mainRoutineId: routine.id }],
        dataTypes: [dataType],
        addOnInstructions: [instruction],
        ioConfiguration: {
          modules: [
            {
              id: "module-1",
              name: "Local_AI_01",
              catalogNumber: "1756-IF8H",
              slot: 1,
              productType: "HART Analog Card",
            },
            {
              id: "module-2",
              name: "Drive_01",
              catalogNumber: "PowerFlex_Ref",
              commPath: "192.168.1.20",
              productType: "AC Drive / VFD",
            },
          ],
        },
      },
    ],
  };
}

describe("component export", () => {
  it("exports a controller envelope with project-wide logic, tag, type, and device dependencies", () => {
    const result = exportControllerComponent(buildProject(), "ctrl-1");

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("Controller_1.esco-controller.json");
    expect(result.data?.envelope).toMatchObject({
      format: "esco.component.export.v1",
      kind: "controller",
      name: "Controller_1",
      owner: { id: "ctrl-1", name: "Controller_1", type: "controller" },
      dependencies: {
        tags: ["LocalSpeed", "MotorRun", "StartPB"],
        dataTypes: ["BOOL", "MotorStatus", "REAL"],
        routines: ["HelperRoutine", "Logic", "MainRoutine"],
        devices: ["Drive_01", "Local_AI_01"],
      },
    });
  });

  it("exports controller- and program-scoped tag envelopes with the correct owner", () => {
    const project = buildProject();
    const controllerTag = exportTagComponent(project, "tag-run");
    const programTag = exportTagComponent(project, "tag-local-speed");

    expect(controllerTag.ok).toBe(true);
    expect(controllerTag.data?.fileName).toBe("MotorRun.esco-tag.json");
    expect(controllerTag.data?.envelope).toMatchObject({
      kind: "tag",
      name: "MotorRun",
      owner: { id: "ctrl-1", name: "Controller_1", type: "controller" },
      dependencies: {
        tags: ["MotorRun"],
        dataTypes: ["BOOL"],
        routines: [],
        devices: [],
      },
    });

    expect(programTag.ok).toBe(true);
    expect(programTag.data?.fileName).toBe("LocalSpeed.esco-tag.json");
    expect(programTag.data?.envelope).toMatchObject({
      kind: "tag",
      name: "LocalSpeed",
      owner: { id: "prog-1", name: "MainProgram", type: "program" },
      dependencies: {
        tags: ["LocalSpeed"],
        dataTypes: ["MotorStatus"],
        routines: [],
        devices: [],
      },
    });
  });

  it("exports a routine envelope with referenced tag dependencies", () => {
    const project = buildProject();
    const result = exportRoutineComponent(project, "rtn-1");

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("MainRoutine.esco-routine.json");
    expect(result.data?.envelope).toMatchObject({
      format: "esco.component.export.v1",
      kind: "routine",
      exportedAt: "2026-01-02T00:00:00.000Z",
      name: "MainRoutine",
      owner: { id: "prog-1", name: "MainProgram", type: "program" },
      dependencies: {
        tags: ["LocalSpeed", "MotorRun", "StartPB"],
        dataTypes: ["BOOL", "MotorStatus"],
        routines: ["MainRoutine"],
        devices: [],
      },
    });
    expect(result.data?.text).toContain('"kind": "routine"');
    expect(result.project).toBe(project);
  });

  it("exports a program with routines and local tag data-type dependencies", () => {
    const result = exportProgramComponent(buildProject(), "prog-1");

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("MainProgram.esco-program.json");
    expect(result.data?.envelope.dependencies).toEqual({
      tags: ["LocalSpeed", "MotorRun", "StartPB"],
      dataTypes: ["BOOL", "MotorStatus"],
      routines: ["HelperRoutine", "MainRoutine"],
      devices: [],
    });
  });

  it("exports a task with its scheduled program summary", () => {
    const result = exportTaskComponent(buildProject(), "task-1");

    expect(result.ok).toBe(true);
    expect(result.data?.fileName).toBe("MainTask.esco-task.json");
    expect(result.data?.envelope).toMatchObject({
      kind: "task",
      name: "MainTask",
      dependencies: {
        tags: ["LocalSpeed"],
        dataTypes: ["MotorStatus"],
        routines: ["HelperRoutine", "MainRoutine"],
        devices: [],
      },
    });
  });

  it("exports data type, custom instruction, and device-tree payloads", () => {
    const project = buildProject();
    const dataType = exportDataTypeComponent(project, "udt-1");
    const customInstruction = exportCustomInstructionComponent(project, "aoi-1");
    const deviceDefinition = exportDeviceDefinitionComponent(project, "ctrl-1", "module-1");
    const devices = exportDeviceTreeComponent(project, "ctrl-1");

    expect(dataType.data?.envelope).toMatchObject({
      kind: "data-type",
      name: "MotorStatus",
      dependencies: { dataTypes: ["BOOL", "REAL"] },
    });
    expect(customInstruction.data?.envelope).toMatchObject({
      kind: "custom-instruction",
      name: "ScaleValue",
      dependencies: {
        tags: ["Span"],
        dataTypes: ["REAL"],
        routines: ["Logic"],
      },
    });
    expect(deviceDefinition.data?.envelope).toMatchObject({
      kind: "device-definition",
      name: "Local_AI_01",
      dependencies: {
        devices: ["Local_AI_01"],
        dataTypes: ["HART Analog Card"],
      },
    });
    expect(devices.data?.envelope).toMatchObject({
      kind: "device-tree",
      name: "Controller_1 Device Tree",
      dependencies: {
        devices: ["Drive_01", "Local_AI_01"],
        dataTypes: ["AC Drive / VFD", "HART Analog Card"],
      },
    });
  });

  it("returns an action failure when the selected component is missing", () => {
    const project = buildProject();
    const result = exportRoutineComponent(project, "missing-routine");
    const missingController = exportControllerComponent(project, "missing-controller");
    const missingTag = exportTagComponent(project, "missing-tag");

    expect(result.ok).toBe(false);
    expect(result.project).toBe(project);
    expect(result.error).toMatch(/Routine "missing-routine" was not found/);
    expect(missingController.ok).toBe(false);
    expect(missingController.error).toMatch(/Controller "missing-controller" was not found/);
    expect(missingTag.ok).toBe(false);
    expect(missingTag.error).toMatch(/Tag "missing-tag" was not found/);
  });
});
