import type { PlcProject, Task } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A GuardLogix project has structural constraints on its safety task that
 * Studio 5000 enforces at verify time:
 *
 *  - **At most one safety task.** A controller may contain only a single task
 *    whose `Class` is "Safety"; the safety task is created with the project and
 *    cannot be duplicated. Two safety tasks fail verification.
 *  - **The safety task must be periodic.** Unlike standard tasks, the safety
 *    task cannot be continuous or event-triggered — Studio 5000 fixes it as a
 *    PERIODIC task. A safety task imported (or hand-edited offline) as
 *    continuous/event will not verify.
 *
 * The `Class` attribute is imported read-only onto {@link Task.safetyClass}
 * ("Safety" / "Standard") and round-trips on export, so an offline edit that
 * adds a second safety task, or flips the safety task's `Type` away from
 * PERIODIC, survives back into Studio 5000 unchanged. This rule catches both the
 * way `task-scheduling` guards the single-continuous-task constraint. A standard
 * project (no task marked "Safety") produces no findings, and the period/rate
 * range of the safety task is left to `task-rate`.
 */
export const safetyTask: ValidationRule = {
  id: "safety-task",
  name: "Safety task structure",
  category: "safety",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const safetyTasks = controller.tasks.filter(
        (task: Task) => task.safetyClass === "Safety",
      );
      if (safetyTasks.length > 1) {
        const names = safetyTasks.map((task) => `"${task.name}"`).join(", ");
        findings.push({
          ruleId: "safety-task",
          severity: "error",
          message: `Controller "${controller.name}" declares ${safetyTasks.length} safety tasks (${names}); a GuardLogix project permits only one.`,
          target: controller.name,
        });
      }
      for (const task of safetyTasks) {
        if (task.type !== "periodic") {
          findings.push({
            ruleId: "safety-task",
            severity: "error",
            message: `Safety task "${task.name}" is a ${task.type.toUpperCase()} task; the GuardLogix safety task must be PERIODIC.`,
            target: `${controller.name}/${task.name}`,
          });
        }
      }
    }
    return findings;
  },
};
