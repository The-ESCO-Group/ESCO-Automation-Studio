import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An EVENT task must be told what fires it. Studio 5000 verifies, for every task
 * whose `Type` is EVENT, that an `<EventInfo>` trigger is configured, and that a
 * trigger which fires off a tag (a consumed-tag connection, a module input data
 * state change, a motion-group / axis event, …) actually binds a `Tag`. A task
 * left with no trigger — or a tag-driven trigger with no tag — has nothing to
 * dispatch it and reports a verify error ("Task … event trigger is not
 * configured").
 *
 * The importer (`toDomainProject.ts`) copies `<EventInfo EventTrigger Tag>`
 * verbatim and the exporter (`exportL5X.ts`) writes it back unchanged, so an
 * EVENT task whose trigger was cleared offline — or assembled from an L5X that
 * omitted the binding — survives a round-trip and reaches Studio 5000 as a
 * verify error. This is the EVENT-task analogue of `task-rate` (which guards the
 * PERIODIC scan rate) and `task-scheduling` (which guards program membership):
 * the validator's verify surface, reported as an error because the controller
 * will not verify until the trigger is supplied.
 *
 * Scope is deliberately conservative to avoid false positives on legitimately
 * imported files. Only the two unambiguous verify errors are raised — a missing
 * trigger and a tag-driven trigger with no tag. The rule does **not** resolve the
 * bound tag's existence (a module-input trigger references a module-defined tag
 * such as `Local:1:I` that the offline model does not carry as an ordinary tag,
 * so resolving it would mis-flag valid configurations); tag resolution and the
 * richer triage live in the project-actions `eventTaskReviewReport` projection.
 * The tag-required classification mirrors that projection's `triggerNeedsTag`.
 */

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * Whether an EVENT trigger fires off a tag and therefore must bind one. Mirrors
 * the classification in the project-actions event-task review so the verify rule
 * and the offline triage agree on which triggers need a tag: "… Instruction
 * Only" needs none; anything referencing a tag, a connection, or a module does.
 */
function triggerNeedsTag(trigger: string | undefined): boolean {
  const normalized = trigger?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (normalized.includes("instruction only")) return false;
  return normalized.includes("tag") || normalized.includes("connection") || normalized.includes("module");
}

export const eventTaskTrigger: ValidationRule = {
  id: "event-task-trigger",
  name: "Event task trigger",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        if (task.type !== "event") continue;
        const target = `${controller.name}/${task.name}`;
        const trigger = task.eventInfo?.eventTrigger;
        if (blank(trigger)) {
          findings.push({
            ruleId: "event-task-trigger",
            severity: "error",
            message: `EVENT task "${task.name}" has no trigger configured; controller task rules require every EVENT task to specify what fires it.`,
            target,
          });
          continue;
        }
        if (triggerNeedsTag(trigger) && blank(task.eventInfo?.eventTag)) {
          findings.push({
            ruleId: "event-task-trigger",
            severity: "error",
            message: `EVENT task "${task.name}" is triggered by "${trigger!.trim()}" but specifies no tag; controller task rules require a tag for a tag-driven event trigger.`,
            target,
          });
        }
      }
    }
    return findings;
  },
};
