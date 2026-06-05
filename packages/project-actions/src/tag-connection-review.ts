import type { Controller, PlcProject, Program, Tag } from "@esco/core";

export type TagConnectionRole = "produced" | "consumed" | "conflicting";

export type TagConnectionStatus = "reviewable" | "needs-attention";

export type TagConnectionIssue =
  | "program-scoped"
  | "both-produced-and-consumed"
  | "missing-producing-controller"
  | "missing-remote-tag"
  | "invalid-consumed-rpi"
  | "invalid-produce-count";

export type TagConnectionBoundary =
  | "no-controller-communication"
  | "no-produced-tag-connection"
  | "no-consumed-tag-connection"
  | "no-remote-controller-browse"
  | "no-rpi-scheduling";

export interface TagConnectionReviewRow {
  controllerId: string;
  controllerName: string;
  programId?: string;
  programName?: string;
  tagId: string;
  tagName: string;
  dataType: string;
  scope: "controller" | "program";
  role: TagConnectionRole;
  status: TagConnectionStatus;
  issues: TagConnectionIssue[];
  produceCount?: number;
  unicastPermitted?: boolean;
  programmaticallySendEventTrigger?: boolean;
  producer?: string;
  remoteTag?: string;
  remoteInstance?: string;
  rpi?: number;
  unicast?: boolean;
  connectionModelled: false;
  dataTransferModelled: false;
  boundaries: TagConnectionBoundary[];
  message: string;
}

export interface TagConnectionReviewReport {
  rows: TagConnectionReviewRow[];
  producedCount: number;
  consumedCount: number;
  conflictingCount: number;
  invalidCount: number;
  programScopedCount: number;
  missingProducerCount: number;
  missingRemoteTagCount: number;
  invalidConsumedRpiCount: number;
  invalidProduceCount: number;
  warnings: string[];
}

const MIN_PRODUCE_COUNT = 1;
const MAX_PRODUCE_COUNT = 256;

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function roleOf(tag: Tag): TagConnectionRole | undefined {
  if (tag.produced && tag.consumed) return "conflicting";
  if (tag.produced) return "produced";
  if (tag.consumed) return "consumed";
  return undefined;
}

function boundariesFor(role: TagConnectionRole): TagConnectionBoundary[] {
  const boundaries = new Set<TagConnectionBoundary>([
    "no-controller-communication",
    "no-remote-controller-browse",
  ]);
  if (role === "produced" || role === "conflicting") boundaries.add("no-produced-tag-connection");
  if (role === "consumed" || role === "conflicting") {
    boundaries.add("no-consumed-tag-connection");
    boundaries.add("no-rpi-scheduling");
  }
  return [...boundaries];
}

function issuesFor(tag: Tag, role: TagConnectionRole, program?: Program): TagConnectionIssue[] {
  const issues: TagConnectionIssue[] = [];
  if (program) issues.push("program-scoped");
  if (role === "conflicting") issues.push("both-produced-and-consumed");
  if (tag.consumed) {
    if (isBlank(tag.consumeInfo?.producer)) issues.push("missing-producing-controller");
    if (isBlank(tag.consumeInfo?.remoteTag)) issues.push("missing-remote-tag");
    const rpi = tag.consumeInfo?.rpi;
    if (rpi != null && (!Number.isFinite(rpi) || rpi <= 0)) {
      issues.push("invalid-consumed-rpi");
    }
  }
  if (tag.produced) {
    const count = tag.produceInfo?.produceCount;
    if (
      count != null &&
      (!Number.isInteger(count) || count < MIN_PRODUCE_COUNT || count > MAX_PRODUCE_COUNT)
    ) {
      issues.push("invalid-produce-count");
    }
  }
  return issues;
}

function issueLabel(issue: TagConnectionIssue): string {
  switch (issue) {
    case "program-scoped":
      return "tag is program-scoped";
    case "both-produced-and-consumed":
      return "tag is marked both produced and consumed";
    case "missing-producing-controller":
      return "missing producing controller";
    case "missing-remote-tag":
      return "missing remote tag";
    case "invalid-consumed-rpi":
      return "consumed tag RPI must be positive";
    case "invalid-produce-count":
      return `produce count must be ${MIN_PRODUCE_COUNT}-${MAX_PRODUCE_COUNT}`;
  }
}

function messageFor(row: Omit<TagConnectionReviewRow, "message">): string {
  if (row.status === "reviewable") {
    if (row.role === "produced") {
      return `Produced tag "${row.tagName}" is reviewable offline for up to ${row.produceCount ?? "unspecified"} consumer(s); no produced-tag connection is opened.`;
    }
    return `Consumed tag "${row.tagName}" is reviewable offline from ${row.producer}/${row.remoteTag}; no controller connection or RPI scheduling is attempted.`;
  }
  return `Connection tag "${row.tagName}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
}

function rowFor(input: {
  controller: Controller;
  tag: Tag;
  role: TagConnectionRole;
  program?: Program;
}): TagConnectionReviewRow {
  const { controller, tag, role, program } = input;
  const issues = issuesFor(tag, role, program);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    programId: program?.id,
    programName: program?.name,
    tagId: tag.id,
    tagName: tag.name,
    dataType: tag.dataType,
    scope: program ? "program" as const : "controller" as const,
    role,
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    produceCount: tag.produceInfo?.produceCount,
    unicastPermitted: tag.produceInfo?.unicastPermitted,
    programmaticallySendEventTrigger: tag.produceInfo?.programmaticallySendEventTrigger,
    producer: tag.consumeInfo?.producer,
    remoteTag: tag.consumeInfo?.remoteTag,
    remoteInstance: tag.consumeInfo?.remoteInstance,
    rpi: tag.consumeInfo?.rpi,
    unicast: tag.consumeInfo?.unicast,
    connectionModelled: false as const,
    dataTransferModelled: false as const,
    boundaries: boundariesFor(role),
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function tagConnectionReviewReport(project: PlcProject): TagConnectionReviewReport {
  const rows: TagConnectionReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      const role = roleOf(tag);
      if (role) rows.push(rowFor({ controller, tag, role }));
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        const role = roleOf(tag);
        if (role) rows.push(rowFor({ controller, program, tag, role }));
      }
    }
  }

  const hasIssue = (issue: TagConnectionIssue) => rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    producedCount: rows.filter((row) => row.role === "produced").length,
    consumedCount: rows.filter((row) => row.role === "consumed").length,
    conflictingCount: rows.filter((row) => row.role === "conflicting").length,
    invalidCount: rows.filter((row) => row.status === "needs-attention").length,
    programScopedCount: hasIssue("program-scoped"),
    missingProducerCount: hasIssue("missing-producing-controller"),
    missingRemoteTagCount: hasIssue("missing-remote-tag"),
    invalidConsumedRpiCount: hasIssue("invalid-consumed-rpi"),
    invalidProduceCount: hasIssue("invalid-produce-count"),
    warnings: rows.filter((row) => row.status === "needs-attention").map((row) => row.message),
  };
}
