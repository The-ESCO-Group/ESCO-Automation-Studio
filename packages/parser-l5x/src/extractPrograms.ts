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

      return [program];
    },
  );

  return { programs, warnings };
}
