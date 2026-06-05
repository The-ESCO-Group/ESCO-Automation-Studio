import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add programs/tasks. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const taskFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "task-scheduling");

describe("task-scheduling", () => {
  it("does not flag a single continuous task scheduling its program", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    expect(taskFindings(project)).toHaveLength(0);
  });

  it("flags a second continuous task as an error", () => {
    const { project, controller } = projectWithController();
    const a = createProgram(controller.id, "ProgA");
    const b = createProgram(controller.id, "ProgB");
    controller.programs.push(a, b);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [a.id]));
    controller.tasks.push(createContinuousTask(controller.id, "ExtraTask", [b.id]));
    const errors = taskFindings(project).filter((f) => f.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("more than one continuous task");
    expect(errors[0].message).toContain('"MainTask"');
    expect(errors[0].message).toContain('"ExtraTask"');
    expect(errors[0].target).toBe("Ctrl/ExtraTask");
  });

  it("flags a program scheduled under more than one task", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "Shared");
    controller.programs.push(program);
    const periodic = createContinuousTask(controller.id, "PeriodicTask", [program.id]);
    periodic.type = "periodic";
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    controller.tasks.push(periodic);
    const findings = taskFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("more than one task");
    expect(findings[0].message).toContain('"MainTask"');
    expect(findings[0].message).toContain('"PeriodicTask"');
    expect(findings[0].target).toBe("Ctrl/Shared");
  });

  it("warns about a program scheduled under no task", () => {
    const { project, controller } = projectWithController();
    const scheduled = createProgram(controller.id, "Runs");
    const orphan = createProgram(controller.id, "NeverRuns");
    controller.programs.push(scheduled, orphan);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [scheduled.id]));
    const findings = taskFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain('"NeverRuns"');
    expect(findings[0].message).toContain("not scheduled under any task");
    expect(findings[0].target).toBe("Ctrl/NeverRuns");
  });

  it("treats a program scheduled under an inhibited task as scheduled", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    const task = createContinuousTask(controller.id, "MainTask", [program.id]);
    task.inhibited = true;
    controller.tasks.push(task);
    expect(taskFindings(project)).toHaveLength(0);
  });

  it("does not flag the same program listed twice within one task", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(
      createContinuousTask(controller.id, "MainTask", [program.id, program.id]),
    );
    expect(taskFindings(project)).toHaveLength(0);
  });
});
