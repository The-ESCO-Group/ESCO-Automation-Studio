import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * In a GuardLogix project the safety partition extends from the task down to the
 * programs it schedules, and Studio 5000 enforces the boundary at verify time:
 *
 *  - **The safety task schedules only safety programs.** A program scheduled
 *    under the task whose `Class` is "Safety" must itself be a safety program
 *    (`Class="Safety"`). A standard program cannot be dragged into the safety
 *    task — Studio 5000 keeps the two partitions separate and rejects a standard
 *    program found under the safety task on verify.
 *  - **A scheduled safety program lives only under the safety task.** Conversely,
 *    when a program marked `Class="Safety"` appears in a task schedule, that task
 *    must be the safety task; it cannot be scheduled under a standard
 *    (continuous / periodic / event) task. Unscheduled safety programs remain a
 *    valid offline review state and are not flagged here.
 *
 * Both `Class` attributes are imported read-only — onto {@link Task.safetyClass}
 * and {@link Program.safetyClass} ("Safety" / "Standard") — and round-trip on
 * export, so an offline edit that re-homes a program across the partition (or a
 * binding carried in from a hand-edited L5X) survives back into Studio 5000
 * unchanged and surfaces only at verify. This is the scheduling-membership
 * analogue of {@link safetyTask} (which guards the safety *task* header — at most
 * one, and PERIODIC) and a partition-aware companion to `task-scheduling` (which
 * guards single-continuous-task and one-task-per-program without regard to
 * class). Reported as errors because the controller will not verify until the
 * misfiled program is moved back to its own partition.
 *
 * Scope is deliberately conservative to avoid false positives on legitimately
 * imported files. The rule only evaluates controllers that contain a safety task
 * (the GuardLogix indicator): a valid exported GuardLogix project always tags its
 * safety programs `Class="Safety"` and schedules them under the safety task, so a
 * fresh import never trips this — only an in-app edit or hand-authored L5X can.
 * A standard project (no task marked "Safety") produces no findings, and a
 * scheduled id that no longer resolves to a program is left to
 * `dangling-scheduled-program` rather than mis-classified here.
 */
export const safetyProgramScheduling: ValidationRule = {
  id: "safety-program-scheduling",
  name: "Safety program scheduling",
  category: "safety",
  severity: "error",
  run({ project }: { project: PlcProject }): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const hasSafetyTask = controller.tasks.some((task) => task.safetyClass === "Safety");
      // Only a GuardLogix project (one carrying a safety task) has a safety
      // partition to keep separate; a standard project has nothing to check.
      if (!hasSafetyTask) continue;

      const programById = new Map(controller.programs.map((program) => [program.id, program]));
      for (const task of controller.tasks) {
        const taskIsSafety = task.safetyClass === "Safety";
        for (const programId of task.scheduledProgramIds) {
          const program = programById.get(programId);
          // A dangling id is the province of `dangling-scheduled-program`.
          if (!program) continue;
          const programIsSafety = program.safetyClass === "Safety";
          if (taskIsSafety && !programIsSafety) {
            findings.push({
              ruleId: "safety-program-scheduling",
              severity: "error",
              message: `Program "${program.name}" is scheduled under safety task "${task.name}" but is not a safety program; the GuardLogix safety task may schedule only safety programs.`,
              target: `${controller.name}/${program.name}`,
            });
          } else if (!taskIsSafety && programIsSafety) {
            findings.push({
              ruleId: "safety-program-scheduling",
              severity: "error",
              message: `Safety program "${program.name}" is scheduled under standard task "${task.name}"; a safety program must be scheduled under the safety task.`,
              target: `${controller.name}/${program.name}`,
            });
          }
        }
      }
    }
    return findings;
  },
};
