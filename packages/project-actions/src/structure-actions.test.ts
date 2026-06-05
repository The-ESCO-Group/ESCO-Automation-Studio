import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import {
  addRungFromText,
  createProgram as createProgramAction,
  createTask as createTaskAction,
  deleteAoi,
  deleteProgram,
  deleteRoutine,
  deleteTask,
  deleteUdt,
} from "./index";

const MOTOR_UDT: UserDefinedType = {
  id: "udt_motor",
  name: "MotorUdt",
  members: [{ name: "Run", dataType: "BOOL" }],
};

const SCALE_AOI: AddOnInstruction = {
  id: "aoi_scale",
  name: "ScaleAOI",
  parameters: [],
  localTags: [],
  routineNames: ["Logic"],
};

function fixture(): {
  project: PlcProject;
  taskId: string;
  programId: string;
  mainRoutineId: string;
  subRoutineId: string;
} {
  const project = createProject("Structure");
  const controller = createController(project.id, "C1");
  const task = createContinuousTask(controller.id, "MainTask");
  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "MainRoutine", "ladder");
  const sub = createRoutine(program.id, "SubRoutine", "ladder");

  main.ladder = createLadderRoutine();
  sub.ladder = createLadderRoutine();
  program.mainRoutineId = main.id;
  program.routines.push(main, sub);
  task.scheduledProgramIds = [program.id];
  controller.tasks.push(task);
  controller.programs.push(program);
  controller.dataTypes.push(structuredClone(MOTOR_UDT));
  controller.addOnInstructions.push(structuredClone(SCALE_AOI));
  controller.controllerTags.push(createTag(controller.id, "Motor", "MotorUdt"));
  project.controllers.push(controller);

  return {
    project,
    taskId: task.id,
    programId: program.id,
    mainRoutineId: main.id,
    subRoutineId: sub.id,
  };
}

describe("project structure delete actions", () => {
  it("creates a program through the action layer and optionally schedules it under a task", () => {
    const { project, taskId } = fixture();
    const result = createProgramAction(project, {
      controllerId: project.controllers[0].id,
      name: "Utilities",
      description: "Offline utility logic",
      scheduledTaskId: taskId,
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ programName: "Utilities", scheduledTaskId: taskId });
    const controller = result.project.controllers[0];
    const created = controller.programs.find((program) => program.id === result.data?.programId);
    expect(created).toMatchObject({ name: "Utilities", description: "Offline utility logic" });
    expect(controller.tasks[0].scheduledProgramIds).toContain(result.data?.programId);
    expect(result.project).not.toBe(project);
  });

  it("rejects invalid or duplicate programs before mutating project structure", () => {
    const { project, taskId } = fixture();

    expect(createProgramAction(project, { controllerId: project.controllers[0].id, name: "1Bad" }).error).toMatch(/Invalid program/i);
    expect(createProgramAction(project, { controllerId: project.controllers[0].id, name: "MainProgram" }).error).toMatch(/already exists/i);
    expect(
      createProgramAction(project, {
        controllerId: project.controllers[0].id,
        name: "Utilities",
        scheduledTaskId: `${taskId}-missing`,
      }).error,
    ).toMatch(/Task .* not found/i);
  });

  it("creates tasks through the action layer with validated schedule metadata", () => {
    const { project, programId } = fixture();
    const result = createTaskAction(project, {
      controllerId: project.controllers[0].id,
      name: "FastPeriodic",
      type: "periodic",
      periodMs: 20.8,
      priority: 5.9,
      watchdogMs: 250.2,
      disableUpdateOutputs: true,
      scheduledProgramIds: [programId],
    });

    expect(result.ok).toBe(true);
    const task = result.project.controllers[0].tasks.find((candidate) => candidate.id === result.data?.taskId);
    expect(task).toMatchObject({
      name: "FastPeriodic",
      type: "periodic",
      periodMs: 20,
      priority: 5,
      watchdogMs: 250,
      disableUpdateOutputs: true,
      scheduledProgramIds: [programId],
    });
    expect(result.project).not.toBe(project);
  });

  it("rejects impossible task creates in the action layer", () => {
    const { project } = fixture();
    const controllerId = project.controllers[0].id;

    expect(createTaskAction(project, { controllerId, name: "Bad__Task", type: "periodic" }).error).toMatch(/Invalid task/i);
    expect(createTaskAction(project, { controllerId, name: "MainTask", type: "periodic" }).error).toMatch(/already exists/i);
    expect(createTaskAction(project, { controllerId, name: "SecondContinuous", type: "continuous" }).error).toMatch(/one continuous task/i);
    expect(
      createTaskAction(project, {
        controllerId,
        name: "MissingProgramTask",
        type: "periodic",
        scheduledProgramIds: ["missing-program"],
      }).error,
    ).toMatch(/Program .* not found/i);
  });

  it("deletes a task without deleting its scheduled programs", () => {
    const { project, taskId, programId } = fixture();
    const result = deleteTask(project, { taskId });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0].tasks).toHaveLength(0);
    expect(result.project.controllers[0].programs.some((program) => program.id === programId)).toBe(true);
  });

  it("deletes a program and removes it from task schedules", () => {
    const { project, programId } = fixture();
    const result = deleteProgram(project, { programId });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0].programs).toHaveLength(0);
    expect(result.project.controllers[0].tasks[0].scheduledProgramIds).toEqual([]);
  });

  it("deletes an unreferenced main routine and promotes a remaining routine", () => {
    const { project, mainRoutineId, subRoutineId } = fixture();
    const result = deleteRoutine(project, { routineId: mainRoutineId });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0].programs[0].routines.map((routine) => routine.id)).toEqual([subRoutineId]);
    expect(result.project.controllers[0].programs[0].mainRoutineId).toBe(subRoutineId);
  });

  it("blocks deleting a routine that is still called by another routine", () => {
    const { project, mainRoutineId, subRoutineId } = fixture();
    const withCall = addRungFromText(project, { routineId: mainRoutineId, text: "JSR(SubRoutine)" });
    expect(withCall.ok).toBe(true);

    const result = deleteRoutine(withCall.project, { routineId: subRoutineId });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still referenced/i);
  });

  it("blocks deleting a UDT while tags still use it and allows an unused UDT", () => {
    const { project } = fixture();

    const blocked = deleteUdt(project, { udtId: "udt_motor" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/still used/i);

    const unusedProject: PlcProject = {
      ...project,
      controllers: project.controllers.map((controller) => ({ ...controller, controllerTags: [] })),
    };
    const removed = deleteUdt(unusedProject, { udtId: "udt_motor" });
    expect(removed.ok).toBe(true);
    expect(removed.project.controllers[0].dataTypes).toHaveLength(0);
  });

  it("blocks deleting an AOI while ladder calls still use it and allows an unused AOI", () => {
    const { project, mainRoutineId } = fixture();
    const withCall = addRungFromText(project, { routineId: mainRoutineId, text: "ScaleAOI()" });
    expect(withCall.ok).toBe(true);

    const blocked = deleteAoi(withCall.project, { aoiId: "aoi_scale" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/logic call/i);

    const removed = deleteAoi(project, { aoiId: "aoi_scale" });
    expect(removed.ok).toBe(true);
    expect(removed.project.controllers[0].addOnInstructions).toHaveLength(0);
  });
});
