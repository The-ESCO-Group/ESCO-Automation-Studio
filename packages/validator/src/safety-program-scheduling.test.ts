import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add tasks/programs. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const findingsFor = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "safety-program-scheduling");

/** A PERIODIC safety task (createContinuousTask seeds the shared fields). */
function periodicSafetyTask(controllerId: string, name: string, scheduledProgramIds: string[] = []) {
  const task = createContinuousTask(controllerId, name, scheduledProgramIds);
  task.type = "periodic";
  task.periodMs = 10;
  task.safetyClass = "Safety";
  return task;
}

describe("safety-program-scheduling", () => {
  it("does not flag a standard project with no safety task", () => {
    const { project, controller } = projectWithController();
    const prog = createProgram(controller.id, "MainProgram");
    controller.programs.push(prog);
    const task = createContinuousTask(controller.id, "MainTask", [prog.id]);
    task.safetyClass = "Standard";
    controller.tasks.push(task);
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("does not flag a correctly partitioned GuardLogix project", () => {
    const { project, controller } = projectWithController();
    const safetyProg = createProgram(controller.id, "SafetyProgram");
    safetyProg.safetyClass = "Safety";
    const standardProg = createProgram(controller.id, "StandardProgram");
    standardProg.safetyClass = "Standard";
    controller.programs.push(safetyProg, standardProg);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask", [safetyProg.id]));
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [standardProg.id]));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("flags a standard program scheduled under the safety task", () => {
    const { project, controller } = projectWithController();
    const standardProg = createProgram(controller.id, "StandardProgram");
    standardProg.safetyClass = "Standard";
    controller.programs.push(standardProg);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask", [standardProg.id]));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Program "StandardProgram"');
    expect(findings[0].message).toContain('safety task "SafetyTask"');
    expect(findings[0].message).toContain("only safety programs");
    expect(findings[0].target).toBe("Ctrl/StandardProgram");
  });

  it("flags a program with no Class scheduled under the safety task", () => {
    const { project, controller } = projectWithController();
    const prog = createProgram(controller.id, "Untagged");
    controller.programs.push(prog);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask", [prog.id]));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("is not a safety program");
  });

  it("flags a safety program scheduled under a standard task", () => {
    const { project, controller } = projectWithController();
    const safetyProg = createProgram(controller.id, "SafetyProgram");
    safetyProg.safetyClass = "Safety";
    controller.programs.push(safetyProg);
    // A safety task must exist for the project to count as GuardLogix.
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [safetyProg.id]));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Safety program "SafetyProgram"');
    expect(findings[0].message).toContain('standard task "MainTask"');
    expect(findings[0].target).toBe("Ctrl/SafetyProgram");
  });

  it("ignores a dangling scheduled id (left to dangling-scheduled-program)", () => {
    const { project, controller } = projectWithController();
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask", ["prog-does-not-exist"]));
    expect(findingsFor(project)).toHaveLength(0);
  });
});
