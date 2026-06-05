import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * The continuous task has a narrower configuration surface than a periodic or
 * event task, and Studio 5000 enforces the difference at verify time:
 *
 *  - **Output processing cannot be disabled.** `DisableUpdateOutputs` ("Disable
 *    Automatic Output Processing To Reduce Task Overhead") is offered only for
 *    PERIODIC and EVENT tasks, which pre-empt and want to skip the trailing
 *    output scan. The continuous task runs in the time left between the others
 *    and always processes outputs, so the option is absent from its properties
 *    page. A continuous task carrying `DisableUpdateOutputs="true"` is not a
 *    configuration Studio 5000 can produce, and it rejects one on verify.
 *
 * The flag is imported read-only onto {@link Task.disableUpdateOutputs} and the
 * exporter writes `DisableUpdateOutputs` back whenever it is set, so an offline
 * edit that turns it on for a continuous task — or a value carried in from a
 * hand-edited L5X — round-trips back into Studio 5000 unchanged. This is the
 * continuous-task companion to `safety-task` (which guards the *safety* task's
 * type) and to `task-scheduling` (which guards the single-continuous-task
 * constraint): each catches a task-header combination that survives a round-trip
 * but will not verify. Periodic and event tasks, for which the flag is valid,
 * are left untouched, and the rate/priority/watchdog ranges remain the province
 * of `task-rate` and `task-watchdog`.
 *
 * Reported as an error because the controller will not verify until the flag is
 * cleared.
 */
export const continuousTaskConfig: ValidationRule = {
  id: "continuous-task-config",
  name: "Continuous task configuration",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        if (task.type !== "continuous") continue;
        if (task.disableUpdateOutputs === true) {
          findings.push({
            ruleId: "continuous-task-config",
            severity: "error",
            message: `Continuous task "${task.name}" disables automatic output processing; DisableUpdateOutputs is valid only on PERIODIC or EVENT tasks.`,
            target: `${controller.name}/${task.name}`,
          });
        }
      }
    }
    return findings;
  },
};
