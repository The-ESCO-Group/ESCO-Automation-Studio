import {
  createContinuousTask,
  createController,
  createProject,
  type PlcProject,
  type Task,
} from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { attr, child, toArray, type L5XNode } from "./parseL5X";
import { mapTaskType, resolveController } from "./extractController";
import { extractPrograms } from "./extractPrograms";
import { extractTags } from "./extractTags";
import { extractAddOnInstructions, extractDataTypes, extractModules } from "./extractStructure";

/** A human-/UI-readable summary of what an import produced. */
export interface ImportSummary {
  programs: number;
  routines: number;
  rungs: number;
  tags: number;
  unsupportedInstructions: string[];
  warnings: string[];
  /** Wall-clock import time in milliseconds (set by importL5X). */
  durationMs?: number;
}

export interface ImportResult {
  project: PlcProject;
  warnings: string[];
  summary: ImportSummary;
}

function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function summarize(project: PlcProject, warnings: string[], registry: InstructionRegistry): ImportSummary {
  let routines = 0;
  let rungs = 0;
  let tags = 0;
  const unsupported = new Set<string>();

  for (const controller of project.controllers) {
    tags += controller.controllerTags.length;
    for (const program of controller.programs) {
      tags += program.programTags.length;
      for (const routine of program.routines) {
        routines += 1;
        const ladder = asLadderRoutine(routine.ladder);
        if (!ladder) continue;
        rungs += ladder.rungs.length;
        for (const node of routineNodes(ladder)) {
          if (!registry.get(node.instructionType)) unsupported.add(node.instructionType);
        }
      }
    }
  }

  const programs = project.controllers.reduce((sum, c) => sum + c.programs.length, 0);
  return {
    programs,
    routines,
    rungs,
    tags,
    unsupportedInstructions: [...unsupported].sort(),
    warnings,
  };
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

    const watchdog = Number(attr(taskNode, "Watchdog") ?? "");
    const priority = Number(attr(taskNode, "Priority") ?? "");
    const rate = Number(attr(taskNode, "Rate") ?? "");
    return [
      {
        ...createContinuousTask(controllerId, name, scheduled),
        type: mapTaskType(attr(taskNode, "Type")),
        ...(Number.isFinite(watchdog) && watchdog > 0 ? { watchdogMs: watchdog } : {}),
        ...(Number.isFinite(priority) && priority > 0 ? { priority } : {}),
        ...(Number.isFinite(rate) && rate > 0 ? { periodMs: rate } : {}),
        ...(attr(taskNode, "InhibitTask") === "true" ? { inhibited: true } : {}),
      },
    ];
  });
}

/** Read controller catalog/firmware/handler metadata (read-only; no controller communication). */
function applyControllerMetadata(controller: { firmwareRevision?: string; catalogNumber?: string; chassis?: string; slot?: number; faultRoutineName?: string; powerUpRoutineName?: string }, controllerNode: L5XNode): void {
  const major = attr(controllerNode, "MajorRev");
  const minor = attr(controllerNode, "MinorRev");
  if (major) controller.firmwareRevision = minor ? `${major}.${minor}` : major;
  const catalog = attr(controllerNode, "CatalogNumber") ?? attr(controllerNode, "ProcessorType");
  if (catalog) controller.catalogNumber = catalog;
  const slot = Number(attr(controllerNode, "Slot") ?? "");
  if (Number.isFinite(slot) && (attr(controllerNode, "Slot") ?? "") !== "") controller.slot = slot;
  const chassis = attr(controllerNode, "ChassisType") ?? attr(controllerNode, "Chassis");
  if (chassis) controller.chassis = chassis;
  const faultHandler = attr(controllerNode, "FaultHandler") ?? attr(controllerNode, "FaultRoutineName");
  if (faultHandler) controller.faultRoutineName = faultHandler;
  const powerUp = attr(controllerNode, "PowerLossHandler") ?? attr(controllerNode, "PowerUpHandler");
  if (powerUp) controller.powerUpRoutineName = powerUp;
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
  applyControllerMetadata(controller, controllerNode);

  const controllerTags = extractTags(child(controllerNode, "Tags"), controller.id, "controller");
  controller.controllerTags.push(...controllerTags.tags);
  warnings.push(...controllerTags.warnings);

  // Structural metadata (read-only): UDTs, AOI definitions, and the I/O tree.
  controller.dataTypes.push(...extractDataTypes(controllerNode));
  controller.addOnInstructions.push(...extractAddOnInstructions(controllerNode));
  controller.ioConfiguration.modules.push(...extractModules(controllerNode));

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
  return { project, warnings, summary: summarize(project, warnings, registry) };
}
