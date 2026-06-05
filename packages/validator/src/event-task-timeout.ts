import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An EVENT task that enables its timeout must carry the timeout value. Studio
 * 5000's EVENT-task properties page offers "Execute Task If No Event Occurs
 * Within … ms" — the `EnableTimeout` checkbox — and the milliseconds field next
 * to it is the task `Rate`. When the checkbox is ticked the controller falls
 * back to firing the task on that interval if its trigger goes quiet, so the
 * value has to be present and positive; with the timeout enabled but no rate
 * configured, the fallback has nothing to schedule against and Studio 5000
 * reports a verify error.
 *
 * The importer (`toDomainProject.ts`) keeps `Rate` only when it parses as a
 * finite, positive number and copies `EnableTimeout` verbatim onto
 * {@link EventInfo.enableTimeout}; the matching exporter writes `EnableTimeout`
 * whenever it is set and `Rate` only when positive. So an EVENT task whose
 * timeout was enabled offline without a rate — or one assembled from a
 * hand-edited L5X that set `EnableTimeout="true"` but dropped `Rate` — survives
 * a round-trip and reaches Studio 5000 as a verify error.
 *
 * This is the EVENT-task timeout companion to the other task-header checks:
 * `task-rate` range-checks any rate that *is* present but deliberately requires
 * a rate only for PERIODIC tasks (an EVENT task with the timeout disabled needs
 * none), and `event-task-trigger` guards the trigger binding rather than the
 * fallback. A freshly imported, valid project never trips this — Studio 5000
 * always writes a `Rate` alongside an enabled timeout — so it fires only on the
 * offline-edit / hand-edited-L5X hazard the other `task-*` rules also guard.
 * Reported as an error because the controller will not verify until a timeout
 * value is supplied (or the timeout is disabled).
 */
export const eventTaskTimeout: ValidationRule = {
  id: "event-task-timeout",
  name: "Event task timeout",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        if (task.type !== "event") continue;
        if (task.eventInfo?.enableTimeout !== true) continue;
        if (task.periodMs != null && task.periodMs > 0) continue;
        findings.push({
          ruleId: "event-task-timeout",
          severity: "error",
          message: `EVENT task "${task.name}" enables its timeout but has no scan rate to fall back on; controller task rules require a positive timeout value when EnableTimeout is set.`,
          target: `${controller.name}/${task.name}`,
        });
      }
    }
    return findings;
  },
};
