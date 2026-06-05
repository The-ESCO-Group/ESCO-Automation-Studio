import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

function projectWithFileMode(type: "FAL" | "FSC", mode: string) {
  const project = createProject("FileModes");
  const controller = createController(project.id, "FileModes");
  controller.controllerTags.push(
    createTag(controller.id, "Ctl", "CONTROL"),
    createTag(controller.id, "Pos", "DINT", { value: 0 }),
    createTag(controller.id, "ModeCount", "DINT", { value: 2 }),
    createTag(controller.id, "ModeText", "STRING", { value: "ALL" }),
    createTag(controller.id, "Src", "DINT", { dimensions: [4] }),
    createTag(controller.id, "Dest", "DINT", { dimensions: [4] }),
    createTag(controller.id, "Target", "DINT", { value: 3 }),
  );
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  const operands =
    type === "FAL"
      ? [
          tagOperand("control", "Ctl"),
          tagOperand("length", "4"),
          tagOperand("position", "Pos"),
          tagOperand("mode", mode),
          tagOperand("expression", "Src[Ctl.POS] + 1"),
          tagOperand("dest", "Dest[Ctl.POS]"),
        ]
      : [
          tagOperand("control", "Ctl"),
          tagOperand("length", "4"),
          tagOperand("position", "Pos"),
          tagOperand("mode", mode),
          tagOperand("expression", "Src[Ctl.POS] = Target"),
        ];
  ladder.rungs.push(createRung(ladder.id, 0, [createNode(type, operands)]));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function fileModeFindings(type: "FAL" | "FSC", mode: string) {
  return createDefaultEngine()
    .run(projectWithFileMode(type, mode))
    .filter((finding) => ["undefined-tag", "operand-type-mismatch"].includes(finding.ruleId));
}

describe("FAL/FSC mode operand validation", () => {
  it.each(["ALL", "INC", "2", "ModeCount"])("accepts FAL mode %s", (mode) => {
    expect(fileModeFindings("FAL", mode)).toEqual([]);
  });

  it.each(["ALL", "INC", "2", "ModeCount"])("accepts FSC mode %s", (mode) => {
    expect(fileModeFindings("FSC", mode)).toEqual([]);
  });

  it("flags undefined FAL/FSC mode tags instead of treating them as labels", () => {
    for (const type of ["FAL", "FSC"] as const) {
      const findings = fileModeFindings(type, "MissingMode");
      expect(findings.some((finding) => finding.ruleId === "undefined-tag" && finding.message.includes("MissingMode"))).toBe(true);
    }
  });

  it("flags non-numeric FAL/FSC mode tags", () => {
    for (const type of ["FAL", "FSC"] as const) {
      const findings = fileModeFindings(type, "ModeText");
      expect(
        findings.some(
          (finding) =>
            finding.ruleId === "operand-type-mismatch" &&
            finding.message.includes(type) &&
            finding.message.includes("ModeText") &&
            finding.message.includes("STRING"),
        ),
      ).toBe(true);
    }
  });
});
