import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type AddOnInstruction,
  type AoiLocalTag,
  type PlcProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

function aoiProject(localTags: AoiLocalTag[]): PlcProject {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const aoi: AddOnInstruction = {
    id: "aoi-Mixer",
    name: "Mixer",
    parameters: [],
    localTags,
    routineNames: [],
  };
  controller.addOnInstructions.push(aoi);
  project.controllers.push(controller);
  return project;
}

const localTagFindings = (localTags: AoiLocalTag[]) =>
  createDefaultEngine()
    .run(aoiProject(localTags))
    .filter((finding) => finding.ruleId === "aoi-local-tag-type");

describe("aoi-local-tag-type", () => {
  it("flags MESSAGE, MODULE, alarm, and motion data types as AOI local tags", () => {
    const findings = localTagFindings([
      { name: "Msg", dataType: "MESSAGE" },
      { name: "ModuleRef", dataType: "MODULE" },
      { name: "AnalogAlarm", dataType: "ALARM_ANALOG" },
      { name: "DigitalAlarm", dataType: "ALARM_DIGITAL" },
      { name: "Axis", dataType: "AXIS_SERVO_DRIVE" },
      { name: "MoveCtl", dataType: "MOTION_INSTRUCTION" },
      { name: "Group", dataType: "MOTION_GROUP" },
    ]);

    expect(findings).toHaveLength(7);
    expect(findings.map((finding) => finding.target)).toContain("Ctrl/Mixer.Msg");
    expect(findings.map((finding) => finding.message).join("\n")).toContain("InOut parameter");
  });

  it("flags multi-dimensional AOI local tag arrays", () => {
    const findings = localTagFindings([{ name: "Matrix", dataType: "DINT", dimensions: [2, 3] }]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("DINT[2,3]");
    expect(findings[0]!.message).toContain("single-dimension arrays");
  });

  it("accepts ordinary AOI local tags and single-dimension arrays", () => {
    expect(
      localTagFindings([
        { name: "Scratch", dataType: "DINT" },
        { name: "Buffer", dataType: "REAL", dimensions: [16] },
        { name: "Timer", dataType: "TIMER" },
        { name: "State", dataType: "MotorState" },
      ]),
    ).toHaveLength(0);
  });
});
