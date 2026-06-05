import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * In a GuardLogix project the safety partition extends past the task and the
 * programs it schedules all the way down to the *tags* those programs own, and
 * Studio 5000 keeps the two partitions separate at verify time:
 *
 *  - **A safety program owns only safety tags.** Every program-scoped tag inside
 *    a program whose `Class` is "Safety" is itself a safety tag (`Class="Safety"`).
 *    A standard tag cannot be created in a safety program — Studio 5000 rejects a
 *    `Class="Standard"` tag found there on verify.
 *  - **A standard program owns only standard tags.** Conversely, a tag marked
 *    `Class="Safety"` cannot live in a standard program; the safety partition is
 *    closed to standard scopes.
 *
 * Both `Class` attributes are imported read-only — onto {@link Tag.safetyClass}
 * and {@link Program.safetyClass} ("Safety" / "Standard") — and round-trip on
 * export (`exportL5X.ts` writes each back as `Class`), so an offline edit that
 * flips a program tag's class across the partition (or a binding carried in from
 * a hand-edited L5X) survives back into Studio 5000 unchanged and surfaces only
 * at verify. This is the tag-level companion to {@link safetyProgramScheduling}
 * (which guards the task -> program membership of the same partition) and to
 * {@link safetyTask} (which guards the safety *task* header); together they cover
 * the partition end to end: task, program, and now the program's own tags.
 *
 * Scope is deliberately conservative, mirroring {@link safetyProgramScheduling}.
 * Only controllers that contain a safety task (the GuardLogix indicator) are
 * evaluated, and a tag is compared only when both its program and the tag itself
 * carry an explicit "Safety"/"Standard" class — an absent class means the scope's
 * partition is implied, which a valid export never leaves mismatched, so a fresh
 * import never trips this and only an in-app edit or hand-authored L5X can.
 * Controller-scoped safety tags are not a program-partition question and are left
 * alone, and a class value that is neither "Safety" nor "Standard" is ignored
 * rather than guessed at. Reported as errors because the controller will not
 * verify until the misfiled tag is moved back to its own partition.
 */
function classOf(value: string | undefined): "safety" | "standard" | undefined {
  if (value === "Safety") return "safety";
  if (value === "Standard") return "standard";
  return undefined;
}

export const safetyTagPartition: ValidationRule = {
  id: "safety-tag-partition",
  name: "Safety tag partition",
  category: "safety",
  severity: "error",
  run({ project }: { project: PlcProject }): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const hasSafetyTask = controller.tasks.some((task) => task.safetyClass === "Safety");
      // Only a GuardLogix project (one carrying a safety task) has a safety
      // partition to keep separate; a standard project has nothing to check.
      if (!hasSafetyTask) continue;

      for (const program of controller.programs) {
        const programClass = classOf(program.safetyClass);
        // Without an explicit program class the scope's partition is implied; a
        // valid export never leaves it mismatched, so skip rather than guess.
        if (!programClass) continue;
        for (const tag of program.programTags) {
          const tagClass = classOf(tag.safetyClass);
          if (!tagClass || tagClass === programClass) continue;
          const target = `${controller.name}/${program.name}/${tag.name}`;
          if (programClass === "safety") {
            findings.push({
              ruleId: "safety-tag-partition",
              severity: "error",
              message: `Standard tag "${tag.name}" is scoped to safety program "${program.name}"; a GuardLogix safety program may own only safety tags.`,
              target,
            });
          } else {
            findings.push({
              ruleId: "safety-tag-partition",
              severity: "error",
              message: `Safety tag "${tag.name}" is scoped to standard program "${program.name}"; a safety tag must reside in the safety partition.`,
              target,
            });
          }
        }
      }
    }
    return findings;
  },
};
