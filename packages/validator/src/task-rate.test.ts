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

const rateFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "task-rate");

describe("task-rate", () => {
  it("does not flag a continuous task with no rate", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    expect(rateFindings(project)).toHaveLength(0);
  });

  it("does not flag a periodic task with a valid rate and priority", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.periodMs = 10;
    task.priority = 10;
    controller.tasks.push(task);
    expect(rateFindings(project)).toHaveLength(0);
  });

  it("flags a periodic task with no scan rate", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    controller.tasks.push(task);
    const findings = rateFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("has no scan rate");
    expect(findings[0].target).toBe("Ctrl/PeriodicTask");
  });

  it("flags a periodic task with a zero rate", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.periodMs = 0;
    controller.tasks.push(task);
    const findings = rateFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("has no scan rate");
  });

  it("flags a rate above the Logix maximum", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.periodMs = 3_000_000;
    controller.tasks.push(task);
    const findings = rateFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("scan rate of 3000000 ms");
    expect(findings[0].message).toContain("between 0.1 and 2000000 ms");
  });

  it("flags a priority outside the 1-15 range", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.periodMs = 20;
    task.priority = 20;
    controller.tasks.push(task);
    const findings = rateFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("priority 20");
    expect(findings[0].message).toContain("between 1 and 15");
  });

  it("flags both a missing rate and a bad priority on one task", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.priority = 0;
    controller.tasks.push(task);
    const findings = rateFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.message.includes("has no scan rate"))).toBe(true);
    expect(findings.some((f) => f.message.includes("priority 0"))).toBe(true);
  });
});
