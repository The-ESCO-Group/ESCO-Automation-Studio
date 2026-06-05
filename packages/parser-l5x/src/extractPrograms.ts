import { createProgram, type Program } from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { extractRoutines } from "./extractRoutines";
import { extractTags, parseExternalAccess } from "./extractTags";
import { dimensionProps } from "./dimensions";

export interface ExtractedPrograms {
  programs: Program[];
  warnings: string[];
}

/** Extract `<Program>` elements: their program-scoped tags and routines. */
export function extractPrograms(
  controllerNode: L5XNode,
  controllerId: string,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string> = new Set(),
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
      // Safety partition ("Safety" / "Standard") is preserved verbatim (read-only
      // metadata; never used to schedule a safety task) so it round-trips on
      // export (mirrors tag Class handling).
      const safetyClass = attr(programNode, "Class");
      if (safetyClass) program.safetyClass = safetyClass;
      // Folder/organizer programs carry UseAsFolder="true" and no main routine.
      // Preserved verbatim (read-only metadata; never scheduled) so the folder
      // designation round-trips on export.
      if (attr(programNode, "UseAsFolder") === "true") program.useAsFolder = true;
      // Pending online test edits (TestEdits="true") are preserved verbatim
      // (read-only metadata; this tool is offline-only and never accepts/cancels
      // test edits) so the flag round-trips on export (mirrors Disabled above).
      if (attr(programNode, "TestEdits") === "true") program.testEdits = true;

      // Program parameters (Input/Output/InOut) — read-only imported metadata.
      const parameters = toArray<L5XNode>(child(child(programNode, "Parameters"), "Parameter")).flatMap(
        (paramNode) => {
          const paramName = attr(paramNode, "Name");
          if (!paramName) return [];
          const paramDesc = child(paramNode, "Description");
          const defaultValue = attr(paramNode, "Default");
          // Display radix and external access are preserved verbatim (display-only
          // metadata; never parsed or validated) so they round-trip (mirrors AOI
          // parameters).
          const radix = attr(paramNode, "Radix");
          const externalAccess = parseExternalAccess(attr(paramNode, "ExternalAccess"));
          return [
            {
              name: paramName,
              dataType: attr(paramNode, "DataType") ?? "BOOL",
              ...(attr(paramNode, "Usage") ? { usage: attr(paramNode, "Usage") } : {}),
              ...(attr(paramNode, "Required") === "true" ? { required: true } : {}),
              // Parameter-face visibility (independent of Required); preserve the
              // explicit Visible="true" so the program parameter face round-trips
              // (mirrors AOI parameters).
              ...(attr(paramNode, "Visible") === "true" ? { visible: true } : {}),
              // Array parameters (commonly InOut arrays passed by reference) carry a
              // Dimensions attribute; preserve it so the array-ness round-trips on export.
              ...dimensionProps(attr(paramNode, "Dimensions")),
              ...(defaultValue != null ? { defaultValue } : {}),
              ...(paramDesc ? { description: text(paramDesc) } : {}),
              ...(radix ? { radix } : {}),
              ...(externalAccess ? { externalAccess } : {}),
              // Constant input parameters carry Constant="true"; preserve it
              // verbatim (read-only metadata) so it round-trips (mirrors tags).
              ...(attr(paramNode, "Constant") === "true" ? { constant: true } : {}),
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
        knownInstructionTypes,
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
