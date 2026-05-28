import { createProgram, type Program } from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { extractRoutines } from "./extractRoutines";
import { extractTags } from "./extractTags";

export interface ExtractedPrograms {
  programs: Program[];
  warnings: string[];
}

/** Extract `<Program>` elements: their program-scoped tags and routines. */
export function extractPrograms(
  controllerNode: L5XNode,
  controllerId: string,
  registry: InstructionRegistry,
): ExtractedPrograms {
  const warnings: string[] = [];
  const programs = toArray<L5XNode>(child(child(controllerNode, "Programs"), "Program")).flatMap(
    (programNode) => {
      const name = attr(programNode, "Name");
      if (!name) return [];

      const program = createProgram(controllerId, name);
      const description = child(programNode, "Description");
      if (description) program.description = text(description);
      if (attr(programNode, "Disabled") === "true") program.inhibited = true;

      // Program parameters (Input/Output/InOut) — read-only imported metadata.
      const parameters = toArray<L5XNode>(child(child(programNode, "Parameters"), "Parameter")).flatMap(
        (paramNode) => {
          const paramName = attr(paramNode, "Name");
          if (!paramName) return [];
          const paramDesc = child(paramNode, "Description");
          return [
            {
              name: paramName,
              dataType: attr(paramNode, "DataType") ?? "BOOL",
              ...(attr(paramNode, "Usage") ? { usage: attr(paramNode, "Usage") } : {}),
              ...(attr(paramNode, "Required") === "true" ? { required: true } : {}),
              ...(paramDesc ? { description: text(paramDesc) } : {}),
            },
          ];
        },
      );
      if (parameters.length > 0) program.parameters = parameters;

      const programTags = extractTags(child(programNode, "Tags"), controllerId, "program", program.id);
      program.programTags.push(...programTags.tags);
      warnings.push(...programTags.warnings);

      const { routines, warnings: routineWarnings } = extractRoutines(
        programNode,
        name,
        program.id,
        registry,
      );
      program.routines.push(...routines);
      warnings.push(...routineWarnings);

      const mainName = attr(programNode, "MainRoutineName");
      const main = mainName
        ? program.routines.find((routine) => routine.name === mainName)
        : program.routines[0];
      if (main) program.mainRoutineId = main.id;

      const faultName = attr(programNode, "FaultRoutineName");
      if (faultName) {
        const fault = program.routines.find((routine) => routine.name === faultName);
        if (fault) program.faultRoutineId = fault.id;
      }

      return [program];
    },
  );

  return { programs, warnings };
}
