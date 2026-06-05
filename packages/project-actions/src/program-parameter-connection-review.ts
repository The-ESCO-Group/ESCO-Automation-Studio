import type { Controller, PlcProject, Program, ProgramParameter, ProgramParameterConnection } from "@esco/core";

export type ProgramParameterConnectionReviewStatus =
  | "reviewable"
  | "needs-attention";

export type ProgramParameterConnectionReviewIssue =
  | "missing-endpoint"
  | "malformed-endpoint"
  | "unresolved-program"
  | "unresolved-parameter"
  | "same-endpoint"
  | "duplicate-connection"
  | "incompatible-data-type";

export type ProgramParameterConnectionReviewBoundary =
  | "no-runtime-parameter-transfer"
  | "no-controller-verified-connection"
  | "no-program-connection-scheduling"
  | "no-download-preflight";

export interface ProgramParameterConnectionEndpointReview {
  raw?: string;
  programName?: string;
  parameterName?: string;
  programId?: string;
  dataType?: string;
  usage?: string;
  required?: boolean;
  resolved: boolean;
  issues: ProgramParameterConnectionReviewIssue[];
}

export interface ProgramParameterConnectionReviewRow {
  controllerId: string;
  controllerName: string;
  connectionId: string;
  endPoint1: ProgramParameterConnectionEndpointReview;
  endPoint2: ProgramParameterConnectionEndpointReview;
  status: ProgramParameterConnectionReviewStatus;
  issues: ProgramParameterConnectionReviewIssue[];
  connectionModelled: false;
  runtimeTransferModelled: false;
  controllerVerified: false;
  downloadPreflightModelled: false;
  boundaries: ProgramParameterConnectionReviewBoundary[];
  message: string;
}

export interface ProgramParameterConnectionReviewReport {
  rows: ProgramParameterConnectionReviewRow[];
  controllerCount: number;
  configuredControllerCount: number;
  connectionCount: number;
  reviewableCount: number;
  issueCount: number;
  missingEndpointCount: number;
  malformedEndpointCount: number;
  unresolvedProgramCount: number;
  unresolvedParameterCount: number;
  sameEndpointCount: number;
  duplicateConnectionCount: number;
  incompatibleDataTypeCount: number;
  warnings: string[];
}

const BOUNDARIES: ProgramParameterConnectionReviewBoundary[] = [
  "no-runtime-parameter-transfer",
  "no-controller-verified-connection",
  "no-program-connection-scheduling",
  "no-download-preflight",
];

function normalizeKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/^\\+/, "").toLowerCase();
}

function endpointKey(value: string | undefined): string | undefined {
  const key = normalizeKey(value);
  return key === "" ? undefined : key;
}

function connectionKey(connection: ProgramParameterConnection): string | undefined {
  const first = endpointKey(connection.endPoint1);
  const second = endpointKey(connection.endPoint2);
  return first && second ? [first, second].sort().join("|") : undefined;
}

function duplicateConnectionKeys(connections: readonly ProgramParameterConnection[]): Set<string> {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    const key = connectionKey(connection);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function splitEndpoint(raw: string | undefined): {
  programName?: string;
  parameterName?: string;
  issues: ProgramParameterConnectionReviewIssue[];
} {
  if (raw == null || raw.trim() === "") return { issues: ["missing-endpoint"] };
  const cleaned = raw.trim().replace(/^\\+/, "");
  const dot = cleaned.indexOf(".");
  if (dot <= 0 || dot === cleaned.length - 1) return { issues: ["malformed-endpoint"] };
  return {
    programName: cleaned.slice(0, dot),
    parameterName: cleaned.slice(dot + 1),
    issues: [],
  };
}

function findProgram(controller: Controller, programName: string | undefined): Program | undefined {
  if (!programName) return undefined;
  return controller.programs.find((program) => normalizeKey(program.name) === normalizeKey(programName));
}

function findParameter(program: Program | undefined, parameterName: string | undefined): ProgramParameter | undefined {
  if (!program || !parameterName) return undefined;
  return (program.parameters ?? []).find((parameter) => normalizeKey(parameter.name) === normalizeKey(parameterName));
}

function endpointReview(
  controller: Controller,
  raw: string | undefined,
): ProgramParameterConnectionEndpointReview {
  const parsed = splitEndpoint(raw);
  const issues = [...parsed.issues];
  const program = findProgram(controller, parsed.programName);
  if (parsed.programName && !program) issues.push("unresolved-program");
  const parameter = findParameter(program, parsed.parameterName);
  if (program && parsed.parameterName && !parameter) issues.push("unresolved-parameter");

  return {
    raw,
    programName: parsed.programName,
    parameterName: parsed.parameterName,
    programId: program?.id,
    dataType: parameter?.dataType,
    usage: parameter?.usage,
    required: parameter?.required,
    resolved: Boolean(program && parameter),
    issues,
  };
}

function issueLabel(issue: ProgramParameterConnectionReviewIssue): string {
  switch (issue) {
    case "missing-endpoint":
      return "missing endpoint";
    case "malformed-endpoint":
      return "endpoint must use Program.Parameter format";
    case "unresolved-program":
      return "endpoint program was not imported";
    case "unresolved-parameter":
      return "endpoint parameter was not imported";
    case "same-endpoint":
      return "both endpoints reference the same parameter";
    case "duplicate-connection":
      return "duplicate parameter connection";
    case "incompatible-data-type":
      return "connected parameters have different data types";
  }
}

function rowIssues(input: {
  connection: ProgramParameterConnection;
  endPoint1: ProgramParameterConnectionEndpointReview;
  endPoint2: ProgramParameterConnectionEndpointReview;
  duplicateKeys: Set<string>;
}): ProgramParameterConnectionReviewIssue[] {
  const issues = [...input.endPoint1.issues, ...input.endPoint2.issues];
  const firstKey = endpointKey(input.connection.endPoint1);
  const secondKey = endpointKey(input.connection.endPoint2);
  if (firstKey && secondKey && firstKey === secondKey) issues.push("same-endpoint");
  const key = connectionKey(input.connection);
  if (key && input.duplicateKeys.has(key)) issues.push("duplicate-connection");
  if (
    input.endPoint1.resolved &&
    input.endPoint2.resolved &&
    normalizeKey(input.endPoint1.dataType) !== normalizeKey(input.endPoint2.dataType)
  ) {
    issues.push("incompatible-data-type");
  }
  return [...new Set(issues)];
}

function messageFor(row: Omit<ProgramParameterConnectionReviewRow, "message">): string {
  const endpoints = `${row.endPoint1.raw ?? "<missing>"} -> ${row.endPoint2.raw ?? "<missing>"}`;
  if (row.issues.length) {
    return `Parameter connection ${endpoints} needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  return `Parameter connection ${endpoints} is reviewable offline; runtime transfer and controller-verified binding are not modelled.`;
}

function rowFor(
  controller: Controller,
  connection: ProgramParameterConnection,
  duplicateKeys: Set<string>,
): ProgramParameterConnectionReviewRow {
  const endPoint1 = endpointReview(controller, connection.endPoint1);
  const endPoint2 = endpointReview(controller, connection.endPoint2);
  const issues = rowIssues({ connection, endPoint1, endPoint2, duplicateKeys });
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    connectionId: connection.id,
    endPoint1,
    endPoint2,
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    connectionModelled: false as const,
    runtimeTransferModelled: false as const,
    controllerVerified: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function programParameterConnectionReviewReport(
  project: PlcProject,
): ProgramParameterConnectionReviewReport {
  const rows: ProgramParameterConnectionReviewRow[] = [];
  for (const controller of project.controllers) {
    const connections = controller.parameterConnections ?? [];
    const duplicateKeys = duplicateConnectionKeys(connections);
    for (const connection of connections) rows.push(rowFor(controller, connection, duplicateKeys));
  }

  const hasIssue = (issue: ProgramParameterConnectionReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: project.controllers.length,
    configuredControllerCount: project.controllers.filter((controller) =>
      (controller.parameterConnections ?? []).length > 0
    ).length,
    connectionCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.status === "needs-attention").length,
    missingEndpointCount: hasIssue("missing-endpoint"),
    malformedEndpointCount: hasIssue("malformed-endpoint"),
    unresolvedProgramCount: hasIssue("unresolved-program"),
    unresolvedParameterCount: hasIssue("unresolved-parameter"),
    sameEndpointCount: hasIssue("same-endpoint"),
    duplicateConnectionCount: hasIssue("duplicate-connection"),
    incompatibleDataTypeCount: hasIssue("incompatible-data-type"),
    warnings: rows.filter((row) => row.status === "needs-attention").map((row) => row.message),
  };
}
