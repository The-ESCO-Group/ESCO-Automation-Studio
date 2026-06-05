import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A redundant ControlLogix controller does not support the continuous task.
 *
 * Redundancy pairs a primary and secondary controller that must execute in
 * lock-step and cross-load at a bounded point in the scan, so every task has to
 * be schedulable on a fixed period or event. The continuous task — which runs in
 * whatever time is left between the others and never completes — has no such
 * boundary, and Studio 5000 therefore forbids it once `<RedundancyInfo>` carries
 * `Enabled="true"`. Enabling redundancy on a project that has a continuous task
 * makes Studio 5000 require the task be removed or converted to PERIODIC before
 * the project will verify.
 *
 * Redundancy is imported read-only onto {@link RedundancyInfo.enabled} and the
 * exporter writes `Enabled` back, while the task type round-trips on
 * {@link Task.type}, so an offline edit that flips redundancy on for a project
 * that still has its continuous task — or that combination carried in from a
 * hand-edited L5X — survives export -> import unchanged and then fails to verify.
 * This is the redundancy companion to `continuous-task-config` (which guards the
 * continuous task's own DisableUpdateOutputs flag) and `task-scheduling` (which
 * guards the single-continuous-task constraint): each catches a task-header
 * combination that round-trips but the controller will not accept. Non-redundant
 * controllers, and redundant controllers whose tasks are all periodic or event,
 * are left untouched.
 *
 * Reported as an error because the controller will not verify until the
 * continuous task is removed or converted while redundancy stays enabled.
 */
export const redundancyContinuousTask: ValidationRule = {
  id: "redundancy-continuous-task",
  name: "Redundancy continuous task",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      if (controller.redundancyInfo?.enabled !== true) continue;
      for (const task of controller.tasks) {
        if (task.type !== "continuous") continue;
        findings.push({
          ruleId: "redundancy-continuous-task",
          severity: "error",
          message: `Continuous task "${task.name}" is not supported while controller redundancy is enabled; remove it or convert it to a PERIODIC task.`,
          target: `${controller.name}/${task.name}`,
        });
      }
    }
    return findings;
  },
};
