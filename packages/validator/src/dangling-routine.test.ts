import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createDefaultEngine } from "./index";

/**
 * Build a single-program project with a Main routine, returning the pieces a
 * test needs to point main/fault routine references at valid or dangling ids.
 */
function projectWithProgram() {
  const project = createProject("LineCtl");
  const controller = createController(project.id, "LineCtl");
  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "Main", "ladder");
  program.routines.push(main);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, program, main };
}

describe("dangling-routine-reference", () => {
  it("flags a main routine reference that resolves to no routine", () => {
    const { project, program } = projectWithProgram();
    program.mainRoutineId = "rtn-removed";
    const findings = createDefaultEngine().run(project);
    const dangling = findings.filter((f) => f.ruleId === "dangling-routine-reference");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].severity).toBe("error");
    expect(dangling[0].message).toContain("main routine");
    expect(dangling[0].target).toBe("LineCtl/MainProgram");
  });

  it("flags a dangling fault routine reference", () => {
    const { project, program, main } = projectWithProgram();
    program.mainRoutineId = main.id;
    program.faultRoutineId = "rtn-gone";
    const findings = createDefaultEngine().run(project);
    const dangling = findings.filter((f) => f.ruleId === "dangling-routine-reference");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain("fault routine");
  });

  it("does not flag references that resolve to existing routines", () => {
    const { project, program, main } = projectWithProgram();
    const fault = createRoutine(program.id, "FaultHandler", "ladder");
    program.routines.push(fault);
    program.mainRoutineId = main.id;
    program.faultRoutineId = fault.id;
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "dangling-routine-reference")).toBe(false);
  });

  it("leaves an absent main routine to the missing-main-routine rule", () => {
    const { project } = projectWithProgram();
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "dangling-routine-reference")).toBe(false);
    expect(findings.some((f) => f.ruleId === "missing-main-routine")).toBe(true);
  });
});
