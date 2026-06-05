import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createTag,
  type PlcProject,
  type ProgramParameter,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller, single-program project; callers populate parameters/tags. */
function projectWithProgram() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "Main");
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, controller, program };
}

const param = (name: string): ProgramParameter => ({ name, dataType: "DINT", usage: "Input" });

const findings = (project: PlcProject) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "duplicate-program-parameter");

describe("duplicate-program-parameter", () => {
  it("does not flag distinct parameter names that do not collide with program tags", () => {
    const { project, program, controller } = projectWithProgram();
    program.parameters = [param("Setpoint"), param("Feedback")];
    program.programTags.push(createTag(controller.id, "Working", "DINT", { scope: "program", programId: program.id }));
    expect(findings(project)).toHaveLength(0);
  });

  it("flags two parameters declared with the same name", () => {
    const { project, program } = projectWithProgram();
    program.parameters = [param("Speed"), param("Speed")];
    const result = findings(project);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toContain("Duplicate program parameter");
    expect(result[0].message).toContain('"Speed"');
    expect(result[0].target).toBe("Ctrl/Main/Speed");
  });

  it("flags a parameter that collides with a program tag of the same name", () => {
    const { project, program, controller } = projectWithProgram();
    program.parameters = [param("Level")];
    program.programTags.push(createTag(controller.id, "Level", "REAL", { scope: "program", programId: program.id }));
    const result = findings(project);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("collides with a program tag");
    expect(result[0].target).toBe("Ctrl/Main/Level");
  });

  it("treats names differing only in case as a collision (Logix is case-insensitive)", () => {
    const { project, program } = projectWithProgram();
    program.parameters = [param("Speed"), param("SPEED")];
    expect(findings(project)).toHaveLength(1);
  });

  it("reports a clashing parameter name once even when it repeats three times", () => {
    const { project, program } = projectWithProgram();
    program.parameters = [param("Cmd"), param("Cmd"), param("Cmd")];
    expect(findings(project)).toHaveLength(1);
  });

  it("leaves pure tag-vs-tag duplicates to duplicate-program-tag (no parameter involved)", () => {
    const { project, program, controller } = projectWithProgram();
    program.parameters = [];
    program.programTags.push(
      createTag(controller.id, "Dup", "DINT", { scope: "program", programId: program.id }),
      createTag(controller.id, "Dup", "DINT", { scope: "program", programId: program.id }),
    );
    expect(findings(project)).toHaveLength(0);
  });

  it("ignores a program with no parameters", () => {
    const { project } = projectWithProgram();
    expect(findings(project)).toHaveLength(0);
  });
});
