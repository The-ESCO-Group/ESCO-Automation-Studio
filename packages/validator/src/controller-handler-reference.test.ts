import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithController() {
  const project = createProject("HandlerRefs");
  const controller = createController(project.id, "LineCtl");
  project.controllers.push(controller);
  return { project, controller };
}

function addProgramWithMain(controller: ReturnType<typeof createController>, name: string) {
  const program = createProgram(controller.id, name);
  const main = createRoutine(program.id, "Main", "ladder");
  program.routines.push(main);
  program.mainRoutineId = main.id;
  controller.programs.push(program);
  return { program, main };
}

function handlerFindings(project: ReturnType<typeof createProject>) {
  return createDefaultEngine().run(project).filter((finding) => finding.ruleId === "controller-handler-reference");
}

describe("controller-handler-reference", () => {
  it("accepts controller fault and power-up handler programs with resolvable main routines", () => {
    const { project, controller } = projectWithController();
    addProgramWithMain(controller, "ControllerFaultProgram");
    addProgramWithMain(controller, "PowerUpProgram");
    controller.faultRoutineName = "ControllerFaultProgram";
    controller.powerUpRoutineName = "PowerUpProgram";

    expect(handlerFindings(project)).toEqual([]);
  });

  it("does not let a same-named routine satisfy the controller handler program selection", () => {
    const { project, controller } = projectWithController();
    const { program } = addProgramWithMain(controller, "MainProgram");
    program.routines.push(createRoutine(program.id, "ControllerFaultRoutine", "ladder"));
    controller.faultRoutineName = "ControllerFaultRoutine";

    const findings = handlerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      target: "LineCtl",
    });
    expect(findings[0].message).toContain('program "ControllerFaultRoutine" does not exist');
  });

  it("flags handler programs that have no main routine", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "PowerUpProgram");
    controller.programs.push(program);
    controller.powerUpRoutineName = "PowerUpProgram";

    const findings = handlerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("has no main routine configured");
    expect(findings[0].target).toBe("LineCtl/PowerUpProgram");
  });

  it("flags handler programs whose main routine reference is dangling", () => {
    const { project, controller } = projectWithController();
    const program = createProgram(controller.id, "ControllerFaultProgram");
    program.mainRoutineId = "rtn-missing";
    controller.programs.push(program);
    controller.faultRoutineName = "ControllerFaultProgram";

    const findings = handlerFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("references a main routine that does not exist");
  });
});
