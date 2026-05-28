import { createId } from "@esco/shared";
import type { AddOnInstruction, IoModule, UserDefinedType } from "@esco/core";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";

/**
 * Extract the controller's structural metadata that the simulator does not
 * execute but the engineer needs to see: user-defined types, Add-On Instruction
 * definitions, and the I/O module tree. All read-only — imported for display and
 * cross-reference, never executed or used for communication.
 */

/** `<DataTypes><DataType>` → UDT definitions with their members. */
export function extractDataTypes(controllerNode: L5XNode): UserDefinedType[] {
  return toArray<L5XNode>(child(child(controllerNode, "DataTypes"), "DataType")).flatMap((dtNode) => {
    const name = attr(dtNode, "Name");
    if (!name) return [];
    const members = toArray<L5XNode>(child(child(dtNode, "Members"), "Member")).flatMap((memberNode) => {
      const memberName = attr(memberNode, "Name");
      if (!memberName) return [];
      const descriptionNode = child(memberNode, "Description");
      return [
        {
          name: memberName,
          dataType: attr(memberNode, "DataType") ?? "BOOL",
          ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        },
      ];
    });
    return [{ id: createId("udt"), name, members }];
  });
}

/** `<AddOnInstructionDefinitions><AddOnInstructionDefinition>` → AOI definitions. */
export function extractAddOnInstructions(controllerNode: L5XNode): AddOnInstruction[] {
  const container = child(controllerNode, "AddOnInstructionDefinitions");
  return toArray<L5XNode>(child(container, "AddOnInstructionDefinition")).flatMap((aoiNode) => {
    const name = attr(aoiNode, "Name");
    if (!name) return [];
    const descriptionNode = child(aoiNode, "Description");
    return [
      {
        id: createId("aoi"),
        name,
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
      },
    ];
  });
}

/** `<Modules><Module>` → the I/O module tree (offline view; no communication). */
export function extractModules(controllerNode: L5XNode): IoModule[] {
  return toArray<L5XNode>(child(child(controllerNode, "Modules"), "Module")).flatMap((moduleNode) => {
    const name = attr(moduleNode, "Name");
    if (!name) return [];
    const slot = Number(attr(moduleNode, "Slot") ?? "");
    return [
      {
        id: createId("mod"),
        name,
        ...(attr(moduleNode, "CatalogNumber") ? { catalogNumber: attr(moduleNode, "CatalogNumber") } : {}),
        ...(Number.isFinite(slot) ? { slot } : {}),
      },
    ];
  });
}
