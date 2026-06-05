import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  type PlcProject,
} from "@esco/core";
import { setControllerProperties, setProgramProperties, setTaskProperties } from "./index";

interface Fixture {
  project: PlcProject;
  controllerId: string;
  programAId: string;
  programBId: string;
  taskAId: string;
  taskBId: string;
}

/** A controller with two programs (Alpha/Beta) and two tasks (TaskA/TaskB). */
function fixture(): Fixture {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const programA = createProgram(controller.id, "Alpha");
  const programB = createProgram(controller.id, "Beta");
  const taskA = createContinuousTask(controller.id, "TaskA", [programA.id]);
  const taskB = createContinuousTask(controller.id, "TaskB", [programB.id]);
  controller.programs.push(programA, programB);
  controller.tasks.push(taskA, taskB);
  project.controllers.push(controller);

  return {
    project,
    controllerId: controller.id,
    programAId: programA.id,
    programBId: programB.id,
    taskAId: taskA.id,
    taskBId: taskB.id,
  };
}

describe("setProgramProperties: name validation", () => {
  it("rejects renaming a program onto a sibling's name", () => {
    const f = fixture();
    const result = setProgramProperties(f.project, { programId: f.programAId, name: "Beta" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
    expect(result.project).toBe(f.project);
  });

  it("rejects an invalid (non-identifier) program name", () => {
    const f = fixture();
    const result = setProgramProperties(f.project, { programId: f.programAId, name: "Bad Name" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid program name");
  });

  it("rejects program names that Studio 5000 rejects at edit time", () => {
    const f = fixture();
    const cases = [
      ["Program_", /must not end with an underscore/],
      ["Program__Gap", /consecutive underscores/],
      ["P".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = setProgramProperties(f.project, { programId: f.programAId, name });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
  });

  it("allows a unique rename and treats rename-to-self as valid", () => {
    const f = fixture();
    const renamed = setProgramProperties(f.project, { programId: f.programAId, name: "Gamma" });
    expect(renamed.ok).toBe(true);
    expect(renamed.project.controllers[0]!.programs[0]!.name).toBe("Gamma");

    const sameName = setProgramProperties(f.project, { programId: f.programAId, name: "Alpha" });
    expect(sameName.ok).toBe(true);
  });
});

describe("setControllerProperties: name validation", () => {
  it("rejects controller names that Studio 5000 rejects at edit time", () => {
    const f = fixture();
    const cases = [
      ["Controller_", /must not end with an underscore/],
      ["Controller__Gap", /consecutive underscores/],
      ["C".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = setControllerProperties(f.project, { controllerId: f.controllerId, name });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
  });
});

describe("setTaskProperties: name validation", () => {
  it("rejects renaming a task onto a sibling's name", () => {
    const f = fixture();
    const result = setTaskProperties(f.project, {
      taskId: f.taskAId,
      name: "TaskB",
      type: "continuous",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
    expect(result.project).toBe(f.project);
  });

  it("rejects an invalid (non-identifier) task name", () => {
    const f = fixture();
    const result = setTaskProperties(f.project, {
      taskId: f.taskAId,
      name: "1Task",
      type: "continuous",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid task name");
  });

  it("rejects task names that Studio 5000 rejects at edit time", () => {
    const f = fixture();
    const cases = [
      ["Task_", /must not end with an underscore/],
      ["Task__Gap", /consecutive underscores/],
      ["T".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = setTaskProperties(f.project, { taskId: f.taskAId, name, type: "continuous" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
  });

  it("allows a unique rename and treats rename-to-self as valid", () => {
    const f = fixture();
    const renamed = setTaskProperties(f.project, {
      taskId: f.taskAId,
      name: "FastTask",
      type: "continuous",
    });
    expect(renamed.ok).toBe(true);
    expect(renamed.project.controllers[0]!.tasks[0]!.name).toBe("FastTask");

    const sameName = setTaskProperties(f.project, {
      taskId: f.taskAId,
      name: "TaskA",
      type: "continuous",
    });
    expect(sameName.ok).toBe(true);
  });
});
