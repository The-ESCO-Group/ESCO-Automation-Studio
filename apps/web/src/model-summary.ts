import type { PlcProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { rungNodes, type LadderRoutine } from "@esco/ladder";
import { getLadder } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";

const registry = createDefaultRegistry();

export interface ModelCounts {
  controllers: number;
  tasks: number;
  programs: number;
  routines: number;
  controllerTags: number;
  programTags: number;
  tags: number;
  aois: number;
  udts: number;
  ioModules: number;
  rungs: number;
}

export interface UnsupportedInstruction {
  type: string;
  count: number;
}

export interface ModelSummary {
  projectName: string;
  controllerName?: string;
  processorType?: string;
  counts: ModelCounts;
  errorCount: number;
  warningCount: number;
  /** Instruction types present in the project that the registry does not support, with occurrence counts. */
  unsupportedInstructions: UnsupportedInstruction[];
  unsupportedTotal: number;
}

/**
 * Aggregate read-only counts and health for the whole project. Pure and
 * dependency-light so it can be unit-tested and memoized in the UI. Unsupported
 * instructions are detected by scanning every ladder rung against the
 * instruction registry — the same registry the editor uses as source of truth.
 */
export function buildModelSummary(
  project: PlcProject,
  findings: ValidationFinding[] = [],
): ModelSummary {
  let tasks = 0;
  let programs = 0;
  let routines = 0;
  let controllerTags = 0;
  let programTags = 0;
  let aois = 0;
  let udts = 0;
  let ioModules = 0;
  let rungs = 0;
  const unsupported = new Map<string, number>();

  for (const controller of project.controllers) {
    tasks += controller.tasks.length;
    controllerTags += controller.controllerTags.length;
    aois += controller.addOnInstructions.length;
    udts += controller.dataTypes.length;
    ioModules += controller.ioConfiguration.modules.length;
    for (const program of controller.programs) {
      programs += 1;
      programTags += program.programTags.length;
      for (const routine of program.routines) {
        routines += 1;
        const ladder = getLadder(routine) as LadderRoutine | undefined;
        if (!ladder) continue;
        rungs += ladder.rungs.length;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            if (!registry.has(node.instructionType)) {
              unsupported.set(node.instructionType, (unsupported.get(node.instructionType) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  const firstController = project.controllers[0];
  const unsupportedInstructions = [...unsupported.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    projectName: project.name,
    controllerName: firstController?.name,
    processorType: firstController?.processorType,
    counts: {
      controllers: project.controllers.length,
      tasks,
      programs,
      routines,
      controllerTags,
      programTags,
      tags: controllerTags + programTags,
      aois,
      udts,
      ioModules,
      rungs,
    },
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    unsupportedInstructions,
    unsupportedTotal: unsupportedInstructions.reduce((sum, u) => sum + u.count, 0),
  };
}
