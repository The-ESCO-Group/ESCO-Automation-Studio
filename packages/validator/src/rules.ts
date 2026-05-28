import { routineTagReferences, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (
    ladder &&
    typeof ladder === "object" &&
    Array.isArray((ladder as { rungs?: unknown }).rungs)
  ) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

/** A program should declare a main routine. */
export const missingMainRoutine: ValidationRule = {
  id: "missing-main-routine",
  name: "Missing main routine",
  category: "project-structure",
  severity: "warning",
  run({ project }) {
    return project.controllers.flatMap((controller) =>
      controller.programs
        .filter((program) => !program.mainRoutineId)
        .map((program) => ({
          ruleId: "missing-main-routine",
          severity: "warning" as const,
          message: `Program "${program.name}" has no main routine.`,
          target: `${controller.name}/${program.name}`,
        })),
    );
  },
};

/** Tag names must be unique within their controller scope. */
export const duplicateControllerTag: ValidationRule = {
  id: "duplicate-controller-tag",
  name: "Duplicate controller tag",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings = [];
    for (const controller of project.controllers) {
      const seen = new Set<string>();
      for (const tag of controller.controllerTags) {
        if (seen.has(tag.name)) {
          findings.push({
            ruleId: "duplicate-controller-tag",
            severity: "error" as const,
            message: `Duplicate controller tag "${tag.name}".`,
            target: `${controller.name}/${tag.name}`,
          });
        }
        seen.add(tag.name);
      }
    }
    return findings;
  },
};

/** Every ladder operand must reference a tag that is defined in the project. */
export const undefinedTag: ValidationRule = {
  id: "undefined-tag",
  name: "Undefined tag",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const defined = new Set<string>();
      for (const tag of controller.controllerTags) defined.add(tag.name);
      for (const program of controller.programs) {
        for (const tag of program.programTags) defined.add(tag.name);
      }

      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          for (const name of routineTagReferences(ladder)) {
            if (!defined.has(name)) {
              findings.push({
                ruleId: "undefined-tag",
                severity: "error",
                message: `Undefined tag "${name}" referenced in routine "${routine.name}".`,
                target: `${controller.name}/${program.name}/${routine.name}`,
              });
            }
          }
        }
      }
    }
    return findings;
  },
};

export const defaultRules: ValidationRule[] = [
  missingMainRoutine,
  duplicateControllerTag,
  undefinedTag,
];
