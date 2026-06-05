import { analyzeStructuredText } from "@esco/parser-l5x";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Studio 5000 Verify reports syntax/structural problems in Structured Text
 * routines before a download. ESCO's offline ST executor intentionally covers a
 * conservative subset, so the shared analyzer surfaces unambiguous syntax
 * blockers in the same project-wide Verify pass used for ladder validation.
 */
export const structuredTextSyntax: ValidationRule = {
  id: "structured-text-syntax",
  name: "Structured Text syntax",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          if (routine.language !== "structured-text") continue;
          const source = routine.structuredText ?? routine.sourceText ?? "";
          const analysis = analyzeStructuredText(source);
          for (const finding of analysis.findings) {
            findings.push({
              ruleId: "structured-text-syntax",
              severity: "error",
              message: `Structured Text routine "${routine.name}"${finding.line ? ` line ${finding.line}` : ""}: ${finding.message}`,
              target: `${controller.name}/${program.name}/${routine.name}`,
            });
          }
        }
      }
    }

    return findings;
  },
};
