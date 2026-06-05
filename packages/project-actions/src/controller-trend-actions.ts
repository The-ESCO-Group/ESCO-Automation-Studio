import type { Controller, ControllerTrend, PlcProject, Tag } from "@esco/core";
import { createId, nowIso } from "@esco/shared";
import { fail, ok } from "./helpers";
import { logixIdentifierError } from "./logix-names";
import type { CreateControllerTrendInput, DeleteControllerTrendInput, ProjectActionResult } from "./types";

function sameName(left: string | undefined, right: string): boolean {
  return (left ?? "").toLowerCase() === right.toLowerCase();
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function nextTrendName(controller: Controller): string {
  const existing = new Set((controller.trends ?? []).map((trend) => trend.name.toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Trend_${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `Trend_${(controller.trends ?? []).length + 1}`;
}

function firstTrendTag(controller: Controller): Tag | undefined {
  return controller.controllerTags[0] ?? controller.programs.flatMap((program) => program.programTags)[0];
}

export function createControllerTrend(
  project: PlcProject,
  input: CreateControllerTrendInput,
): ProjectActionResult<{ controllerId: string; trendId: string; trendName: string; seededPenName?: string }> {
  const controllerId = input.controllerId?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);

  const name = optionalText(input.name) ?? nextTrendName(controller);
  const invalidName = logixIdentifierError(name, "Trend");
  if (invalidName) return fail(project, invalidName);
  if ((controller.trends ?? []).some((trend) => sameName(trend.name, name))) {
    return fail(project, `Trend "${name}" already exists in that controller.`);
  }

  const seedTag = input.seedFirstTag === false ? undefined : firstTrendTag(controller);
  const trend: ControllerTrend = {
    id: createId("trend"),
    name,
    description: optionalText(input.description) ?? "Offline controller trend definition.",
    pens: seedTag
      ? [{ id: createId("pen"), name: seedTag.name, description: `Seeded from ${seedTag.name}` }]
      : [],
  };
  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controller.id ? { ...candidate, trends: [...(candidate.trends ?? []), trend] } : candidate,
    ),
  };

  return ok(next, {
    controllerId: controller.id,
    trendId: trend.id,
    trendName: trend.name,
    ...(seedTag ? { seededPenName: seedTag.name } : {}),
  });
}

export function deleteControllerTrend(
  project: PlcProject,
  input: DeleteControllerTrendInput,
): ProjectActionResult<{ controllerId: string; trendId: string; trendName: string }> {
  const controllerId = input.controllerId?.trim();
  const trendId = input.trendId?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!trendId) return fail(project, "Trend id is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);
  const trend = (controller.trends ?? []).find((candidate) => candidate.id === trendId);
  if (!trend) return fail(project, `Trend "${trendId}" not found.`);

  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controller.id
        ? { ...candidate, trends: (candidate.trends ?? []).filter((existing) => existing.id !== trendId) }
        : candidate,
    ),
  };

  return ok(next, { controllerId: controller.id, trendId: trend.id, trendName: trend.name });
}
