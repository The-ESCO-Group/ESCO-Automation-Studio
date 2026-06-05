import { describe, expect, it } from "vitest";
import { createContinuousTask, createController, createProject } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithController() {
  const project = createProject("Redundant");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const redundancyFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((finding) => finding.ruleId === "redundancy-continuous-task");

describe("redundancy-continuous-task", () => {
  it("flags a continuous task when controller redundancy is enabled", () => {
    const { project, controller } = projectWithController();
    controller.redundancyInfo = { enabled: true };
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));

    const findings = redundancyFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      target: "Ctrl/MainTask",
    });
    expect(findings[0].message).toContain("redundancy is enabled");
    expect(findings[0].message).toContain("convert it to a PERIODIC task");
  });

  it("allows redundant controllers with only periodic or event tasks", () => {
    const { project, controller } = projectWithController();
    controller.redundancyInfo = { enabled: true };
    const periodic = createContinuousTask(controller.id, "PeriodicTask");
    periodic.type = "periodic";
    periodic.periodMs = 10;
    const event = createContinuousTask(controller.id, "EventTask");
    event.type = "event";
    controller.tasks.push(periodic, event);

    expect(redundancyFindings(project)).toHaveLength(0);
  });

  it("does not flag continuous tasks on non-redundant controllers", () => {
    const { project, controller } = projectWithController();
    controller.redundancyInfo = { enabled: false };
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));

    expect(redundancyFindings(project)).toHaveLength(0);
  });
});
