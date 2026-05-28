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
      const dimension = Number(attr(memberNode, "Dimension") ?? "");
      return [
        {
          name: memberName,
          dataType: attr(memberNode, "DataType") ?? "BOOL",
          ...(Number.isFinite(dimension) && dimension > 0 ? { dimension } : {}),
          ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        },
      ];
    });
    return [{ id: createId("udt"), name, members }];
  });
}

/**
 * `<AddOnInstructionDefinitions><AddOnInstructionDefinition>` → AOI definitions
 * with parameters, local tags, and the names of their routines (logic preserved
 * read-only; not executed by the simulator).
 */
export function extractAddOnInstructions(controllerNode: L5XNode): AddOnInstruction[] {
  const container = child(controllerNode, "AddOnInstructionDefinitions");
  return toArray<L5XNode>(child(container, "AddOnInstructionDefinition")).flatMap((aoiNode) => {
    const name = attr(aoiNode, "Name");
    if (!name) return [];
    const descriptionNode = child(aoiNode, "Description");
    const revision = attr(aoiNode, "Revision");

    const parameters = toArray<L5XNode>(child(child(aoiNode, "Parameters"), "Parameter")).flatMap(
      (paramNode) => {
        const paramName = attr(paramNode, "Name");
        if (!paramName) return [];
        const usage = attr(paramNode, "Usage");
        const defaultValue = attr(paramNode, "Default");
        const paramDesc = child(paramNode, "Description");
        return [
          {
            name: paramName,
            dataType: attr(paramNode, "DataType") ?? "BOOL",
            ...(usage ? { usage } : {}),
            ...(attr(paramNode, "Required") === "true" ? { required: true } : {}),
            ...(defaultValue != null ? { defaultValue } : {}),
            ...(paramDesc ? { description: text(paramDesc) } : {}),
          },
        ];
      },
    );

    const localTags = toArray<L5XNode>(child(child(aoiNode, "LocalTags"), "LocalTag")).flatMap(
      (tagNode) => {
        const tagName = attr(tagNode, "Name");
        if (!tagName) return [];
        const tagDesc = child(tagNode, "Description");
        return [
          {
            name: tagName,
            dataType: attr(tagNode, "DataType") ?? "BOOL",
            ...(tagDesc ? { description: text(tagDesc) } : {}),
          },
        ];
      },
    );

    const routineNames = toArray<L5XNode>(child(child(aoiNode, "Routines"), "Routine"))
      .map((routineNode) => attr(routineNode, "Name"))
      .filter((routineName): routineName is string => Boolean(routineName));

    return [
      {
        id: createId("aoi"),
        name,
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(revision ? { revision } : {}),
        parameters,
        localTags,
        routineNames,
      },
    ];
  });
}

/** `<Modules><Module>` → the I/O module tree (offline view; no communication). */
export function extractModules(controllerNode: L5XNode): IoModule[] {
  return toArray<L5XNode>(child(child(controllerNode, "Modules"), "Module")).flatMap((moduleNode) => {
    const name = attr(moduleNode, "Name");
    if (!name) return [];
    const catalogNumber = attr(moduleNode, "CatalogNumber");
    const parentModule = attr(moduleNode, "ParentModule");
    const commPath = attr(moduleNode, "CommPath") ?? attr(moduleNode, "CommMethod");
    const descriptionNode = child(moduleNode, "Description");

    // Slot is sometimes a direct attribute and sometimes a Ports/Port Address.
    let slotText = attr(moduleNode, "Slot");
    if (slotText == null) {
      const port = toArray<L5XNode>(child(child(moduleNode, "Ports"), "Port"))[0];
      slotText = port ? attr(port, "Address") : undefined;
    }
    const slot = Number(slotText ?? "");

    return [
      {
        id: createId("mod"),
        name,
        ...(catalogNumber ? { catalogNumber } : {}),
        ...(Number.isFinite(slot) ? { slot } : {}),
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(parentModule ? { parentModule } : {}),
        ...(commPath ? { commPath } : {}),
      },
    ];
  });
}
