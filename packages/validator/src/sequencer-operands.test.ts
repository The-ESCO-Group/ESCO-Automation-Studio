import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

function projectWithSqc(controlType: string) {
  const project = createProject("Sequencer");
  const controller = createController(project.id, "SequencerCtl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("SQC", [
        tagOperand("array", "Seq"),
        tagOperand("mask", "Mask"),
        tagOperand("source", "Inputs"),
        tagOperand("control", "Ctl"),
        tagOperand("length", "4"),
      ]),
    ]),
  );
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  controller.controllerTags.push(createTag(controller.id, "Seq", "DINT", { dimensions: [8] }));
  controller.controllerTags.push(createTag(controller.id, "Mask", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "Inputs", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "Ctl", controlType));
  project.controllers.push(controller);
  return project;
}

describe("sequencer operand validation", () => {
  it("validates SQC as executable sequencer logic, not model-only review", () => {
    const findings = createDefaultEngine().run(projectWithSqc("CONTROL"));

    expect(findings.some((f) => f.ruleId === "model-only-instruction" && f.message.includes("SQC"))).toBe(false);
    expect(findings.some((f) => f.ruleId === "unsupported-instruction" && f.message.includes("SQC"))).toBe(false);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch" && f.message.includes("SQC"))).toBe(false);
  });

  it("checks SQC's CONTROL operand type", () => {
    const findings = createDefaultEngine().run(projectWithSqc("DINT"));

    expect(findings.some((f) =>
      f.ruleId === "operand-type-mismatch" &&
      f.message.includes('SQC operand "control" expects CONTROL') &&
      f.message.includes('"Ctl" is DINT'),
    )).toBe(true);
  });
});
