import { createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

const registry = createDefaultRegistry();

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

/**
 * Validate every ladder operand against the instruction registry:
 *  - `missing-operand` (warning): a required operand is blank;
 *  - `undefined-tag` (error): a tag reference has no matching tag;
 *  - `operand-type-mismatch` (error): a tag's data type isn't allowed there.
 * Numeric literals (e.g. MOV(123, …)) are constants, not tag references.
 */
export const ladderOperands: ValidationRule = {
  id: "ladder-operands",
  name: "Ladder operands",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const tagTypes = new Map<string, string>();
      for (const tag of controller.controllerTags) tagTypes.set(tag.name, tag.dataType);
      for (const program of controller.programs) {
        for (const tag of program.programTags) tagTypes.set(tag.name, tag.dataType);
      }

      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;

          for (const node of routineNodes(ladder)) {
            const definition = registry.get(node.instructionType);
            if (!definition) continue;

            definition.operands.forEach((operandDef, index) => {
              const value = node.operands[index]?.value?.trim() ?? "";

              if (value === "") {
                if (operandDef.required) {
                  findings.push({
                    ruleId: "missing-operand",
                    severity: "warning",
                    message: `${node.instructionType} is missing required operand "${operandDef.name}".`,
                    target,
                  });
                }
                return;
              }

              if (isNumericLiteral(value)) return; // a constant, not a tag reference

              const dataType = tagTypes.get(value);
              if (dataType === undefined) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Undefined tag "${value}" referenced in routine "${routine.name}".`,
                  target,
                });
              } else if (operandDef.allowedTypes && !operandDef.allowedTypes.includes(dataType)) {
                findings.push({
                  ruleId: "operand-type-mismatch",
                  severity: "error",
                  message: `${node.instructionType} operand "${operandDef.name}" expects ${operandDef.allowedTypes.join("/")}, but tag "${value}" is ${dataType}.`,
                  target,
                });
              }
            });
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
  ladderOperands,
];
