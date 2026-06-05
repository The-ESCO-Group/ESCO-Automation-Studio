import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * A project whose Main routine runs the given nodes. The supplied tags are
 * placed in controller scope so the rule can resolve them; mutate the returned
 * controller's tags before running when program-scope coverage is needed.
 */
function projectWithNodes(
  tags: ReturnType<typeof createTag>[],
  ...nodes: ReturnType<typeof createNode>[]
) {
  const project = createProject("ConstCtl");
  const controller = createController(project.id, "ConstCtl");
  controller.controllerTags.push(...tags);
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  nodes.forEach((node, i) => ladder.rungs.push(createRung(ladder.id, i, [node])));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, controller, program };
}

const constantFindings = (project: ReturnType<typeof projectWithNodes>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "constant-tag-modified");

function constant(controllerId: string, name: string, dataType = "DINT") {
  const tag = createTag(controllerId, name, dataType);
  tag.constant = true;
  return tag;
}

describe("an instruction may not write to a constant tag", () => {
  it("flags a MOV destination that is a constant tag", () => {
    const ctlId = "ctl";
    const { project } = projectWithNodes(
      [createTag(ctlId, "Source", "DINT"), constant(ctlId, "Setpoint")],
      createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "Setpoint")]),
    );
    const findings = constantFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("MOV");
    expect(findings[0]!.message).toContain('constant tag "Setpoint"');
  });

  it("does not flag reading a constant tag as a source operand", () => {
    const ctlId = "ctl";
    const { project } = projectWithNodes(
      [constant(ctlId, "Setpoint"), createTag(ctlId, "Dest", "DINT")],
      createNode("MOV", [tagOperand("source", "Setpoint"), tagOperand("dest", "Dest")]),
    );
    expect(constantFindings(project)).toEqual([]);
  });

  it("flags writing to a member or element of a constant tag", () => {
    const ctlId = "ctl";
    const limits = constant(ctlId, "Limits", "DINT");
    limits.dimensions = [4];
    limits.dimension = 4;
    const { project } = projectWithNodes(
      [createTag(ctlId, "Source", "DINT"), limits],
      createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "Limits[0]")]),
    );
    const findings = constantFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('constant tag "Limits"');
  });

  it("flags an OTE coil driving a constant BOOL tag", () => {
    const ctlId = "ctl";
    const { project } = projectWithNodes(
      [constant(ctlId, "Enable", "BOOL")],
      createNode("OTE", [tagOperand("tag", "Enable")]),
    );
    expect(constantFindings(project)).toHaveLength(1);
  });

  it("flags writing through an alias that resolves to a constant tag", () => {
    const ctlId = "ctl";
    const setpoint = constant(ctlId, "Setpoint");
    const alias = createTag(ctlId, "SP", "DINT");
    alias.aliasFor = "Setpoint";
    const { project } = projectWithNodes(
      [createTag(ctlId, "Source", "DINT"), setpoint, alias],
      createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "SP")]),
    );
    const findings = constantFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('alias of constant tag "Setpoint"');
  });

  it("does not flag writing to an ordinary (non-constant) tag", () => {
    const ctlId = "ctl";
    const { project } = projectWithNodes(
      [createTag(ctlId, "Source", "DINT"), createTag(ctlId, "Dest", "DINT")],
      createNode("MOV", [tagOperand("source", "Source"), tagOperand("dest", "Dest")]),
    );
    expect(constantFindings(project)).toEqual([]);
  });
});
