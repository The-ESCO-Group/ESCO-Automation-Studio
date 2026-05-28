import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  createLadderRoutine,
  createNode,
  createRung,
  tagOperand,
  type LadderNode,
} from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A one-controller project whose MainRoutine contains the given nodes + typed tags. */
function projectWithNodes(nodes: LadderNode[], tags: { name: string; type: string }[]): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, nodes));
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const tag of tags) {
    controller.controllerTags.push(createTag(controller.id, tag.name, tag.type, { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

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

describe("operand validation for the new instructions", () => {
  it("flags a missing required operand", () => {
    // TON with only the timer operand — preset is missing.
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "Timer1")])],
      [{ name: "Timer1", type: "TIMER" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "missing-operand")).toBe(true);
  });

  it("flags an operand whose tag has the wrong data type", () => {
    // TON's timer operand points at a BOOL tag instead of a TIMER.
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "NotATimer"), tagOperand("preset", "3000")])],
      [{ name: "NotATimer", type: "BOOL" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(true);
  });

  it("accepts a correctly typed TON with a numeric preset literal", () => {
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "Timer1"), tagOperand("preset", "3000")])],
      [{ name: "Timer1", type: "TIMER" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.filter((f) => f.ruleId === "operand-type-mismatch")).toHaveLength(0);
    expect(findings.filter((f) => f.ruleId === "undefined-tag")).toHaveLength(0);
    expect(findings.filter((f) => f.ruleId === "missing-operand")).toHaveLength(0);
  });
});
