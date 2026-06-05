import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

function projectWithTargetMove(targetType: string) {
  const project = createProject("TargetMoves");
  const controller = createController(project.id, "TargetMovesCtl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("MVMT", [
        tagOperand("source", "Source"),
        tagOperand("mask", "Mask"),
        tagOperand("target", "Target"),
      ]),
    ]),
  );
  ladder.rungs.push(
    createRung(ladder.id, 1, [
      createNode("BTDT", [
        tagOperand("source", "Source"),
        tagOperand("sourceBit", "SourceBit"),
        tagOperand("length", "Length"),
        tagOperand("destBit", "DestBit"),
        tagOperand("target", "Target"),
      ]),
    ]),
  );
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  controller.controllerTags.push(createTag(controller.id, "Source", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "Mask", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "SourceBit", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "Length", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "DestBit", "DINT"));
  controller.controllerTags.push(createTag(controller.id, "Target", targetType));
  project.controllers.push(controller);
  return project;
}

describe("target-style move instruction validation", () => {
  it("validates BTDT/MVMT as executable target writes, not model-only review", () => {
    const findings = createDefaultEngine().run(projectWithTargetMove("DINT"));

    expect(findings.some((f) => f.ruleId === "unsupported-instruction" && /BTDT|MVMT/.test(f.message))).toBe(false);
    expect(findings.some((f) => f.ruleId === "model-only-instruction" && /BTDT|MVMT/.test(f.message))).toBe(false);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch" && /BTDT|MVMT/.test(f.message))).toBe(false);
  });

  it("checks BTDT/MVMT target operand types", () => {
    const findings = createDefaultEngine().run(projectWithTargetMove("STRING"));
    const text = findings.map((finding) => finding.message).join("\n");

    expect(text).toContain('MVMT operand "target" expects DINT/REAL, but tag "Target" is STRING.');
    expect(text).toContain('BTDT operand "target" expects DINT/REAL, but tag "Target" is STRING.');
  });
});
