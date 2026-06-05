import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add programs/tasks. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

const folderFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "program-folder-usage");

describe("program-folder-usage", () => {
  it("does not flag an ordinary program that is scheduled and has a main routine", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "RealProg");
    program.mainRoutineId = "rtn-main";
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    expect(folderFindings(project)).toHaveLength(0);
  });

  it("does not flag a folder program that is unscheduled with no main routine", () => {
    const { project, controller } = projectWithController();
    const folder = createProgram(controller.id, "MachineFolder");
    folder.useAsFolder = true;
    controller.programs.push(folder);
    // A lone continuous task that schedules nothing — the folder is correctly absent.
    controller.tasks.push(createContinuousTask(controller.id, "MainTask"));
    expect(folderFindings(project)).toHaveLength(0);
  });

  it("flags a folder program that declares a main routine", () => {
    const { project, controller } = projectWithController();
    const folder = createProgram(controller.id, "MachineFolder");
    folder.useAsFolder = true;
    folder.mainRoutineId = "rtn-main";
    controller.programs.push(folder);
    const findings = folderFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Program "MachineFolder"');
    expect(findings[0].message).toContain("declares a main routine");
    expect(findings[0].target).toBe("Ctrl/MachineFolder");
  });

  it("flags a folder program that is scheduled under a task", () => {
    const { project, controller } = projectWithController();
    const folder = createProgram(controller.id, "MachineFolder");
    folder.useAsFolder = true;
    controller.programs.push(folder);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [folder.id]));
    const findings = folderFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('scheduled under task "MainTask"');
    expect(findings[0].target).toBe("Ctrl/MachineFolder");
  });

  it("flags both contradictions independently for a scheduled folder with a main routine", () => {
    const { project, controller } = projectWithController();
    const folder = createProgram(controller.id, "MachineFolder");
    folder.useAsFolder = true;
    folder.mainRoutineId = "rtn-main";
    controller.programs.push(folder);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [folder.id]));
    const findings = folderFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });
});
