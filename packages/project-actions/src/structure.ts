import type { PlcProject, Tag, UserDefinedType } from "@esco/core";
import { rungNodes } from "@esco/ladder";
import { getLadder } from "./helpers";

/** A place an Add-On Instruction is called from a routine. */
export interface AoiReference {
  controllerName: string;
  programName: string;
  routineName: string;
  routineId: string;
  rungNumber: number;
}

/**
 * Find every call of an Add-On Instruction across all routines. An AOI call
 * shows up in ladder as a node whose instruction type is the AOI name.
 */
export function aoiReferences(project: PlcProject, aoiName: string): AoiReference[] {
  const references: AoiReference[] = [];
  const target = aoiName.toUpperCase(); // the rung parser upper-cases instruction types
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          if (rungNodes(rung).some((node) => node.instructionType.toUpperCase() === target)) {
            references.push({
              controllerName: controller.name,
              programName: program.name,
              routineName: routine.name,
              routineId: routine.id,
              rungNumber: rung.number,
            });
          }
        }
      }
    }
  }
  return references;
}

/** A tag whose data type is a given UDT/AOI/structure type. */
export interface TagOfType {
  name: string;
  scope: Tag["scope"];
  programName?: string;
  dimension?: number;
}

/** Every tag in the project whose data type is `typeName` (e.g. instances of a UDT). */
export function tagsUsingType(project: PlcProject, typeName: string): TagOfType[] {
  const results: TagOfType[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      if (tag.dataType === typeName) {
        results.push({ name: tag.name, scope: tag.scope, ...(tag.dimension ? { dimension: tag.dimension } : {}) });
      }
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        if (tag.dataType === typeName) {
          results.push({
            name: tag.name,
            scope: tag.scope,
            programName: program.name,
            ...(tag.dimension ? { dimension: tag.dimension } : {}),
          });
        }
      }
    }
  }
  return results;
}

/** Preview member access paths for a UDT, e.g. `MotorUdt.Status`, `MotorUdt.Speed`. */
export function udtMemberPaths(udt: UserDefinedType): string[] {
  return udt.members.map((member) => `${udt.name}.${member.name}${member.dimension ? `[0]` : ""}`);
}
