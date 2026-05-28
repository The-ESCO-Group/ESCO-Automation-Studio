import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A one-controller project whose MainRoutine references `refTag` via an XIC. */
function projectReferencing(refTag: string, definedTags: string[]): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("tag", refTag)]),
      createNode("OTE", [tagOperand("tag", "MotorRun")]),
    ]),
  );
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const name of definedTags) {
    controller.controllerTags.push(createTag(controller.id, name, "BOOL", { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

describe("undefined-tag rule", () => {
  it("flags a ladder operand with no matching tag", () => {
    const findings = createDefaultEngine().run(projectReferencing("Ghost", ["MotorRun"]));
    const undefinedFindings = findings.filter((f) => f.ruleId === "undefined-tag");
    expect(undefinedFindings.length).toBeGreaterThan(0);
    expect(undefinedFindings.some((f) => f.message.includes("Ghost"))).toBe(true);
  });

  it("passes when every operand tag is defined", () => {
    const findings = createDefaultEngine().run(
      projectReferencing("StartPB", ["StartPB", "MotorRun"]),
    );
    expect(findings.filter((f) => f.ruleId === "undefined-tag")).toHaveLength(0);
  });
});
