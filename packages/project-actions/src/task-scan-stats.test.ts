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
import {
  controllerTaskStatusReport,
  modelScanMs,
  recordOfflineScan,
  resetTaskScanStats,
  taskScanKey,
} from "./index";

function ladderProgram(controllerId: string, name: string): Program {
  const program = createProgram(controllerId, name);
  const routine = createRoutine(program.id, "Main", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  return program;
}

/** A project with one scan-eligible task and one inhibited (non-scanning) task. */
function scanProject(): PlcProject {
  const project = createProject("Scan Stats Demo");
  const controller = createController(project.id, "Ctl");
  const active = ladderProgram(controller.id, "ActiveProgram");
  const idleProgram = ladderProgram(controller.id, "IdleProgram");
  controller.programs.push(active, idleProgram);

  const fastTask = createContinuousTask(controller.id, "FastTask", [active.id]);
  fastTask.type = "periodic";
  fastTask.periodMs = 20;
  fastTask.priority = 5;
  fastTask.watchdogMs = 250;

  const inhibitedTask = createContinuousTask(controller.id, "InhibitedTask", [idleProgram.id]);
  inhibitedTask.inhibited = true;

  controller.tasks.push(fastTask, inhibitedTask);
  project.controllers.push(controller);
  return project;
}

describe("recordOfflineScan", () => {
  it("increments only scan-eligible tasks and stamps time + sequence", () => {
    const report = controllerTaskStatusReport(scanProject());
    const eligible = report.rows.find((row) => row.status === "scan-eligible")!;
    const inhibited = report.rows.find((row) => row.status === "task-inhibited")!;

    const first = recordOfflineScan({}, report, { at: "2026-06-02T10:00:00.000Z", seq: 1 });
    expect(first.scannedCount).toBe(report.scanEligibleCount);
    expect(first.stats[taskScanKey(eligible)]?.scanCount).toBe(1);
    expect(first.stats[taskScanKey(eligible)]?.lastScanAt).toBe("2026-06-02T10:00:00.000Z");
    expect(first.stats[taskScanKey(eligible)]?.lastScanSeq).toBe(1);
    expect(first.stats[taskScanKey(eligible)]?.lastModelScanMs).toBe(modelScanMs(eligible));
    // Inhibited tasks never accumulate a scan.
    expect(first.stats[taskScanKey(inhibited)]).toBeUndefined();
  });

  it("accumulates across cycles without mutating the prior map", () => {
    const report = controllerTaskStatusReport(scanProject());
    const eligible = report.rows.find((row) => row.status === "scan-eligible")!;
    const first = recordOfflineScan({}, report, { at: "2026-06-02T10:00:00.000Z", seq: 1 });
    const second = recordOfflineScan(first.stats, report, { at: "2026-06-02T10:00:01.000Z", seq: 2 });
    expect(second.stats[taskScanKey(eligible)]?.scanCount).toBe(2);
    expect(second.stats[taskScanKey(eligible)]?.lastScanSeq).toBe(2);
    expect(second.stats[taskScanKey(eligible)]?.lastScanAt).toBe("2026-06-02T10:00:01.000Z");
    // The first result object is untouched (pure).
    expect(first.stats[taskScanKey(eligible)]?.scanCount).toBe(1);
  });

  it("can count only the explicit scheduled task keys released this cycle", () => {
    const report = controllerTaskStatusReport(scanProject());
    const eligible = report.rows.find((row) => row.status === "scan-eligible")!;
    const suppressed = recordOfflineScan({}, report, {
      at: "2026-06-02T10:00:00.000Z",
      seq: 1,
      scannedKeys: [],
    });
    expect(suppressed.scannedCount).toBe(0);
    expect(suppressed.stats[taskScanKey(eligible)]).toBeUndefined();

    const released = recordOfflineScan({}, report, {
      at: "2026-06-02T10:00:01.000Z",
      seq: 2,
      scannedKeys: [taskScanKey(eligible)],
    });
    expect(released.scannedKeys).toEqual([taskScanKey(eligible)]);
    expect(released.stats[taskScanKey(eligible)]?.scanCount).toBe(1);
  });

  it("models a deterministic, non-zero scan-time estimate", () => {
    const report = controllerTaskStatusReport(scanProject());
    const eligible = report.rows.find((row) => row.status === "scan-eligible")!;
    expect(modelScanMs(eligible)).toBeGreaterThan(0);
    expect(modelScanMs(eligible)).toBe(modelScanMs(eligible));
  });
});

describe("resetTaskScanStats", () => {
  it("clears all accumulated statistics", () => {
    const report = controllerTaskStatusReport(scanProject());
    const after = recordOfflineScan({}, report, { at: "2026-06-02T10:00:00.000Z", seq: 1 });
    expect(Object.keys(after.stats).length).toBeGreaterThan(0);
    expect(resetTaskScanStats()).toEqual({});
  });
});
