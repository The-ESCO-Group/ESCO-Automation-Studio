import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type UserDefinedType,
} from "@esco/core";
import { createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { alarmReviewReport } from "./alarm-review";

function projectWithAlarms() {
  const project = createProject("Alarm Review");
  const controller = createController(project.id, "AlarmCtl");
  const program = createProgram(controller.id, "Area01");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");

  controller.controllerTags.push(createTag(controller.id, "LevelHigh", "ALARM_ANALOG"));
  controller.controllerTags.push(createTag(controller.id, "DoorOpen", "ALARM_DIGITAL"));
  controller.controllerTags.push(createTag(controller.id, "BadAlarm", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "LevelPV", "REAL"));
  controller.controllerTags.push(createTag(controller.id, "DoorIn", "BOOL"));

  const pAlarm: AddOnInstruction = {
    id: "aoi-palarm",
    name: "P_Alarm",
    protected: true,
    parameters: [
      { name: "Inp", dataType: "BOOL", usage: "Input" },
      { name: "Sts_InAlarm", dataType: "BOOL", usage: "Output" },
    ],
    localTags: [{ name: "Cfg", dataType: "DINT" }],
    routineNames: ["Logic"],
  };
  const alarmUdt: UserDefinedType = {
    id: "udt-alarm",
    name: "AreaAlarm",
    members: [
      { name: "InAlarm", dataType: "BOOL" },
      { name: "Acked", dataType: "BOOL" },
    ],
  };
  controller.addOnInstructions.push(pAlarm);
  controller.dataTypes.push(alarmUdt);

  const ladder: LadderRoutine = {
    id: "ladder-main",
    rungs: [
      createRung(routine.id, 0, [
        createNode("ALMA", [tagOperand("alarm", "LevelHigh"), tagOperand("in", "LevelPV")]),
      ]),
      createRung(routine.id, 1, [
        createNode("ALMD", [tagOperand("alarm", "DoorOpen"), tagOperand("in", "DoorIn")]),
      ]),
      createRung(routine.id, 2, [
        createNode("ALMD", [tagOperand("alarm", "BadAlarm"), tagOperand("in", "DoorIn")]),
      ]),
    ],
  };
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("alarmReviewReport", () => {
  it("surfaces imported alarm tags, process-alarm definitions, and ALMA/ALMD review rows", () => {
    const report = alarmReviewReport(projectWithAlarms());

    expect(report.alarmObjectCount).toBe(7);
    expect(report.alarmTagCount).toBe(2);
    expect(report.alarmInstructionCount).toBe(3);
    expect(report.processAlarmDefinitionCount).toBe(2);
    expect(report.metadataOnlyCount).toBe(2);
    expect(report.boundaries).toContain("no-alarm-latch-or-acknowledge");
    expect(report.boundaries).toContain("no-controller-communication");
    expect(report.boundaries).toContain("no-proprietary-binary-support");

    const analogTag = report.rows.find((row) => row.kind === "alarm-tag" && row.name === "LevelHigh")!;
    expect(analogTag.status).toBe("reviewable");
    expect(analogTag.alarmKind).toBe("analog");

    const processAoi = report.rows.find((row) => row.kind === "process-alarm-definition" && row.name === "P_Alarm")!;
    expect(processAoi.status).toBe("metadata-only");
    expect(processAoi.issues).toContain("source-protected-aoi");
    expect(processAoi.representativeFields).toContain("Sts_InAlarm: BOOL");

    const resolvedInstruction = report.rows.find((row) => row.kind === "alarm-instruction" && row.name === "DoorOpen")!;
    expect(resolvedInstruction.status).toBe("reviewable");
    expect(resolvedInstruction.operands.find((operand) => operand.name === "alarm")?.dataType).toBe("ALARM_DIGITAL");

    const mismatch = report.rows.find((row) => row.kind === "alarm-instruction" && row.name === "BadAlarm")!;
    expect(mismatch.status).toBe("needs-attention");
    expect(mismatch.issues).toContain("alarm-tag-type-mismatch");
    expect(report.warnings.some((warning) => /ALMD alarm instruction needs/.test(warning))).toBe(true);
  });

  it("returns an empty report for projects without alarm tags, definitions, or instructions", () => {
    const project = createProject("Plain");
    const controller = createController(project.id, "PlainCtl");
    controller.controllerTags.push(createTag(controller.id, "MotorRun", "BOOL"));
    project.controllers.push(controller);

    const report = alarmReviewReport(project);
    expect(report.alarmObjectCount).toBe(0);
    expect(report.rows).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
