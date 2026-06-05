import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  type Controller,
} from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithController() {
  const project = createProject("Capacity");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

function addPrograms(controller: Controller, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const program = createProgram(controller.id, `Program${i}`);
    controller.programs.push(program);
    ids.push(program.id);
  }
  return ids;
}

const capacityFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((finding) => finding.ruleId === "task-capacity");

describe("task-capacity", () => {
  it("accepts 32 tasks and flags the 33rd task", () => {
    const { project, controller } = projectWithController();
    for (let i = 0; i < 33; i += 1) {
      const task = createContinuousTask(controller.id, `Task${i}`);
      task.type = "periodic";
      task.periodMs = 10;
      task.priority = 10;
      controller.tasks.push(task);
    }

    const findings = capacityFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      target: "Ctrl",
    });
    expect(findings[0].message).toContain("33 tasks");
    expect(findings[0].message).toContain("at most 32 tasks");
  });

  it("flags a generic controller task with more than 32 scheduled programs", () => {
    const { project, controller } = projectWithController();
    const ids = addPrograms(controller, 33);
    const task = createContinuousTask(controller.id, "PeriodicTask", ids);
    task.type = "periodic";
    task.periodMs = 10;
    task.priority = 10;
    controller.tasks.push(task);

    const findings = capacityFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].target).toBe("Ctrl/PeriodicTask");
    expect(findings[0].message).toContain("schedules 33 programs");
    expect(findings[0].message).toContain("at most 32 scheduled programs");
  });

  it("allows ControlLogix tasks to schedule up to 1000 programs", () => {
    const { project, controller } = projectWithController();
    controller.catalogNumber = "1756-L85E";
    const ids = addPrograms(controller, 1000);
    const task = createContinuousTask(controller.id, "FastTask", ids);
    task.type = "periodic";
    task.periodMs = 10;
    task.priority = 10;
    controller.tasks.push(task);

    expect(capacityFindings(project)).toEqual([]);
  });

  it("flags ControlLogix tasks above the 1000-program limit", () => {
    const { project, controller } = projectWithController();
    controller.processorType = "ControlLogix 5580";
    const ids = addPrograms(controller, 1001);
    const task = createContinuousTask(controller.id, "BigTask", ids);
    task.type = "periodic";
    task.periodMs = 10;
    task.priority = 10;
    controller.tasks.push(task);

    const findings = capacityFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("schedules 1001 programs");
    expect(findings[0].message).toContain("at most 1000 scheduled programs");
  });

  it("counts distinct program ids so duplicate imported schedule rows do not inflate capacity", () => {
    const { project, controller } = projectWithController();
    const [id] = addPrograms(controller, 1);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", Array(40).fill(id)));

    expect(capacityFindings(project)).toEqual([]);
  });
});
