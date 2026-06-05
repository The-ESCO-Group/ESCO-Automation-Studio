import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A model-only AOI with one required Input and one (implicit) EnableIn parameter. */
function meterAoi(): AddOnInstruction {
  return {
    id: "aoi-METER",
    name: "METER",
    parameters: [
      { name: "EnableIn", dataType: "BOOL", usage: "Input", required: true },
      { name: "EnableOut", dataType: "BOOL", usage: "Output", required: true },
      { name: "In", dataType: "DINT", usage: "Input", required: true },
      { name: "Out", dataType: "DINT", usage: "Output" },
    ],
    localTags: [],
    routineNames: [],
  };
}

/** Build a project whose Main routine calls METER with `args` operands after the instance. */
function projectCallingMeter(args: string[]) {
  const project = createProject("AoiParam");
  const controller = createController(project.id, "AoiParam");
  controller.addOnInstructions.push(meterAoi());
  controller.controllerTags.push(createTag(controller.id, "Meter_01", "METER"));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("METER", ["Meter_01", ...args].map((value, i) => tagOperand(`op${i}`, value))),
    ]),
  );
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("AOI call required-parameter verification", () => {
  it("flags a call that omits a required parameter argument", () => {
    const findings = createDefaultEngine().run(projectCallingMeter([]));
    const missing = findings.filter((f) => f.ruleId === "missing-aoi-parameter");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe("error");
    // EnableIn/EnableOut are implicit, so only "In" is reported missing — not three.
    expect(missing[0]!.message).toContain("In");
    expect(missing[0]!.message).toContain("1 required parameter");
  });

  it("does not flag a call that supplies the required parameter", () => {
    const findings = createDefaultEngine().run(projectCallingMeter(["Meter_01.In"]));
    expect(findings.some((f) => f.ruleId === "missing-aoi-parameter")).toBe(false);
  });

  it("does not flag extra optional arguments beyond the required ones", () => {
    const findings = createDefaultEngine().run(projectCallingMeter(["Meter_01.In", "Meter_01.Out"]));
    expect(findings.some((f) => f.ruleId === "missing-aoi-parameter")).toBe(false);
  });
});
