import type { Controller, Program } from "@esco/core";
import type { ValidationFinding, ValidationRule } from "./types";

type HandlerKind = "controller fault handler" | "power-up handler";

function configuredHandlerNames(controller: Controller): { kind: HandlerKind; name: string }[] {
  const handlers: { kind: HandlerKind; name: string }[] = [];
  const faultName = controller.faultRoutineName?.trim();
  if (faultName) handlers.push({ kind: "controller fault handler", name: faultName });
  const powerUpName = controller.powerUpRoutineName?.trim();
  if (powerUpName) handlers.push({ kind: "power-up handler", name: powerUpName });
  return handlers;
}

function findPrograms(controller: Controller, name: string): Program[] {
  return controller.programs.filter((program) => program.name === name);
}

function finding(controller: Controller, kind: HandlerKind, message: string, program?: Program): ValidationFinding {
  return {
    ruleId: "controller-handler-reference",
    severity: "error",
    message: `Controller "${controller.name}" ${kind} ${message}`,
    target: program ? `${controller.name}/${program.name}` : controller.name,
  };
}

/**
 * Controller Fault Handler and Power-Up Handler selections point at special
 * handler programs in Studio 5000, not arbitrary routines. The selected program
 * must exist and must have a resolvable main routine before the project can be
 * trusted for offline verification.
 */
export const controllerHandlerReference: ValidationRule = {
  id: "controller-handler-reference",
  name: "Controller handler reference",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const handler of configuredHandlerNames(controller)) {
        const matches = findPrograms(controller, handler.name);
        if (matches.length === 0) {
          findings.push(finding(controller, handler.kind, `program "${handler.name}" does not exist.`));
          continue;
        }
        if (matches.length > 1) {
          findings.push(finding(controller, handler.kind, `program "${handler.name}" resolves to ${matches.length} programs.`));
          continue;
        }

        const program = matches[0]!;
        if (!program.mainRoutineId) {
          findings.push(finding(controller, handler.kind, `program "${handler.name}" has no main routine configured.`, program));
          continue;
        }
        if (!program.routines.some((routine) => routine.id === program.mainRoutineId)) {
          findings.push(finding(controller, handler.kind, `program "${handler.name}" references a main routine that does not exist.`, program));
        }
      }
    }
    return findings;
  },
};
