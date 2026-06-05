import type { Controller, PlcProject, Tag, Task, TaskType } from "@esco/core";

export type EventTaskReviewStatus = "reviewable" | "needs-attention";

export type EventTaskReviewIssue =
  | "event-info-on-non-event-task"
  | "missing-event-trigger"
  | "missing-event-tag"
  | "unresolved-event-tag";

export type EventTaskReviewBoundary =
  | "no-controller-event-scheduling"
  | "no-event-trigger-monitoring"
  | "no-event-instruction-dispatch"
  | "no-event-timeout-watchdog"
  | "no-module-input-state-change-monitor"
  | "no-consumed-tag-trigger-transfer";

export type EventTaskTagScope = "controller" | "qualified-program" | "unresolved";

export interface EventTaskTagReference {
  path: string;
  baseTag: string;
  programName?: string;
  scope: EventTaskTagScope;
  resolved: boolean;
  tagId?: string;
  tagName?: string;
  dataType?: string;
}

export interface EventTaskReviewRow {
  controllerId: string;
  controllerName: string;
  taskId: string;
  taskName: string;
  taskType: TaskType;
  eventInfoPresent: boolean;
  eventTrigger?: string;
  eventTag?: string;
  enableTimeout?: boolean;
  enableTimeoutPresent: boolean;
  tagReference?: EventTaskTagReference;
  scheduledProgramCount: number;
  scheduledProgramIds: string[];
  priority?: number;
  watchdogMs?: number;
  inhibited: boolean;
  outputUpdateDisabled: boolean;
  status: EventTaskReviewStatus;
  issues: EventTaskReviewIssue[];
  eventSchedulingModelled: false;
  triggerMonitoringModelled: false;
  eventInstructionDispatchModelled: false;
  eventTimeoutWatchdogModelled: false;
  boundaries: EventTaskReviewBoundary[];
  message: string;
}

export interface EventTaskReviewReport {
  rows: EventTaskReviewRow[];
  eventTaskCount: number;
  taskWithEventInfoCount: number;
  timeoutMetadataCount: number;
  timeoutEnabledCount: number;
  reviewableCount: number;
  issueCount: number;
  tagBoundCount: number;
  resolvedTagCount: number;
  missingTriggerCount: number;
  missingTagCount: number;
  unresolvedTagCount: number;
  nonEventInfoCount: number;
  warnings: string[];
}

const BASE_BOUNDARIES: EventTaskReviewBoundary[] = [
  "no-controller-event-scheduling",
  "no-event-trigger-monitoring",
  "no-event-instruction-dispatch",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function triggerNeedsTag(trigger: string | undefined): boolean {
  const normalized = trigger?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (normalized.includes("instruction only")) return false;
  return normalized.includes("tag") || normalized.includes("connection") || normalized.includes("module");
}

function boundariesFor(task: Task): EventTaskReviewBoundary[] {
  const trigger = task.eventInfo?.eventTrigger;
  const normalized = trigger?.trim().toLowerCase() ?? "";
  const boundaries = new Set<EventTaskReviewBoundary>(BASE_BOUNDARIES);
  if (task.eventInfo?.enableTimeout !== undefined) boundaries.add("no-event-timeout-watchdog");
  if (normalized.includes("module")) boundaries.add("no-module-input-state-change-monitor");
  if (normalized.includes("consumed") || normalized.includes("connection")) {
    boundaries.add("no-consumed-tag-trigger-transfer");
  }
  return [...boundaries];
}

function baseTagFrom(path: string): string {
  return path.split(/[.[\]]/)[0] ?? path;
}

function parseProgramPath(path: string): { programName?: string; baseTag: string } {
  const qualified = /^Program:([^.]+)\.(.+)$/.exec(path.trim());
  if (!qualified) return { baseTag: baseTagFrom(path.trim()) };
  return {
    programName: qualified[1],
    baseTag: baseTagFrom(qualified[2] ?? ""),
  };
}

function tagReference(path: string, tag: Tag | undefined, scope: EventTaskTagScope, programName?: string): EventTaskTagReference {
  return {
    path,
    baseTag: parseProgramPath(path).baseTag,
    programName,
    scope,
    resolved: Boolean(tag),
    tagId: tag?.id,
    tagName: tag?.name,
    dataType: tag?.dataType,
  };
}

function resolveEventTag(controller: Controller, path: string | undefined): EventTaskTagReference | undefined {
  if (blank(path)) return undefined;
  const trimmed = path!.trim();
  const parsed = parseProgramPath(trimmed);
  if (parsed.programName) {
    const program = controller.programs.find((candidate) => candidate.name === parsed.programName);
    const tag = program?.programTags.find((candidate) => candidate.name === parsed.baseTag);
    return tagReference(trimmed, tag, tag ? "qualified-program" : "unresolved", parsed.programName);
  }
  const tag = controller.controllerTags.find((candidate) => candidate.name === parsed.baseTag);
  return tagReference(trimmed, tag, tag ? "controller" : "unresolved");
}

function issuesFor(task: Task, tag: EventTaskTagReference | undefined): EventTaskReviewIssue[] {
  const issues: EventTaskReviewIssue[] = [];
  if (task.type !== "event" && task.eventInfo) issues.push("event-info-on-non-event-task");
  if (task.type === "event" && blank(task.eventInfo?.eventTrigger)) issues.push("missing-event-trigger");
  if (task.type === "event" && triggerNeedsTag(task.eventInfo?.eventTrigger) && blank(task.eventInfo?.eventTag)) {
    issues.push("missing-event-tag");
  }
  if (tag && !tag.resolved) issues.push("unresolved-event-tag");
  return issues;
}

function issueLabel(issue: EventTaskReviewIssue): string {
  switch (issue) {
    case "event-info-on-non-event-task":
      return "EventInfo is attached to a non-EVENT task";
    case "missing-event-trigger":
      return "missing event trigger";
    case "missing-event-tag":
      return "missing event tag";
    case "unresolved-event-tag":
      return "event tag is not imported";
  }
}

function messageFor(row: Omit<EventTaskReviewRow, "message">): string {
  if (row.issues.length) {
    return `Event task "${row.taskName}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  const trigger = row.eventTrigger ?? "unspecified trigger";
  const tag = row.eventTag ? ` bound to "${row.eventTag}"` : "";
  const timeout = row.enableTimeoutPresent ? ", timeout/watchdog behavior" : "";
  return `Event task "${row.taskName}" trigger "${trigger}"${tag} is reviewable offline; controller event scheduling, trigger dispatch${timeout} are not modelled.`;
}

function rowFor(controller: Controller, task: Task): EventTaskReviewRow {
  const tag = resolveEventTag(controller, task.eventInfo?.eventTag);
  const issues = issuesFor(task, tag);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    taskId: task.id,
    taskName: task.name,
    taskType: task.type,
    eventInfoPresent: task.eventInfo != null,
    eventTrigger: task.eventInfo?.eventTrigger,
    eventTag: task.eventInfo?.eventTag,
    enableTimeout: task.eventInfo?.enableTimeout,
    enableTimeoutPresent: task.eventInfo?.enableTimeout !== undefined,
    tagReference: tag,
    scheduledProgramCount: task.scheduledProgramIds.length,
    scheduledProgramIds: [...task.scheduledProgramIds],
    priority: task.priority,
    watchdogMs: task.watchdogMs,
    inhibited: Boolean(task.inhibited),
    outputUpdateDisabled: Boolean(task.disableUpdateOutputs),
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    eventSchedulingModelled: false as const,
    triggerMonitoringModelled: false as const,
    eventInstructionDispatchModelled: false as const,
    eventTimeoutWatchdogModelled: false as const,
    boundaries: boundariesFor(task),
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function eventTaskReviewReport(project: PlcProject): EventTaskReviewReport {
  const rows: EventTaskReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const task of controller.tasks) {
      if (task.type === "event" || task.eventInfo) rows.push(rowFor(controller, task));
    }
  }

  const hasIssue = (issue: EventTaskReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  const tagRows = rows.filter((row) => row.tagReference);

  return {
    rows,
    eventTaskCount: rows.filter((row) => row.taskType === "event").length,
    taskWithEventInfoCount: rows.filter((row) => row.eventInfoPresent).length,
    timeoutMetadataCount: rows.filter((row) => row.enableTimeoutPresent).length,
    timeoutEnabledCount: rows.filter((row) => row.enableTimeout === true).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.status === "needs-attention").length,
    tagBoundCount: tagRows.length,
    resolvedTagCount: tagRows.filter((row) => row.tagReference?.resolved).length,
    missingTriggerCount: hasIssue("missing-event-trigger"),
    missingTagCount: hasIssue("missing-event-tag"),
    unresolvedTagCount: hasIssue("unresolved-event-tag"),
    nonEventInfoCount: hasIssue("event-info-on-non-event-task"),
    warnings: rows.filter((row) => row.status === "needs-attention").map((row) => row.message),
  };
}
