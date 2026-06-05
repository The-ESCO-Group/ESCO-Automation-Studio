import type { Controller } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

const MAX_TASKS_PER_CONTROLLER = 32;
const DEFAULT_MAX_PROGRAMS_PER_TASK = 32;
const CONTROLLOGIX_MAX_PROGRAMS_PER_TASK = 1000;

function controllerText(controller: Controller): string {
  return [controller.processorType, controller.catalogNumber]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toUpperCase();
}

function scheduledProgramLimit(controller: Controller): number {
  const text = controllerText(controller);
  if (text.includes("CONTROLLOGIX") || text.includes("SOFTLOGIX") || /\b1756-/.test(text)) {
    return CONTROLLOGIX_MAX_PROGRAMS_PER_TASK;
  }
  return DEFAULT_MAX_PROGRAMS_PER_TASK;
}

/**
 * Studio 5000 bounds task configuration: most controllers allow up to 32 tasks
 * and 32 scheduled programs per task, while ControlLogix/SoftLogix allow 1000
 * scheduled programs per task. Count distinct scheduled program ids so this
 * rule stays compatible with the existing scheduling rule that tolerates a
 * duplicate id inside the same imported task row.
 */
export const taskCapacity: ValidationRule = {
  id: "task-capacity",
  name: "Task capacity",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      if (controller.tasks.length > MAX_TASKS_PER_CONTROLLER) {
        findings.push({
          ruleId: "task-capacity",
          severity: "error",
          message: `Controller "${controller.name}" has ${controller.tasks.length} tasks; controller task rules permit at most ${MAX_TASKS_PER_CONTROLLER} tasks per controller.`,
          target: controller.name,
        });
      }

      const maxPrograms = scheduledProgramLimit(controller);
      for (const task of controller.tasks) {
        const scheduledCount = new Set(task.scheduledProgramIds).size;
        if (scheduledCount > maxPrograms) {
          findings.push({
            ruleId: "task-capacity",
            severity: "error",
            message: `Task "${task.name}" schedules ${scheduledCount} programs; this controller permits at most ${maxPrograms} scheduled programs per task.`,
            target: `${controller.name}/${task.name}`,
          });
        }
      }
    }
    return findings;
  },
};
