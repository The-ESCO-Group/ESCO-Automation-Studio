import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A Logix task watchdog timeout must fall in the range Studio 5000 enforces at
 * verify time. Every task header carries a watchdog (`Watchdog`, in ms): if the
 * task's scan time exceeds it the controller faults, so the value is part of the
 * task configuration Studio 5000 range-checks when the project is verified. The
 * watchdog must be between 1 ms and 2,000,000 ms (the same upper bound as the
 * scan rate; the default is 500 ms).
 *
 * This is the watchdog companion to `task-rate`, which deliberately range-checks
 * only `Rate`/`Priority`. The importer (`toDomainProject.ts`) keeps `Watchdog`
 * only when it parses as a finite, positive number, so a freshly imported
 * project never carries a zero/negative watchdog — but it does *not* bound the
 * upper end, nor reject a sub-millisecond value. The matching exporter writes
 * `Watchdog` whenever it is positive, so an out-of-range value authored offline
 * (or surviving from a hand-edited L5X) round-trips back to Studio 5000
 * unchanged. This rule catches that header the way `task-rate` guards the rate
 * and priority. A task with no watchdog set is left alone — the absent attribute
 * means "use the controller default", which is always in range.
 */
export const taskWatchdog: ValidationRule = {
  id: "task-watchdog",
  name: "Task watchdog timeout",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    const MIN_WATCHDOG_MS = 1;
    const MAX_WATCHDOG_MS = 2_000_000;
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        if (task.watchdogMs == null) continue;
        if (task.watchdogMs < MIN_WATCHDOG_MS || task.watchdogMs > MAX_WATCHDOG_MS) {
          findings.push({
            ruleId: "task-watchdog",
            severity: "error",
            message: `Task "${task.name}" has a watchdog timeout of ${task.watchdogMs} ms; controller task rules require a watchdog between ${MIN_WATCHDOG_MS} and ${MAX_WATCHDOG_MS} ms.`,
            target: `${controller.name}/${task.name}`,
          });
        }
      }
    }
    return findings;
  },
};
