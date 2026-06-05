import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A project whose Main routine runs the given nodes, with Source/Dest defined. */
function projectWithNodes(...nodes: ReturnType<typeof createNode>[]) {
  const project = createProject("WriteCtl");
  const controller = createController(project.id, "WriteCtl");
  controller.controllerTags.push(createTag(controller.id, "Source", "DINT", { value: 0 }));
  controller.controllerTags.push(createTag(controller.id, "Dest", "DINT", { value: 0 }));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  nodes.forEach((node, i) => ladder.rungs.push(createRung(ladder.id, i, [node])));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const writeTargetFindings = (project: ReturnType<typeof projectWithNodes>) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "invalid-write-target");

describe("a write-destination operand must be a tag, not a numeric literal", () => {
  it("flags a numeric literal in a MOV destination", () => {
    const findings = writeTargetFindings(
      projectWithNodes(createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "5")])),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("MOV");
    expect(findings[0]!.message).toContain('"dest"');
    expect(findings[0]!.message).toContain('"5"');
  });

  it("flags a radix literal in an ADD destination", () => {
    const findings = writeTargetFindings(
      projectWithNodes(
        createNode("ADD", [tagOperand("sourceA", "Source"), tagOperand("sourceB", "1"), tagOperand("dest", "16#FF")]),
      ),
    );
    expect(findings.some((f) => f.message.includes("ADD") && f.message.includes('"16#FF"'))).toBe(true);
  });

  it("does not flag a numeric literal in a read (source) operand", () => {
    // MOV(123, Dest): the literal source is a constant; only the destination must be a tag.
    expect(
      writeTargetFindings(
        projectWithNodes(createNode("MOV", [tagOperand("source", "123"), tagOperand("dest", "Dest")])),
      ),
    ).toEqual([]);
  });

  it("does not flag a tag destination", () => {
    expect(
      writeTargetFindings(
        projectWithNodes(createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "Dest")])),
      ),
    ).toEqual([]);
  });
});
