import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add programs. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const programFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "duplicate-program-name");

describe("duplicate-program-name", () => {
  it("flags a controller with two programs of the same name", () => {
    const { project, controller } = projectWithController();
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    const findings = programFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('program named "Conveyor"');
    expect(findings[0].target).toBe("Ctrl/Conveyor");
  });

  it("treats program names as case-insensitive, matching Logix", () => {
    const { project, controller } = projectWithController();
    controller.programs.push(createProgram(controller.id, "MainProgram"));
    controller.programs.push(createProgram(controller.id, "mainprogram"));
    const findings = programFindings(project);
    expect(findings).toHaveLength(1);
    // Reported with the spelling of the first occurrence.
    expect(findings[0].message).toContain('program named "MainProgram"');
  });

  it("reports each duplicated program name only once", () => {
    const { project, controller } = projectWithController();
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    expect(programFindings(project)).toHaveLength(1);
  });

  it("does not flag a program name reused across different controllers", () => {
    const { project, controller } = projectWithController();
    controller.programs.push(createProgram(controller.id, "MainProgram"));
    const other = createController(project.id, "Ctrl2");
    other.programs.push(createProgram(other.id, "MainProgram"));
    project.controllers.push(other);
    expect(programFindings(project)).toHaveLength(0);
  });

  it("does not flag unique program names", () => {
    const { project, controller } = projectWithController();
    controller.programs.push(createProgram(controller.id, "MainProgram"));
    controller.programs.push(createProgram(controller.id, "Conveyor"));
    expect(programFindings(project)).toHaveLength(0);
  });
});
