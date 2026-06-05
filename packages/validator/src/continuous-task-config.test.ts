import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
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

const configFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "continuous-task-config");

describe("continuous-task-config", () => {
  it("does not flag a continuous task that leaves output processing enabled", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));
    expect(configFindings(project)).toHaveLength(0);
  });

  it("does not flag a continuous task with the flag explicitly false", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "MainTask");
    task.disableUpdateOutputs = false;
    controller.tasks.push(task);
    expect(configFindings(project)).toHaveLength(0);
  });

  it("flags a continuous task that disables output processing", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "MainTask");
    task.disableUpdateOutputs = true;
    controller.tasks.push(task);
    const findings = configFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Continuous task "MainTask"');
    expect(findings[0].message).toContain("DisableUpdateOutputs is valid only on PERIODIC or EVENT tasks");
    expect(findings[0].target).toBe("Ctrl/MainTask");
  });

  it("does not flag a periodic or event task that disables output processing", () => {
    const { project, controller } = projectWithController();
    const periodic = createContinuousTask(controller.id, "PeriodicTask");
    periodic.type = "periodic";
    periodic.periodMs = 10;
    periodic.disableUpdateOutputs = true;
    const event = createContinuousTask(controller.id, "EventTask");
    event.type = "event";
    event.disableUpdateOutputs = true;
    controller.tasks.push(periodic, event);
    expect(configFindings(project)).toHaveLength(0);
  });
});
