import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
} from "./factory";
import type { PlcProject } from "./types";

/**
 * Builds the canonical "start/stop motor" demo project described in the plan:
 * DemoController > MainProgram > MainRoutine, with StartPB / StopPB / MotorRun
 * BOOL tags. Used by the web shell to prove the model drives the UI.
 */
export function createDemoProject(): PlcProject {
  const project = createProject(
    "Demo Project",
    "Start/stop motor demo used to validate the foundation.",
  );

  const controller = createController(project.id, "DemoController");
  controller.processorType = "Emulated";

  const program = createProgram(controller.id, "MainProgram");
  const mainRoutine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = mainRoutine.id;
  program.routines.push(mainRoutine);

  const task = createContinuousTask(controller.id, "MainTask", [program.id]);
  controller.tasks.push(task);
  controller.programs.push(program);

  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", {
      description: "Start push button",
      value: false,
    }),
    createTag(controller.id, "StopPB", "BOOL", {
      description: "Stop push button",
      value: false,
    }),
    createTag(controller.id, "MotorRun", "BOOL", {
      description: "Motor run output",
      value: false,
    }),
  );

  project.controllers.push(controller);
  return project;
}
