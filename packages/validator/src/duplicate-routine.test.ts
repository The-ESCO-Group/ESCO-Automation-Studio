import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-program project, returning the program so tests can add routines. */
function projectWithProgram() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, program };
}

const routineFindings = (project: ReturnType<typeof projectWithProgram>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "duplicate-routine-name");

describe("duplicate-routine-name", () => {
  it("flags a program with two routines of the same name", () => {
    const { project, program } = projectWithProgram();
    program.routines.push(createRoutine(program.id, "Logic", "ladder"));
    program.routines.push(createRoutine(program.id, "Logic", "ladder"));
    const findings = routineFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('routine named "Logic"');
    expect(findings[0].target).toBe("Ctrl/MainProgram/Logic");
  });

  it("treats routine names as case-insensitive, matching Logix", () => {
    const { project, program } = projectWithProgram();
    program.routines.push(createRoutine(program.id, "Main", "ladder"));
    program.routines.push(createRoutine(program.id, "main", "ladder"));
    const findings = routineFindings(project);
    expect(findings).toHaveLength(1);
    // Reported with the spelling of the first occurrence.
    expect(findings[0].message).toContain('routine named "Main"');
  });

  it("reports each duplicated routine name only once", () => {
    const { project, program } = projectWithProgram();
    program.routines.push(createRoutine(program.id, "Logic", "ladder"));
    program.routines.push(createRoutine(program.id, "Logic", "ladder"));
    program.routines.push(createRoutine(program.id, "Logic", "ladder"));
    expect(routineFindings(project)).toHaveLength(1);
  });

  it("does not flag a routine name reused across different programs", () => {
    const { project, program } = projectWithProgram();
    program.routines.push(createRoutine(program.id, "Main", "ladder"));
    const other = createProgram(project.controllers[0].id, "SecondProgram");
    other.routines.push(createRoutine(other.id, "Main", "ladder"));
    project.controllers[0].programs.push(other);
    expect(routineFindings(project)).toHaveLength(0);
  });

  it("does not flag unique routine names", () => {
    const { project, program } = projectWithProgram();
    program.routines.push(createRoutine(program.id, "Main", "ladder"));
    program.routines.push(createRoutine(program.id, "Faults", "ladder"));
    expect(routineFindings(project)).toHaveLength(0);
  });
});
