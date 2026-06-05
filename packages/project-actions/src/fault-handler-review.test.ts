import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, type Program, type Routine } from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import { faultHandlerReviewReport } from "./fault-handler-review";

function routine(programId: string, name: string, language: Routine["language"] = "ladder"): Routine {
  const created = createRoutine(programId, name, language);
  if (language === "ladder") created.ladder = createLadderRoutine();
  if (language === "structured-text") created.structuredText = "Out := In;";
  if (language === "function-block" || language === "sfc") created.sourceText = `<Routine Name="${name}"/>`;
  return created;
}

function program(controllerId: string, name: string, routines: Routine[] = []): Program {
  const created = createProgram(controllerId, name);
  created.routines.push(...routines);
  created.mainRoutineId = routines[0]?.id;
  return created;
}

function programWithMain(controllerId: string, name: string, routineName = "Main", language: Routine["language"] = "ladder"): Program {
  const created = createProgram(controllerId, name);
  const main = routine(created.id, routineName, language);
  created.routines.push(main);
  created.mainRoutineId = main.id;
  return created;
}

describe("faultHandlerReviewReport", () => {
  it("reviews controller and program fault handlers with explicit offline boundaries", () => {
    const project = createProject("Fault Review");
    const controller = createController(project.id, "Ctl");
    const mainProgram = programWithMain(controller.id, "Main");
    const controllerFaultProgram = programWithMain(controller.id, "ControllerFaultProgram", "ControllerFault");
    const powerUpProgram = programWithMain(controller.id, "PowerUpProgram", "PowerUp", "structured-text");
    const programFault = routine(mainProgram.id, "ProgramFault");
    mainProgram.routines.push(programFault);
    mainProgram.faultRoutineId = programFault.id;
    controller.faultRoutineName = "ControllerFaultProgram";
    controller.powerUpRoutineName = "PowerUpProgram";
    controller.programs.push(mainProgram, controllerFaultProgram, powerUpProgram);
    project.controllers.push(controller);

    const report = faultHandlerReviewReport(project);
    const byKind = new Map(report.rows.map((row) => [row.kind, row]));
    const mainProgramFault = report.rows.find((row) => row.kind === "program-fault" && row.programName === "Main");

    expect(report.configuredCount).toBe(3);
    expect(report.executableBodyCount).toBe(2);
    expect(report.nonLadderCount).toBe(1);
    expect(report.missingCount).toBe(0);
    expect(byKind.get("controller-fault")).toMatchObject({
      status: "configured-ladder",
      offlineBodyAvailable: true,
      offlineDispatchModelled: false,
      controllerFaultWordsModelled: false,
    });
    expect(byKind.get("controller-fault")?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-fault-dispatch",
      "no-controller-fault-words",
    ]));
    expect(byKind.get("power-up")).toMatchObject({
      status: "configured-non-ladder",
      routineLanguage: "structured-text",
      programName: "PowerUpProgram",
      offlineBodyAvailable: false,
    });
    expect(mainProgramFault).toMatchObject({
      status: "configured-ladder",
      programName: "Main",
      routineName: "ProgramFault",
    });
  });

  it("flags missing and unconfigured handler references", () => {
    const project = createProject("Fault Missing");
    const controller = createController(project.id, "Ctl");
    const mainProgram = program(controller.id, "Main");
    controller.faultRoutineName = "MissingFault";
    controller.programs.push(mainProgram);
    project.controllers.push(controller);

    const report = faultHandlerReviewReport(project);
    expect(report.rows.map((row) => [row.kind, row.status])).toEqual([
      ["controller-fault", "missing-program"],
      ["power-up", "not-configured"],
      ["program-fault", "not-configured"],
    ]);
    expect(report.missingCount).toBe(1);
    expect(report.warnings[0]).toMatch(/MissingFault/);
  });

  it("reports ambiguous controller handler names across programs", () => {
    const project = createProject("Fault Ambiguous");
    const controller = createController(project.id, "Ctl");
    const programA = programWithMain(controller.id, "SharedFault");
    const programB = programWithMain(controller.id, "SharedFault");
    controller.faultRoutineName = "SharedFault";
    controller.programs.push(programA, programB);
    project.controllers.push(controller);

    const report = faultHandlerReviewReport(project);
    const controllerFault = report.rows.find((row) => row.kind === "controller-fault")!;
    expect(controllerFault.status).toBe("ambiguous-program");
    expect(controllerFault.message).toMatch(/matches 2 imported programs/);
    expect(report.ambiguousCount).toBe(1);
  });
});
