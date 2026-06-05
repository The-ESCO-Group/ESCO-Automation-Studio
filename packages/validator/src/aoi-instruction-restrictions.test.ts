import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  createRoutine,
  type AddOnInstruction,
  type AoiParameter,
  type PlcProject,
  type Routine,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

const findings = (project: PlcProject) =>
  createDefaultEngine()
    .run(project)
    .filter((finding) => finding.ruleId === "aoi-instruction-restrictions");

function ladderRoutine(name: string, instructionTypes: string[]): Routine {
  const routine = createRoutine("aoi-Scale", name, "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(
      routine.id,
      0,
      instructionTypes.map((type) => createNode(type)),
    ),
  );
  routine.ladder = ladder;
  return routine;
}

function routineWithNodes(name: string, nodes: ReturnType<typeof createNode>[]): Routine {
  const routine = createRoutine("aoi-Scale", name, "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(routine.id, 0, nodes));
  routine.ladder = ladder;
  return routine;
}

function projectWithAoi(aoi: Partial<AddOnInstruction>): PlcProject {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  controller.addOnInstructions.push({
    id: "aoi-Scale",
    name: "Scale",
    parameters: [],
    localTags: [],
    routineNames: [],
    ...aoi,
  });
  project.controllers.push(controller);
  return project;
}

function param(name: string, dataType: string, usage: AoiParameter["usage"]): AoiParameter {
  return { name, dataType, usage };
}

describe("aoi-instruction-restrictions", () => {
  it("flags Studio-unavailable instructions inside AOI ladder routines", () => {
    const result = findings(
      projectWithAoi({
        routines: [ladderRoutine("Logic", ["XIC", "JSR", "PATT", "SFR", "JXR"])],
      }),
    );

    expect(result.map((finding) => finding.message).join("\n")).toContain("JSR");
    expect(result.map((finding) => finding.message).join("\n")).toContain("PATT");
    expect(result.map((finding) => finding.message).join("\n")).toContain("SFR");
    expect(result.map((finding) => finding.message).join("\n")).toContain("JXR");
    expect(result).toHaveLength(4);
  });

  it("leaves ordinary AOI ladder logic and protected AOI bodies alone", () => {
    expect(
      findings(
        projectWithAoi({
          routines: [ladderRoutine("Logic", ["XIC", "OTE", "TON"])],
        }),
      ),
    ).toHaveLength(0);

    expect(
      findings(
        projectWithAoi({
          protected: true,
          routines: [ladderRoutine("Logic", ["JSR"])],
        }),
      ),
    ).toHaveLength(0);
  });

  it("requires message, alarm, and declared motion data instances to be InOut parameters", () => {
    const result = findings(
      projectWithAoi({
        parameters: [
          param("MsgCtl", "MESSAGE", "Input"),
          param("AlarmTag", "ALARM_ANALOG", "Output"),
          param("MoveCtl", "MOTION_INSTRUCTION", "Input"),
        ],
        routines: [
          routineWithNodes("Logic", [
            createNode("MSG", [tagOperand("message", "MsgCtl")]),
            createNode("ALMA", [tagOperand("alarm", "AlarmTag")]),
            createNode("MAM", [tagOperand("axis", "Axis1"), tagOperand("motionControl", "MoveCtl")]),
          ]),
        ],
      }),
    );

    expect(result.map((finding) => finding.message).join("\n")).toContain("message control tag");
    expect(result.map((finding) => finding.message).join("\n")).toContain("alarm backing tag");
    expect(result.map((finding) => finding.message).join("\n")).toContain("motion control tag");
    expect(result).toHaveLength(3);
  });

  it("accepts AOI data instances passed through InOut parameters", () => {
    const result = findings(
      projectWithAoi({
        parameters: [
          param("MsgCtl", "MESSAGE", "InOut"),
          param("AlarmTag", "ALARM_DIGITAL", "InOut"),
          param("MoveCtl", "MOTION_INSTRUCTION", "InOut"),
        ],
        routines: [
          routineWithNodes("Logic", [
            createNode("MSG", [tagOperand("message", "MsgCtl")]),
            createNode("ALMD", [tagOperand("alarm", "AlarmTag")]),
            createNode("MAM", [tagOperand("axis", "Axis1"), tagOperand("motionControl", "MoveCtl")]),
          ]),
        ],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it("flags AOI GSV/SSV classes that Studio 5000 does not verify inside AOIs", () => {
    const result = findings(
      projectWithAoi({
        routines: [
          routineWithNodes("Logic", [
            createNode("GSV", [
              tagOperand("className", "ModuleGroup"),
              tagOperand("instanceName", "Rack"),
              tagOperand("attributeName", "Status"),
              tagOperand("dest", "Status"),
            ]),
            createNode("SSV", [
              tagOperand("className", "HardwareStatus"),
              tagOperand("instanceName", ""),
              tagOperand("attributeName", "Status"),
              tagOperand("source", "Value"),
            ]),
          ]),
        ],
      }),
    );

    const messages = result.map((finding) => finding.message).join("\n");
    expect(messages).toContain('class "ModuleGroup"');
    expect(messages).toContain('SSV class "HardwareStatus"');
    expect(result).toHaveLength(2);
  });

  it("requires THIS for AOI GSV/SSV programming-component instance names", () => {
    const result = findings(
      projectWithAoi({
        routines: [
          routineWithNodes("Logic", [
            createNode("GSV", [
              tagOperand("className", "Program"),
              tagOperand("instanceName", "Mixer"),
              tagOperand("attributeName", "Status"),
              tagOperand("dest", "Status"),
            ]),
            createNode("GSV", [
              tagOperand("className", "Routine"),
              tagOperand("instanceName", ""),
              tagOperand("attributeName", "Name"),
              tagOperand("dest", "NameBuffer"),
            ]),
          ]),
        ],
      }),
    );

    const messages = result.map((finding) => finding.message).join("\n");
    expect(messages).toContain('Program instance "Mixer"');
    expect(messages).toContain('Routine instance "<blank>"');
    expect(result).toHaveLength(2);
  });

  it("accepts supported AOI GSV/SSV classes and THIS programming-component instances", () => {
    const result = findings(
      projectWithAoi({
        routines: [
          routineWithNodes("Logic", [
            createNode("GSV", [
              tagOperand("className", "AddOnInstructionDefinition"),
              tagOperand("instanceName", "THIS"),
              tagOperand("attributeName", "MajorRevision"),
              tagOperand("dest", "Major"),
            ]),
            createNode("SSV", [
              tagOperand("className", "Controller"),
              tagOperand("instanceName", "Controller"),
              tagOperand("attributeName", "TimeSlice"),
              tagOperand("source", "Slice"),
            ]),
            createNode("GSV", [
              tagOperand("className", "Serial Port"),
              tagOperand("instanceName", "SerialPort"),
              tagOperand("attributeName", "Status"),
              tagOperand("dest", "SerialStatus"),
            ]),
          ]),
        ],
      }),
    );

    expect(result).toHaveLength(0);
  });
});
