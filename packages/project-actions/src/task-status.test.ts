import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
  type Program,
} from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import { controllerTaskStatusReport, setTaskProperties } from "./index";

function ladderProgram(controllerId: string, name: string): Program {
  const program = createProgram(controllerId, name);
  const routine = createRoutine(program.id, "Main", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  return program;
}

function statusProject(): PlcProject {
  const project = createProject("Task Status Demo");
  const controller = createController(project.id, "Ctl");
  const active = ladderProgram(controller.id, "ActiveProgram");
  const inhibited = ladderProgram(controller.id, "InhibitedProgram");
  inhibited.inhibited = true;

  const stProgram = createProgram(controller.id, "StructuredProgram");
  const stRoutine = createRoutine(stProgram.id, "MainST", "structured-text");
  stRoutine.structuredText = "Out := In;";
  stProgram.mainRoutineId = stRoutine.id;
  stProgram.routines.push(stRoutine);

  const noMain = createProgram(controller.id, "NoMainProgram");
  controller.programs.push(active, inhibited, stProgram, noMain);

  const fastTask = createContinuousTask(controller.id, "FastTask", [
    active.id,
    active.id,
    inhibited.id,
    stProgram.id,
    noMain.id,
    "missing-program",
  ]);
  fastTask.type = "periodic";
  fastTask.periodMs = 10;
  fastTask.priority = 4;
  fastTask.watchdogMs = 250;
  fastTask.disableUpdateOutputs = true;

  const inhibitedTask = createContinuousTask(controller.id, "InhibitedTask", [active.id]);
  inhibitedTask.inhibited = true;

  controller.tasks.push(fastTask, inhibitedTask);
  project.controllers.push(controller);
  return project;
}

describe("controllerTaskStatusReport", () => {
  it("projects the exact offline scheduled scan set and blocked task entries", () => {
    const project = statusProject();
    const report = controllerTaskStatusReport(project);
    const byStatus = new Map(report.rows.map((row) => [row.status, row]));

    expect(report.scheduledRoutineIds).toEqual([
      project.controllers[0]!.programs[0]!.mainRoutineId,
      project.controllers[0]!.programs[2]!.mainRoutineId,
    ]);
    expect(report.scanEligibleCount).toBe(2);
    expect(report.blockedCount).toBe(5);
    expect(report.inhibitedCount).toBe(2);
    expect(report.missingCount).toBe(2);
    expect(report.nonLadderCount).toBe(0);
    expect(report.duplicateSkippedCount).toBe(1);

    const eligible = report.rows.filter((row) => row.status === "scan-eligible");
    expect(eligible).toHaveLength(2);
    expect(eligible.some((row) => row.routineLanguage === "structured-text")).toBe(true);
    expect(eligible[0]?.willScanInOfflineCycle).toBe(true);
    expect(eligible[0]?.statusBits.outputUpdateDisabled).toBe(true);
    expect(eligible[0]?.statusBits.watchdogConfigured).toBe(true);
    expect(eligible[0]?.statusBits.timingModelled).toBe(true);
    expect(byStatus.get("duplicate-routine-skipped")?.message).toMatch(/already in the offline scan set/);
    expect(byStatus.get("program-inhibited")?.programName).toBe("InhibitedProgram");
    expect(byStatus.get("non-ladder-main-routine")).toBeUndefined();
    expect(byStatus.get("missing-main-routine")?.programName).toBe("NoMainProgram");
    expect(byStatus.get("missing-program")?.programId).toBe("missing-program");
    expect(report.warnings).toHaveLength(5);
  });

  it("reports the offline fallback routine when no task schedule is active", () => {
    const project = createProject("Fallback Demo");
    const controller = createController(project.id, "Ctl");
    const program = ladderProgram(controller.id, "MainProgram");
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = controllerTaskStatusReport(project);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.source).toBe("offline-fallback");
    expect(report.rows[0]!.status).toBe("scan-eligible");
    expect(report.scheduledRoutineIds).toEqual([program.mainRoutineId]);
  });

  it("lets task metadata edits surface output-update status in the report", () => {
    const project = createProject("Task Metadata");
    const controller = createController(project.id, "Ctl");
    const program = ladderProgram(controller.id, "MainProgram");
    const task = createContinuousTask(controller.id, "MainTask", [program.id]);
    controller.programs.push(program);
    controller.tasks.push(task);
    project.controllers.push(controller);

    const updated = setTaskProperties(project, {
      taskId: task.id,
      name: "MainTask",
      type: "periodic",
      periodMs: 20,
      watchdogMs: 100,
      disableUpdateOutputs: true,
    });

    expect(updated.ok).toBe(true);
    const report = controllerTaskStatusReport(updated.project);
    expect(report.rows[0]!.periodMs).toBe(20);
    expect(report.rows[0]!.watchdogMs).toBe(100);
    expect(report.rows[0]!.disableUpdateOutputs).toBe(true);
    expect(report.rows[0]!.statusBits.outputUpdateDisabled).toBe(true);
  });
});
