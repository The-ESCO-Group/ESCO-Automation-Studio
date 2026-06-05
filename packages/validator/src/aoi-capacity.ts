import type { AddOnInstruction, PlcProject } from "@esco/core";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

const MAX_AOI_IO_LOCAL_COUNT = 512;
const LEGACY_V28_MAX_INOUT_PARAMETERS = 40;
const MODERN_MAX_INOUT_PARAMETERS = 64;
const MAX_AOI_NESTING_DEPTH = 16;

/**
 * Controller-editor rules bound Add-On Instruction definitions beyond ordinary
 * name/type checks: Input + Output parameters + local tags can total at most
 * 512; InOut parameters are capped by authoring software revision (40 in v28,
 * 64 in v29+); and nested AOI calls can be at most 16 levels deep.
 * Source-protected and non-ladder AOI bodies are opaque here, matching the
 * simulator boundary.
 */

function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (
    ladder &&
    typeof ladder === "object" &&
    Array.isArray((ladder as { rungs?: unknown }).rungs)
  ) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function softwareMajorRevision(softwareRevision: string | undefined): number | undefined {
  const match = softwareRevision?.match(/\d+/);
  if (!match) return undefined;
  const major = Number(match[0]);
  return Number.isFinite(major) ? major : undefined;
}

function inOutLimit(aoi: AddOnInstruction): { limit?: number; label: string } {
  const major = softwareMajorRevision(aoi.softwareRevision);
  if (major !== undefined && major <= 27) return { label: "authoring software v27 and earlier" };
  if (major === 28) return { limit: LEGACY_V28_MAX_INOUT_PARAMETERS, label: "authoring software v28" };
  return { limit: MODERN_MAX_INOUT_PARAMETERS, label: "authoring software v29 and later" };
}

function isInputOrOutput(usage: string | undefined): boolean {
  const lower = usage?.toLowerCase();
  return lower === "input" || lower === "output";
}

function isInOut(usage: string | undefined): boolean {
  return usage?.toLowerCase() === "inout";
}

function calledAoiNames(aoi: AddOnInstruction, aoiNames: ReadonlySet<string>): Set<string> {
  const called = new Set<string>();
  if (aoi.protected) return called;
  for (const routine of aoi.routines ?? []) {
    const ladder = asLadderRoutine(routine.ladder);
    if (!ladder) continue;
    for (const node of routineNodes(ladder)) {
      const target = node.instructionType.toUpperCase();
      if (aoiNames.has(target)) called.add(target);
    }
  }
  return called;
}

interface NestingChain {
  depth: number;
  path: string[];
}

function longestNestingChain(start: string, edges: ReadonlyMap<string, ReadonlySet<string>>): NestingChain {
  const dfs = (node: string, stack: ReadonlySet<string>): NestingChain => {
    let best: NestingChain = { depth: 0, path: [node] };
    for (const next of edges.get(node) ?? []) {
      if (stack.has(next)) continue;
      const nextStack = new Set(stack);
      nextStack.add(next);
      const child = dfs(next, nextStack);
      const candidate = { depth: child.depth + 1, path: [node, ...child.path] };
      if (candidate.depth > best.depth) best = candidate;
    }
    return best;
  };
  return dfs(start, new Set([start]));
}

export const aoiCapacity: ValidationRule = {
  id: "aoi-capacity",
  name: "AOI capacity",
  category: "project-structure",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      const displayName = new Map<string, string>();
      for (const aoi of controller.addOnInstructions) {
        const key = aoi.name.toUpperCase();
        if (!displayName.has(key)) displayName.set(key, aoi.name);

        const inputOutputCount = aoi.parameters.filter((parameter) =>
          isInputOrOutput(parameter.usage),
        ).length;
        const inputOutputLocalCount = inputOutputCount + aoi.localTags.length;
        if (inputOutputLocalCount > MAX_AOI_IO_LOCAL_COUNT) {
          findings.push({
            ruleId: "aoi-capacity",
            severity: "error",
            message: `AOI "${aoi.name}" has ${inputOutputLocalCount} Input/Output parameters plus local tags; controller-editor rules permit at most ${MAX_AOI_IO_LOCAL_COUNT}.`,
            target: `${controller.name}/${aoi.name}`,
          });
        }

        const inOutCount = aoi.parameters.filter((parameter) => isInOut(parameter.usage)).length;
        const limit = inOutLimit(aoi);
        if (limit.limit !== undefined && inOutCount > limit.limit) {
          findings.push({
            ruleId: "aoi-capacity",
            severity: "error",
            message: `AOI "${aoi.name}" has ${inOutCount} InOut parameters; ${limit.label} permits at most ${limit.limit}.`,
            target: `${controller.name}/${aoi.name}`,
          });
        }
      }

      const aoiNames = new Set(displayName.keys());
      const edges = new Map<string, Set<string>>();
      for (const aoi of controller.addOnInstructions) {
        edges.set(aoi.name.toUpperCase(), calledAoiNames(aoi, aoiNames));
      }

      for (const aoi of controller.addOnInstructions) {
        const chain = longestNestingChain(aoi.name.toUpperCase(), edges);
        if (chain.depth <= MAX_AOI_NESTING_DEPTH) continue;
        const path = chain.path.map((name) => displayName.get(name) ?? name).join(" -> ");
        findings.push({
          ruleId: "aoi-capacity",
          severity: "error",
          message: `AOI "${aoi.name}" nests Add-On Instruction calls ${chain.depth} levels deep (${path}); controller-editor rules permit at most ${MAX_AOI_NESTING_DEPTH} nested AOI levels.`,
          target: `${controller.name}/${aoi.name}`,
        });
      }
    }

    return findings;
  },
};
