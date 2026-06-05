import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createTag,
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
    .filter((f) => f.ruleId === "safety-tag-partition");

/** A PERIODIC safety task — its presence marks the project as GuardLogix. */
function periodicSafetyTask(controllerId: string, name: string) {
  const task = createContinuousTask(controllerId, name, []);
  task.type = "periodic";
  task.periodMs = 10;
  task.safetyClass = "Safety";
  return task;
}

/** A program-scoped tag carrying an explicit safety class. */
function programTag(controllerId: string, programId: string, name: string, safetyClass: string) {
  const tag = createTag(controllerId, name, "BOOL", { scope: "program", programId });
  tag.safetyClass = safetyClass;
  return tag;
}

describe("safety-tag-partition", () => {
  it("does not flag a standard project with no safety task", () => {
    const { project, controller } = projectWithController();
    const prog = createProgram(controller.id, "MainProgram");
    // Even a class-mismatched tag is ignored without a safety task on the controller.
    prog.safetyClass = "Standard";
    prog.programTags.push(programTag(controller.id, prog.id, "Mismatch", "Safety"));
    controller.programs.push(prog);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [prog.id]));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("does not flag a correctly partitioned GuardLogix project", () => {
    const { project, controller } = projectWithController();
    const safetyProg = createProgram(controller.id, "SafetyProgram");
    safetyProg.safetyClass = "Safety";
    safetyProg.programTags.push(programTag(controller.id, safetyProg.id, "EStop", "Safety"));
    const standardProg = createProgram(controller.id, "StandardProgram");
    standardProg.safetyClass = "Standard";
    standardProg.programTags.push(programTag(controller.id, standardProg.id, "MotorRun", "Standard"));
    controller.programs.push(safetyProg, standardProg);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("flags a standard tag scoped to a safety program", () => {
    const { project, controller } = projectWithController();
    const safetyProg = createProgram(controller.id, "SafetyProgram");
    safetyProg.safetyClass = "Safety";
    safetyProg.programTags.push(programTag(controller.id, safetyProg.id, "Stray", "Standard"));
    controller.programs.push(safetyProg);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Standard tag "Stray"');
    expect(findings[0].message).toContain('safety program "SafetyProgram"');
    expect(findings[0].message).toContain("only safety tags");
    expect(findings[0].target).toBe("Ctrl/SafetyProgram/Stray");
  });

  it("flags a safety tag scoped to a standard program", () => {
    const { project, controller } = projectWithController();
    const standardProg = createProgram(controller.id, "StandardProgram");
    standardProg.safetyClass = "Standard";
    standardProg.programTags.push(programTag(controller.id, standardProg.id, "EStop", "Safety"));
    controller.programs.push(standardProg);
    // A safety task must exist for the project to count as GuardLogix.
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Safety tag "EStop"');
    expect(findings[0].message).toContain('standard program "StandardProgram"');
    expect(findings[0].target).toBe("Ctrl/StandardProgram/EStop");
  });

  it("ignores a program tag with no explicit class (partition implied)", () => {
    const { project, controller } = projectWithController();
    const safetyProg = createProgram(controller.id, "SafetyProgram");
    safetyProg.safetyClass = "Safety";
    // No safetyClass on the tag -> the scope's partition is implied, not a mismatch.
    safetyProg.programTags.push(createTag(controller.id, "Plain", "BOOL", { scope: "program", programId: safetyProg.id }));
    controller.programs.push(safetyProg);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("ignores a program with no explicit class", () => {
    const { project, controller } = projectWithController();
    const prog = createProgram(controller.id, "Untagged");
    // Program carries no class -> its partition is implied; tags are not compared.
    prog.programTags.push(programTag(controller.id, prog.id, "EStop", "Safety"));
    controller.programs.push(prog);
    controller.tasks.push(periodicSafetyTask(controller.id, "SafetyTask"));
    expect(findingsFor(project)).toHaveLength(0);
  });
});
