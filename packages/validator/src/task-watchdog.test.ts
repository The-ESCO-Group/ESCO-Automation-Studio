import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add tasks. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const watchdogFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "task-watchdog");

describe("task-watchdog", () => {
  it("does not flag a task with no watchdog set", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    expect(watchdogFindings(project)).toHaveLength(0);
  });

  it("does not flag a watchdog within the Logix range", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "MainTask");
    task.watchdogMs = 500;
    controller.tasks.push(task);
    expect(watchdogFindings(project)).toHaveLength(0);
  });

  it("accepts the range boundaries", () => {
    const { project, controller } = projectWithController();
    const low = createContinuousTask(controller.id, "LowTask");
    low.watchdogMs = 1;
    const high = createContinuousTask(controller.id, "HighTask");
    high.type = "periodic";
    high.periodMs = 10;
    high.watchdogMs = 2_000_000;
    controller.tasks.push(low, high);
    expect(watchdogFindings(project)).toHaveLength(0);
  });

  it("flags a watchdog below the Logix minimum", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "MainTask");
    task.watchdogMs = 0.5;
    controller.tasks.push(task);
    const findings = watchdogFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("watchdog timeout of 0.5 ms");
    expect(findings[0].message).toContain("between 1 and 2000000 ms");
    expect(findings[0].target).toBe("Ctrl/MainTask");
  });

  it("flags a watchdog above the Logix maximum", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "PeriodicTask");
    task.type = "periodic";
    task.periodMs = 10;
    task.watchdogMs = 3_000_000;
    controller.tasks.push(task);
    const findings = watchdogFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("watchdog timeout of 3000000 ms");
  });
});
