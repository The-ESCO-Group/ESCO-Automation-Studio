import {
  createContinuousTask,
  createController,
  createProject,
  type PlcProject,
  type Task,
} from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { attr, child, toArray, type L5XNode } from "./parseL5X";
import { mapTaskType, resolveController } from "./extractController";
import { extractPrograms } from "./extractPrograms";
import { extractTags } from "./extractTags";

export interface ImportResult {
  project: PlcProject;
  warnings: string[];
}

function extractTasks(
  controllerNode: L5XNode,
  controllerId: string,
  programIdByName: Map<string, string>,
): Task[] {
  return toArray<L5XNode>(child(child(controllerNode, "Tasks"), "Task")).flatMap((taskNode) => {
    const name = attr(taskNode, "Name");
    if (!name) return [];
    const scheduled = toArray<L5XNode>(
      child(child(taskNode, "ScheduledPrograms"), "ScheduledProgram"),
    )
      .map((scheduledNode) => programIdByName.get(attr(scheduledNode, "Name") ?? ""))
      .filter((id): id is string => Boolean(id));

    return [
      {
        ...createContinuousTask(controllerId, name, scheduled),
        type: mapTaskType(attr(taskNode, "Type")),
      },
    ];
  });
}

/**
 * Convert a parsed L5X root into the internal domain {@link PlcProject},
 * collecting human-readable warnings for anything imported with caveats.
 */
export function toDomainProject(root: L5XNode, registry: InstructionRegistry): ImportResult {
  const warnings: string[] = [];
  const { node: controllerNode, name: controllerName } = resolveController(root);

  const project = createProject(controllerName, "Imported from an L5X file.");
  const controller = createController(project.id, controllerName);
  controller.processorType = attr(controllerNode, "ProcessorType");

  controller.controllerTags.push(
    ...extractTags(child(controllerNode, "Tags"), controller.id, "controller"),
  );

  const { programs, warnings: programWarnings } = extractPrograms(
    controllerNode,
    controller.id,
    registry,
  );
  controller.programs.push(...programs);
  warnings.push(...programWarnings);

  const programIdByName = new Map(programs.map((program) => [program.name, program.id]));
  const tasks = extractTasks(controllerNode, controller.id, programIdByName);
  controller.tasks.push(
    ...(tasks.length > 0
      ? tasks
      : [createContinuousTask(controller.id, "MainTask", programs.map((p) => p.id))]),
  );

  project.controllers.push(controller);
  return { project, warnings };
}
