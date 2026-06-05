import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller for tasks/programs. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const danglingFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "dangling-scheduled-program");

describe("dangling-scheduled-program", () => {
  it("flags a task scheduling a program id that no longer exists", () => {
    const { project, controller } = projectWithController();
    // The task references a program id that is never added to the controller —
    // e.g. the program was deleted by an offline edit after the task was built.
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", ["prog-removed"]));
    const findings = danglingFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("does not exist");
    expect(findings[0].target).toBe("Ctrl/MainTask");
  });

  it("does not flag a task scheduling an existing program", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    expect(danglingFindings(project)).toHaveLength(0);
  });

  it("flags each dangling entry, leaving the valid one alone", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(
      createContinuousTask(controller.id, "MainTask", [program.id, "prog-gone"]),
    );
    const findings = danglingFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("MainTask");
  });
});
