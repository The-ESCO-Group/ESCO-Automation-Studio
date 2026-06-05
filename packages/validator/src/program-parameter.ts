import type { ValidationFinding, ValidationRule } from "./types";

/**
 * A program's parameters (Input / Output / InOut) and its local program tags
 * live in **one** program-scope namespace in Logix — a parameter is itself a
 * program-scoped tag. Studio 5000 therefore rejects, at verify time, a program
 * that declares two parameters with the same name, or a parameter whose name
 * collides with a program tag ("Tag already exists in this scope").
 *
 * `duplicate-program-tag` only walks `program.programTags`, so neither of those
 * collisions is caught today: `Program.parameters` is imported read-only
 * metadata (`extractPrograms` reads `<Parameters><Parameter>`) and round-trips
 * verbatim through export, so a name clash introduced offline survives untouched
 * and reaches Studio 5000 as a verify error. This rule is the parameter-side
 * companion to `duplicate-program-tag`: it reports only collisions that involve
 * a parameter, leaving pure tag-vs-tag duplicates to that rule so the two never
 * double-report the same clash.
 *
 * Names are compared case-insensitively, matching Logix (and the
 * `duplicate-routine-name` / `duplicate-task-name` family); each clashing
 * parameter name is reported once even when it repeats three or more times.
 */
export const duplicateProgramParameter: ValidationRule = {
  id: "duplicate-program-parameter",
  name: "Duplicate program parameter",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        const parameters = program.parameters ?? [];
        if (parameters.length === 0) continue;

        const tagNames = new Set(program.programTags.map((tag) => tag.name.toUpperCase()));
        const seenParameters = new Set<string>();
        const reported = new Set<string>();

        for (const parameter of parameters) {
          const key = parameter.name.toUpperCase();
          const target = `${controller.name}/${program.name}/${parameter.name}`;
          if (tagNames.has(key)) {
            if (!reported.has(key)) {
              reported.add(key);
              findings.push({
                ruleId: "duplicate-program-parameter",
                severity: "error",
                message: `Program parameter "${parameter.name}" in "${program.name}" collides with a program tag of the same name; program parameters and tags share one controller scope.`,
                target,
              });
            }
          } else if (seenParameters.has(key)) {
            if (!reported.has(key)) {
              reported.add(key);
              findings.push({
                ruleId: "duplicate-program-parameter",
                severity: "error",
                message: `Duplicate program parameter "${parameter.name}" in "${program.name}".`,
                target,
              });
            }
          }
          seenParameters.add(key);
        }
      }
    }
    return findings;
  },
};
