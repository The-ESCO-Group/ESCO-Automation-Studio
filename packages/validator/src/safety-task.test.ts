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

const safetyFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "safety-task");

/** A PERIODIC safety task (createContinuousTask seeds the shared fields). */
function periodicSafetyTask(controllerId: string, name: string) {
  const task = createContinuousTask(controllerId, name);
  task.type = "periodic";
  task.periodMs = 10;
  task.safetyClass = "Safety";
  return task;
}

describe("safety-task", () => {
  it("does not flag a standard project with no safety task", () => {
    const { project, controller } = projectWithController();
    const standard = createContinuousTask(controller.id, "MainTask");
    standard.safetyClass = "Standard";
    controller.tasks.push(standard);
    expect(safetyFindings(project)).toHaveLength(0);
  });

  it("does not flag a single periodic safety task", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));
    expect(safetyFindings(project)).toHaveLength(0);
  });

  it("flags more than one safety task", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    controller.tasks.push(periodicSafetyTask(controller.id, "ExtraSafety"));
    const findings = safetyFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("2 safety tasks");
    expect(findings[0].message).toContain('"SafetyTask"');
    expect(findings[0].message).toContain('"ExtraSafety"');
    expect(findings[0].target).toBe("Ctrl");
  });

  it("flags a continuous safety task as not periodic", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "SafetyTask");
    task.safetyClass = "Safety";
    controller.tasks.push(task);
    const findings = safetyFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Safety task "SafetyTask" is a CONTINUOUS task');
    expect(findings[0].message).toContain("must be PERIODIC");
    expect(findings[0].target).toBe("Ctrl/SafetyTask");
  });

  it("flags an event safety task as not periodic", () => {
    const { project, controller } = projectWithController();
    const task = createContinuousTask(controller.id, "SafetyTask");
    task.type = "event";
    task.safetyClass = "Safety";
    controller.tasks.push(task);
    const findings = safetyFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("is a EVENT task");
  });
});
