import type { Controller, PlcProject, QuickWatchList, QuickWatchTag, Tag } from "@esco/core";

export type ControllerQuickWatchReviewStatus =
  | "reviewable"
  | "needs-attention";

export type ControllerQuickWatchReviewIssue =
  | "no-watch-tags"
  | "duplicate-watch-tag"
  | "unresolved-watch-tag";

export type ControllerQuickWatchReviewBoundary =
  | "no-controller-communication"
  | "no-online-watch-monitoring"
  | "no-live-tag-values"
  | "no-force-or-edit-interaction";

export type ControllerQuickWatchTargetKind =
  | "controller-tag"
  | "program-tag"
  | "program-parameter"
  | "aoi-member"
  | "unresolved";

export interface ControllerQuickWatchTagReviewRow {
  tagId: string;
  specifier: string;
  scope?: string;
  displayPath: string;
  duplicate: boolean;
  resolved: boolean;
  targetKind: ControllerQuickWatchTargetKind;
  targetName?: string;
  description?: string;
}

export interface ControllerQuickWatchReviewRow {
  controllerId: string;
  controllerName: string;
  listId: string;
  listName: string;
  description?: string;
  watchTagCount: number;
  tags: ControllerQuickWatchTagReviewRow[];
  status: ControllerQuickWatchReviewStatus;
  issues: ControllerQuickWatchReviewIssue[];
  controllerCommunicationModelled: false;
  onlineWatchMonitoringModelled: false;
  liveTagValuesModelled: false;
  forceOrEditInteractionModelled: false;
  boundaries: ControllerQuickWatchReviewBoundary[];
  message: string;
}

export interface ControllerQuickWatchReviewReport {
  rows: ControllerQuickWatchReviewRow[];
  controllerCount: number;
  listCount: number;
  watchTagCount: number;
  reviewableCount: number;
  issueCount: number;
  noWatchTagCount: number;
  duplicateWatchTagCount: number;
  unresolvedWatchTagCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerQuickWatchReviewBoundary[] = [
  "no-controller-communication",
  "no-online-watch-monitoring",
  "no-live-tag-values",
  "no-force-or-edit-interaction",
];

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sameName(a: string | undefined, b: string): boolean {
  return (a ?? "").toUpperCase() === b.toUpperCase();
}

function baseSpecifier(specifier: string): string | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(specifier.trim());
  return match?.[0];
}

function programQualified(specifier: string): { scope: string; specifier: string } | undefined {
  const match = /^Program:([^.\s]+)\.(.+)$/i.exec(specifier.trim());
  if (!match) return undefined;
  return { scope: match[1]!, specifier: match[2]!.trim() };
}

function findTag(tags: Tag[], specifier: string): Tag | undefined {
  const base = baseSpecifier(specifier);
  if (!base) return undefined;
  return tags.find((tag) => sameName(tag.name, base));
}

function resolveWatchTag(
  controller: Controller,
  tag: QuickWatchTag,
): { resolved: boolean; targetKind: ControllerQuickWatchTargetKind; targetName?: string; displayPath: string } {
  const rawSpecifier = tag.specifier.trim();
  let specifier = rawSpecifier;
  let scope = clean(tag.scope);

  if (!scope) {
    const qualified = programQualified(specifier);
    if (qualified) {
      scope = qualified.scope;
      specifier = qualified.specifier;
    }
  }

  const displayPath = scope ? `${scope}:${specifier}` : specifier;
  const base = baseSpecifier(specifier);
  if (!base) return { resolved: false, targetKind: "unresolved", displayPath };

  if (scope) {
    const program = controller.programs.find((candidate) => sameName(candidate.name, scope));
    if (program) {
      const programTag = findTag(program.programTags, specifier);
      if (programTag) {
        return { resolved: true, targetKind: "program-tag", targetName: programTag.name, displayPath };
      }
      const parameter = program.parameters?.find((candidate) => sameName(candidate.name, base));
      if (parameter) {
        return { resolved: true, targetKind: "program-parameter", targetName: parameter.name, displayPath };
      }
    }

    const aoi = controller.addOnInstructions.find((candidate) => sameName(candidate.name, scope));
    if (aoi) {
      const member =
        aoi.parameters.find((candidate) => sameName(candidate.name, base)) ??
        aoi.localTags.find((candidate) => sameName(candidate.name, base));
      if (member) {
        return { resolved: true, targetKind: "aoi-member", targetName: member.name, displayPath };
      }
    }

    return { resolved: false, targetKind: "unresolved", displayPath };
  }

  const controllerTag = findTag(controller.controllerTags, specifier);
  if (controllerTag) {
    return { resolved: true, targetKind: "controller-tag", targetName: controllerTag.name, displayPath };
  }

  return { resolved: false, targetKind: "unresolved", displayPath };
}

function duplicateKeys(list: QuickWatchList): Set<string> {
  const counts = new Map<string, number>();
  for (const tag of list.tags) {
    const key = `${clean(tag.scope) ?? ""}\0${tag.specifier.trim()}`.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function tagRows(controller: Controller, list: QuickWatchList): ControllerQuickWatchTagReviewRow[] {
  const duplicates = duplicateKeys(list);
  return list.tags.map((tag) => {
    const key = `${clean(tag.scope) ?? ""}\0${tag.specifier.trim()}`.toUpperCase();
    const resolution = resolveWatchTag(controller, tag);
    return {
      tagId: tag.id,
      specifier: tag.specifier,
      ...(clean(tag.scope) ? { scope: clean(tag.scope) } : {}),
      displayPath: resolution.displayPath,
      duplicate: duplicates.has(key),
      resolved: resolution.resolved,
      targetKind: resolution.targetKind,
      ...(resolution.targetName ? { targetName: resolution.targetName } : {}),
      ...(tag.description ? { description: tag.description } : {}),
    };
  });
}

function issuesFor(list: QuickWatchList, rows: ControllerQuickWatchTagReviewRow[]): ControllerQuickWatchReviewIssue[] {
  const issues: ControllerQuickWatchReviewIssue[] = [];
  if (list.tags.length === 0) issues.push("no-watch-tags");
  if (rows.some((row) => row.duplicate)) issues.push("duplicate-watch-tag");
  if (rows.some((row) => !row.resolved)) issues.push("unresolved-watch-tag");
  return issues;
}

function issueLabel(issue: ControllerQuickWatchReviewIssue): string {
  switch (issue) {
    case "no-watch-tags":
      return "no watch tags are configured";
    case "duplicate-watch-tag":
      return "duplicate watch tags are configured";
    case "unresolved-watch-tag":
      return "one or more watch tags do not resolve to imported tags or parameters";
  }
}

function messageFor(row: Omit<ControllerQuickWatchReviewRow, "message">): string {
  if (row.issues.length) {
    return `Quick Watch List "${row.listName}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  return `Quick Watch List "${row.listName}" is reviewable offline with ${row.watchTagCount} watch tag(s); online monitoring and live values are not modelled.`;
}

export function controllerQuickWatchReviewReport(project: PlcProject): ControllerQuickWatchReviewReport {
  const rows: ControllerQuickWatchReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const list of controller.quickWatchLists ?? []) {
      const tags = tagRows(controller, list);
      const issues = issuesFor(list, tags);
      const rowBase = {
        controllerId: controller.id,
        controllerName: controller.name,
        listId: list.id,
        listName: list.name,
        description: list.description,
        watchTagCount: list.tags.length,
        tags,
        status: issues.length ? "needs-attention" as const : "reviewable" as const,
        issues,
        controllerCommunicationModelled: false as const,
        onlineWatchMonitoringModelled: false as const,
        liveTagValuesModelled: false as const,
        forceOrEditInteractionModelled: false as const,
        boundaries: [...BOUNDARIES],
      };
      rows.push({ ...rowBase, message: messageFor(rowBase) });
    }
  }

  const hasIssue = (issue: ControllerQuickWatchReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: project.controllers.length,
    listCount: rows.length,
    watchTagCount: rows.reduce((sum, row) => sum + row.watchTagCount, 0),
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    noWatchTagCount: hasIssue("no-watch-tags"),
    duplicateWatchTagCount: hasIssue("duplicate-watch-tag"),
    unresolvedWatchTagCount: hasIssue("unresolved-watch-tag"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
