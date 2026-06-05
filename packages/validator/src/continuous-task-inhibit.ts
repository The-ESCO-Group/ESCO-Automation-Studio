import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * The continuous task cannot be inhibited. Studio 5000 offers the "Inhibit Task"
 * option only for PERIODIC and EVENT tasks, which pre-empt and can be suspended
 * without stranding the controller; the continuous task runs in the time left by
 * the others and is the controller's background scan, so its "Inhibit Task"
 * checkbox is disabled on the task's Configuration page. A continuous task
 * carrying `InhibitTask="true"` is not a configuration Studio 5000 can produce,
 * and it rejects one on verify.
 *
 * The flag is imported read-only onto {@link Task.inhibited} and the exporter
 * writes `InhibitTask` back whenever it is set, so an offline edit that inhibits
 * a continuous task — or a value carried in from a hand-edited L5X — round-trips
 * back into Studio 5000 unchanged. This is the continuous-task companion to
 * `continuous-task-config` (which guards the same task's `DisableUpdateOutputs`):
 * both catch a continuous-task header combination that survives a round-trip but
 * will not verify. Periodic and event tasks, for which inhibiting is valid, are
 * left untouched.
 *
 * Reported as an error because the controller will not verify until the flag is
 * cleared.
 */
export const continuousTaskInhibit: ValidationRule = {
  id: "continuous-task-inhibit",
  name: "Continuous task inhibit",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        if (task.type !== "continuous") continue;
        if (task.inhibited === true) {
          findings.push({
            ruleId: "continuous-task-inhibit",
            severity: "error",
            message: `Continuous task "${task.name}" is inhibited; InhibitTask is valid only on PERIODIC or EVENT tasks.`,
            target: `${controller.name}/${task.name}`,
          });
        }
      }
    }
    return findings;
  },
};
