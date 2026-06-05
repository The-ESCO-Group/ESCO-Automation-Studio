import { describe, expect, it } from "vitest";
import { createContinuousTask, createController, createProject, type Task } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add tasks. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

/** An EVENT task (the factory only mints continuous tasks) with optional event info. */
function eventTask(controllerId: string, name: string): Task {
  const task = createContinuousTask(controllerId, name);
  task.type = "event";
  task.eventInfo = { eventTrigger: "EVENT Instruction Only" };
  return task;
}

const timeoutFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "event-task-timeout");

describe("event-task-timeout", () => {
  it("flags an EVENT task with the timeout enabled but no rate", () => {
    const { project, controller } = projectWithController();
    const task = eventTask(controller.id, "Sequencer");
    task.eventInfo!.enableTimeout = true;
    controller.tasks.push(task);
    const findings = timeoutFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('EVENT task "Sequencer"');
    expect(findings[0].message).toContain("EnableTimeout is set");
    expect(findings[0].target).toBe("Ctrl/Sequencer");
  });

  it("flags an EVENT task with the timeout enabled and a non-positive rate", () => {
    const { project, controller } = projectWithController();
    const task = eventTask(controller.id, "Sequencer");
    task.eventInfo!.enableTimeout = true;
    task.periodMs = 0;
    controller.tasks.push(task);
    expect(timeoutFindings(project)).toHaveLength(1);
  });

  it("does not flag an EVENT task with the timeout enabled and a positive rate", () => {
    const { project, controller } = projectWithController();
    const task = eventTask(controller.id, "Sequencer");
    task.eventInfo!.enableTimeout = true;
    task.periodMs = 50;
    controller.tasks.push(task);
    expect(timeoutFindings(project)).toHaveLength(0);
  });

  it("does not flag an EVENT task whose timeout is disabled, even without a rate", () => {
    const { project, controller } = projectWithController();
    const task = eventTask(controller.id, "Sequencer");
    task.eventInfo!.enableTimeout = false;
    controller.tasks.push(task);
    expect(timeoutFindings(project)).toHaveLength(0);
  });

  it("does not flag a PERIODIC task missing a rate (task-rate's province, not this rule)", () => {
    const { project, controller } = projectWithController();
    const periodic = createContinuousTask(controller.id, "PeriodicTask");
    periodic.type = "periodic";
    controller.tasks.push(periodic);
    expect(timeoutFindings(project)).toHaveLength(0);
  });
});
