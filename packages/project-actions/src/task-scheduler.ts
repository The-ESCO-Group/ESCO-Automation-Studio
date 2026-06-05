import type { PlcProject } from "@esco/core";
import { taskScanKey } from "./task-scan-stats";
import { controllerTaskStatusReport, type ControllerTaskStatusRow } from "./task-status";

export interface OfflineTaskSchedulerState {
  elapsedMsByTaskKey: Record<string, number>;
  releasedTaskKeys: Record<string, boolean>;
}

export interface OfflineTaskScanSet {
  routineIds: string[];
  scannedTaskKeys: string[];
  heldEventTaskKeys: string[];
  triggeredEventTaskKeys: string[];
  state: OfflineTaskSchedulerState;
}

export function createOfflineTaskSchedulerState(): OfflineTaskSchedulerState {
  return { elapsedMsByTaskKey: {}, releasedTaskKeys: {} };
}

function normalizeDeltaMs(deltaMs: number | undefined): number {
  return Number.isFinite(deltaMs) ? Math.max(0, Number(deltaMs)) : 0;
}

function normalizeTriggerKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function eventTaskTriggerCandidates(row: ControllerTaskStatusRow): string[] {
  return [
    taskScanKey(row),
    row.taskId,
    row.taskName,
    row.routineId,
    row.routineName,
    row.programId,
    row.programName,
    `${row.controllerName}/${row.taskName}`,
    `${row.controllerName}:${row.taskName}`,
  ]
    .map(normalizeTriggerKey)
    .filter(Boolean);
}

function eventTaskTriggered(row: ControllerTaskStatusRow, triggers: Set<string>): boolean {
  if (triggers.size === 0) return false;
  return eventTaskTriggerCandidates(row).some((candidate) => triggers.has(candidate));
}

function shouldReleaseTask(
  row: ControllerTaskStatusRow,
  state: OfflineTaskSchedulerState,
  deltaMs: number,
  eventTriggers: Set<string>,
): { release: boolean; elapsedMs: number; released: boolean; heldEvent: boolean; triggeredEvent: boolean } {
  const key = taskScanKey(row);
  if (row.taskType === "event") {
    const triggered = eventTaskTriggered(row, eventTriggers);
    return {
      release: triggered,
      elapsedMs: state.elapsedMsByTaskKey[key] ?? 0,
      released: triggered || (state.releasedTaskKeys[key] ?? false),
      heldEvent: !triggered,
      triggeredEvent: triggered,
    };
  }
  if (row.taskType !== "periodic") {
    return { release: true, elapsedMs: 0, released: true, heldEvent: false, triggeredEvent: false };
  }

  const periodMs = row.periodMs && row.periodMs > 0 ? row.periodMs : deltaMs;
  if (!state.releasedTaskKeys[key]) {
    return { release: true, elapsedMs: 0, released: true, heldEvent: false, triggeredEvent: false };
  }

  const elapsedMs = (state.elapsedMsByTaskKey[key] ?? 0) + deltaMs;
  if (periodMs <= 0 || elapsedMs < periodMs) {
    return { release: false, elapsedMs, released: true, heldEvent: false, triggeredEvent: false };
  }
  return { release: true, elapsedMs: elapsedMs % periodMs, released: true, heldEvent: false, triggeredEvent: false };
}

export function selectOfflineTaskScanSet(
  project: PlcProject,
  state: OfflineTaskSchedulerState = createOfflineTaskSchedulerState(),
  deltaMs?: number,
  simulatedEventTaskTriggers: readonly string[] = [],
): OfflineTaskScanSet {
  const stepMs = normalizeDeltaMs(deltaMs);
  const eventTriggers = new Set(simulatedEventTaskTriggers.map(normalizeTriggerKey).filter(Boolean));
  const next: OfflineTaskSchedulerState = {
    elapsedMsByTaskKey: { ...state.elapsedMsByTaskKey },
    releasedTaskKeys: { ...state.releasedTaskKeys },
  };
  const routineIds: string[] = [];
  const scannedTaskKeys: string[] = [];
  const heldEventTaskKeys: string[] = [];
  const triggeredEventTaskKeys: string[] = [];
  const seenRoutineIds = new Set<string>();

  for (const row of controllerTaskStatusReport(project).rows) {
    if (!row.scanEligible || !row.routineId || !row.willScanInOfflineCycle) continue;
    const key = taskScanKey(row);
    const release = shouldReleaseTask(row, state, stepMs, eventTriggers);
    next.elapsedMsByTaskKey[key] = release.elapsedMs;
    next.releasedTaskKeys[key] = release.released;
    if (release.heldEvent) {
      heldEventTaskKeys.push(key);
      continue;
    }
    if (!release.release) continue;
    if (release.triggeredEvent) triggeredEventTaskKeys.push(key);
    scannedTaskKeys.push(key);
    if (!seenRoutineIds.has(row.routineId)) {
      routineIds.push(row.routineId);
      seenRoutineIds.add(row.routineId);
    }
  }

  return { routineIds, scannedTaskKeys, heldEventTaskKeys, triggeredEventTaskKeys, state: next };
}
