import type {
  ControllerTaskStatusReport,
  ControllerTaskStatusRow,
} from "./task-status";

// Per-task offline scan statistics only. Task *verification* (per-task pass /
// warning / blocked diagnostics) lives in `verifyControllerTasks` in
// ./task-status — this module is intentionally just the accumulating counters.

/**
 * Offline task scan statistics.
 *
 * The Task Monitor projects the imported task schedule into an offline scan set
 * ({@link ControllerTaskStatusReport}). This module accumulates *observable*
 * per-task statistics across offline scan cycles — how many times each task has
 * scanned, when it last scanned, and a deterministic modelled scan-time estimate.
 *
 * It is pure and never touches a controller: a scan here is the offline cycle the
 * IDE already runs, not a hardware read. Timestamps and the monotonic sequence
 * are supplied by the caller so the function stays deterministic and testable.
 */

/** Per-task accumulated offline scan statistics. */
export interface TaskScanStat {
  /** Number of offline scan cycles this task has participated in. */
  scanCount: number;
  /** ISO timestamp of the most recent scan, or undefined before the first scan. */
  lastScanAt?: string;
  /** Monotonic scan-cycle sequence number of the most recent scan. */
  lastScanSeq?: number;
  /** Deterministic modelled scan-time estimate in ms (not a hardware measurement). */
  lastModelScanMs?: number;
}

/** Stats keyed by {@link taskScanKey}. */
export type TaskScanStats = Record<string, TaskScanStat>;

export interface RecordScanOptions {
  /** ISO timestamp for this scan cycle (caller-supplied for determinism). */
  at: string;
  /** Monotonic cycle sequence (caller increments per cycle). */
  seq: number;
  /** Optional exact task keys that released in this scan cycle. */
  scannedKeys?: readonly string[];
}

export interface RecordScanResult {
  stats: TaskScanStats;
  /** Keys of the tasks that scanned in this cycle. */
  scannedKeys: string[];
  /** How many tasks scanned in this cycle. */
  scannedCount: number;
}

/** Stable identity for a task row across report rebuilds. */
export function taskScanKey(row: ControllerTaskStatusRow): string {
  return [
    row.controllerId,
    row.taskId ?? row.source,
    row.programId ?? "",
    row.routineId ?? "",
  ].join("|");
}

/**
 * Deterministic offline scan-time *estimate* for a task row, in ms. This is a
 * model, not a measurement — it never reflects real controller timing. Heavier
 * (larger-period) periodic tasks get a slightly larger modelled slice than
 * continuous/event tasks so the column is informative.
 */
export function modelScanMs(row: ControllerTaskStatusRow): number {
  const base = row.taskType === "continuous" ? 0.8 : row.taskType === "event" ? 0.5 : 1.0;
  const periodFactor = row.periodMs ? Math.min(row.periodMs / 1000, 2) : 0.5;
  return Math.round((base + periodFactor) * 100) / 100;
}

/**
 * Accumulate one offline scan cycle into the stats map. Only tasks the report
 * marks as scanning this cycle ({@link ControllerTaskStatusRow.willScanInOfflineCycle})
 * are counted, so inhibited / blocked tasks correctly stay at their prior count.
 * Returns a new map (the input is not mutated).
 */
export function recordOfflineScan(
  stats: TaskScanStats,
  report: ControllerTaskStatusReport,
  options: RecordScanOptions,
): RecordScanResult {
  const next: TaskScanStats = { ...stats };
  const scannedKeys: string[] = [];
  const explicitScannedKeys = options.scannedKeys ? new Set(options.scannedKeys) : undefined;
  for (const row of report.rows) {
    const key = taskScanKey(row);
    if (explicitScannedKeys ? !explicitScannedKeys.has(key) : !row.willScanInOfflineCycle) continue;
    const prior = next[key];
    next[key] = {
      scanCount: (prior?.scanCount ?? 0) + 1,
      lastScanAt: options.at,
      lastScanSeq: options.seq,
      lastModelScanMs: modelScanMs(row),
    };
    scannedKeys.push(key);
  }
  return { stats: next, scannedKeys, scannedCount: scannedKeys.length };
}

/** Clear all accumulated offline scan statistics. */
export function resetTaskScanStats(): TaskScanStats {
  return {};
}
