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

/** An EVENT task with the given trigger info (createContinuousTask seeds the shared fields). */
function eventTask(controllerId: string, name: string, eventInfo?: Task["eventInfo"]): Task {
  const task = createContinuousTask(controllerId, name);
  task.type = "event";
  if (eventInfo) task.eventInfo = eventInfo;
  return task;
}

const triggerFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "event-task-trigger");

describe("event-task-trigger", () => {
  it("does not flag an EVENT task whose tag-driven trigger binds a tag", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(
      eventTask(controller.id, "EvtTask", {
        eventTrigger: "Consumed Tag Connection",
        eventTag: "RemoteData",
      }),
    );
    expect(triggerFindings(project)).toHaveLength(0);
  });

  it("does not flag an instruction-only trigger that carries no tag", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(
      eventTask(controller.id, "EvtTask", { eventTrigger: "EVENT Instruction Only" }),
    );
    expect(triggerFindings(project)).toHaveLength(0);
  });

  it("flags an EVENT task with no trigger configured", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(eventTask(controller.id, "EvtTask"));
    const findings = triggerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("no trigger configured");
    expect(findings[0].target).toBe("Ctrl/EvtTask");
  });

  it("treats a blank/whitespace trigger as no trigger", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(eventTask(controller.id, "EvtTask", { eventTrigger: "   " }));
    const findings = triggerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("no trigger configured");
  });

  it("flags a tag-driven trigger that specifies no tag", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(
      eventTask(controller.id, "EvtTask", { eventTrigger: "Module Input Data State Change" }),
    );
    const findings = triggerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("specifies no tag");
    expect(findings[0].message).toContain("Module Input Data State Change");
    expect(findings[0].target).toBe("Ctrl/EvtTask");
  });

  it("does not flag PERIODIC or CONTINUOUS tasks that omit a trigger", () => {
    const { project, controller } = projectWithController();
    const periodic = createContinuousTask(controller.id, "PeriodicTask");
    periodic.type = "periodic";
    periodic.periodMs = 10;
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));
    controller.tasks.push(periodic);
    expect(triggerFindings(project)).toHaveLength(0);
  });
});
