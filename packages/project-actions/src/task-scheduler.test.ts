import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  createOfflineTaskSchedulerState,
  defaultValues,
  scanScheduledProject,
  selectOfflineTaskScanSet,
  traceScheduledProject,
} from "./index";

function scheduledCounterProject(): PlcProject {
  const project = createProject("Scheduled Counters");
  const controller = createController(project.id, "SchedCtl");

  const fastProgram = createProgram(controller.id, "FastProgram");
  const fastRoutine = createRoutine(fastProgram.id, "FastRoutine", "structured-text");
  fastRoutine.structuredText = "FastCount := FastCount + 1;";
  fastProgram.mainRoutineId = fastRoutine.id;
  fastProgram.routines.push(fastRoutine);

  const slowProgram = createProgram(controller.id, "SlowProgram");
  const slowRoutine = createRoutine(slowProgram.id, "SlowRoutine", "structured-text");
  slowRoutine.structuredText = "SlowCount := SlowCount + 1;";
  slowProgram.mainRoutineId = slowRoutine.id;
  slowProgram.routines.push(slowRoutine);

  const eventProgram = createProgram(controller.id, "EventProgram");
  const eventRoutine = createRoutine(eventProgram.id, "EventRoutine", "structured-text");
  eventRoutine.structuredText = "EventCount := EventCount + 1;";
  eventProgram.mainRoutineId = eventRoutine.id;
  eventProgram.routines.push(eventRoutine);

  const fastTask = createContinuousTask(controller.id, "FastPeriodic", [fastProgram.id]);
  fastTask.type = "periodic";
  fastTask.periodMs = 10;

  const slowTask = createContinuousTask(controller.id, "SlowPeriodic", [slowProgram.id]);
  slowTask.type = "periodic";
  slowTask.periodMs = 30;

  const eventTask = createContinuousTask(controller.id, "ExternalEvent", [eventProgram.id]);
  eventTask.type = "event";

  controller.controllerTags.push(
    createTag(controller.id, "FastCount", "DINT", { value: 0 }),
    createTag(controller.id, "SlowCount", "DINT", { value: 0 }),
    createTag(controller.id, "EventCount", "DINT", { value: 0 }),
  );
  controller.programs.push(fastProgram, slowProgram, eventProgram);
  controller.tasks.push(fastTask, slowTask, eventTask);
  project.controllers.push(controller);
  return project;
}

describe("offline task scheduler", () => {
  it("releases periodic tasks on deterministic modeled cadence and holds event tasks", () => {
    const project = scheduledCounterProject();
    let state = createOfflineTaskSchedulerState();

    const first = selectOfflineTaskScanSet(project, state, 10);
    state = first.state;
    expect(first.routineIds.map((id) => id && project.controllers[0]!.programs.find((program) => program.mainRoutineId === id)?.name)).toEqual([
      "FastProgram",
      "SlowProgram",
    ]);
    expect(first.scannedTaskKeys).toHaveLength(2);
    expect(first.heldEventTaskKeys).toHaveLength(1);
    expect(first.triggeredEventTaskKeys).toHaveLength(0);

    const second = selectOfflineTaskScanSet(project, state, 10);
    state = second.state;
    expect(second.routineIds).toEqual([project.controllers[0]!.programs[0]!.mainRoutineId]);
    expect(second.scannedTaskKeys).toHaveLength(1);
    expect(second.heldEventTaskKeys).toHaveLength(1);
    expect(second.triggeredEventTaskKeys).toHaveLength(0);

    const third = selectOfflineTaskScanSet(project, state, 10);
    state = third.state;
    expect(third.routineIds).toEqual([project.controllers[0]!.programs[0]!.mainRoutineId]);

    const fourth = selectOfflineTaskScanSet(project, state, 10);
    expect(fourth.routineIds).toEqual([
      project.controllers[0]!.programs[0]!.mainRoutineId,
      project.controllers[0]!.programs[1]!.mainRoutineId,
    ]);
  });

  it("releases event tasks only when a software-only trigger is supplied", () => {
    const project = scheduledCounterProject();
    let state = createOfflineTaskSchedulerState();
    const eventRow = selectOfflineTaskScanSet(project, state, 10).heldEventTaskKeys[0]!;

    const triggered = selectOfflineTaskScanSet(project, state, 10, ["ExternalEvent"]);
    state = triggered.state;
    expect(triggered.routineIds.map((id) => project.controllers[0]!.programs.find((program) => program.mainRoutineId === id)?.name)).toEqual([
      "FastProgram",
      "SlowProgram",
      "EventProgram",
    ]);
    expect(triggered.heldEventTaskKeys).toHaveLength(0);
    expect(triggered.triggeredEventTaskKeys).toEqual([eventRow]);
    expect(triggered.scannedTaskKeys).toContain(eventRow);

    const heldAgain = selectOfflineTaskScanSet(project, state, 10);
    expect(heldAgain.routineIds).toEqual([project.controllers[0]!.programs[0]!.mainRoutineId]);
    expect(heldAgain.heldEventTaskKeys).toEqual([eventRow]);
    expect(heldAgain.triggeredEventTaskKeys).toHaveLength(0);
  });

  it("accepts stable task scan keys as simulated event triggers", () => {
    const project = scheduledCounterProject();
    const report = selectOfflineTaskScanSet(project, createOfflineTaskSchedulerState(), 10);
    const eventKey = report.heldEventTaskKeys[0]!;
    const eventStatusRow = project.controllers[0]!.tasks.find((task) => task.name === "ExternalEvent")!;
    expect(eventKey).toContain(eventStatusRow.id);

    const triggered = selectOfflineTaskScanSet(project, createOfflineTaskSchedulerState(), 10, [eventKey]);
    expect(triggered.triggeredEventTaskKeys).toEqual([eventKey]);
    expect(triggered.heldEventTaskKeys).toHaveLength(0);
  });

  it("scans only released task routines through the scheduled scan wrapper", () => {
    const project = scheduledCounterProject();
    let state = createOfflineTaskSchedulerState();
    let values = defaultValues(project);

    for (let tick = 0; tick < 3; tick += 1) {
      const result = scanScheduledProject(project, values, { schedulerState: state, deltaMs: 10 });
      expect(result.ok).toBe(true);
      values = result.data!.values;
      state = result.data!.schedulerState;
    }

    expect(values.FastCount).toBe(3);
    expect(values.SlowCount).toBe(1);
    expect(values.EventCount).toBe(0);

    const eventKey = scanScheduledProject(project, values, { schedulerState: state, deltaMs: 10 }).data!.heldEventTaskKeys[0]!;
    const triggered = scanScheduledProject(project, values, {
      schedulerState: state,
      deltaMs: 10,
      simulatedEventTaskTriggers: [eventKey],
    });
    expect(triggered.data!.triggeredEventTaskKeys).toEqual([eventKey]);
    expect(triggered.data!.heldEventTaskKeys).toHaveLength(0);
    expect(triggered.data!.values.FastCount).toBe(4);
    expect(triggered.data!.values.SlowCount).toBe(2);
    expect(triggered.data!.values.EventCount).toBe(1);

    values = triggered.data!.values;
    state = triggered.data!.schedulerState;
    const next = scanScheduledProject(project, values, { schedulerState: state, deltaMs: 10 });
    expect(next.data!.values.FastCount).toBe(5);
    expect(next.data!.values.SlowCount).toBe(2);
    expect(next.data!.values.EventCount).toBe(1);
    expect(next.data!.heldEventTaskKeys).toEqual([eventKey]);
  });

  it("traces only routines released by the offline scheduler", () => {
    const project = scheduledCounterProject();
    let state = createOfflineTaskSchedulerState();
    let values = defaultValues(project);

    const first = traceScheduledProject(project, values, { schedulerState: state, deltaMs: 10 });
    values = first.values;
    state = first.schedulerState;
    expect(first.scannedTaskKeys).toHaveLength(2);
    expect(first.heldEventTaskKeys).toHaveLength(1);
    expect(first.triggeredEventTaskKeys).toHaveLength(0);
    expect(first.trace.some((entry) => entry.writes.some((write) => write.path === "FastCount" && write.value === 1))).toBe(true);
    expect(first.trace.some((entry) => entry.writes.some((write) => write.path === "SlowCount" && write.value === 1))).toBe(true);
    expect(first.trace.some((entry) => entry.writes.some((write) => write.path === "EventCount"))).toBe(false);

    const second = traceScheduledProject(project, values, { schedulerState: state, deltaMs: 10 });
    values = second.values;
    state = second.schedulerState;
    expect(second.scannedTaskKeys).toHaveLength(1);
    expect(second.triggeredEventTaskKeys).toHaveLength(0);
    expect(second.trace.some((entry) => entry.writes.some((write) => write.path === "FastCount" && write.value === 2))).toBe(true);
    expect(second.trace.some((entry) => entry.writes.some((write) => write.path === "SlowCount"))).toBe(false);
    expect(second.trace.some((entry) => entry.writes.some((write) => write.path === "EventCount"))).toBe(false);

    const third = traceScheduledProject(project, values, { schedulerState: state, deltaMs: 10 });
    const eventKey = third.heldEventTaskKeys[0]!;
    const fourth = traceScheduledProject(project, third.values, {
      schedulerState: third.schedulerState,
      deltaMs: 10,
      simulatedEventTaskTriggers: [eventKey],
    });
    expect(third.scannedTaskKeys).toHaveLength(1);
    expect(fourth.scannedTaskKeys).toHaveLength(3);
    expect(fourth.triggeredEventTaskKeys).toEqual([eventKey]);
    expect(fourth.values.FastCount).toBe(4);
    expect(fourth.values.SlowCount).toBe(2);
    expect(fourth.values.EventCount).toBe(1);
    expect(fourth.trace.some((entry) => entry.writes.some((write) => write.path === "EventCount" && write.value === 1))).toBe(true);
  });
});
