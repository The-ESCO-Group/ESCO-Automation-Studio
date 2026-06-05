import type { IoModule, ModuleConnection, PlcProject } from "@esco/core";

export type ModuleConnectionReviewStatus = "reviewable" | "empty" | "needs-attention";

export type ModuleConnectionReviewIssue =
  | "missing-name"
  | "missing-type"
  | "missing-rpi"
  | "invalid-rpi"
  | "duplicate-name";

export type ModuleConnectionReviewBoundary =
  | "no-controller-communication"
  | "no-module-connection"
  | "no-rpi-scheduling"
  | "no-connection-priority-scheduling"
  | "no-event-triggered-connection-dispatch"
  | "no-unicast-multicast-enforcement"
  | "no-connection-major-fault";

export interface ModuleConnectionReviewConnection {
  name?: string;
  type?: string;
  priority?: string;
  eventId?: number;
  rpiMicroseconds?: number;
  rpiMs?: number;
  unicast?: boolean;
  issues: ModuleConnectionReviewIssue[];
}

export interface ModuleConnectionReviewRow {
  controllerId: string;
  controllerName: string;
  moduleId: string;
  moduleName: string;
  catalogNumber?: string;
  slot?: number;
  inhibited: boolean;
  majorFaultOnConnectionLoss: boolean;
  connections: ModuleConnectionReviewConnection[];
  connectionCount: number;
  inputCount: number;
  outputCount: number;
  priorityMetadataCount: number;
  eventIdMetadataCount: number;
  unicastCount: number;
  multicastCount: number;
  status: ModuleConnectionReviewStatus;
  issues: ModuleConnectionReviewIssue[];
  moduleConnectionModelled: false;
  rpiSchedulingModelled: false;
  connectionPrioritySchedulingModelled: false;
  eventTriggeredConnectionDispatchModelled: false;
  unicastMulticastEnforced: false;
  connectionMajorFaultModelled: false;
  boundaries: ModuleConnectionReviewBoundary[];
  message: string;
}

export interface ModuleConnectionReviewReport {
  rows: ModuleConnectionReviewRow[];
  moduleCount: number;
  moduleWithConnectionsCount: number;
  emptyModuleCount: number;
  connectionCount: number;
  inputCount: number;
  outputCount: number;
  priorityMetadataCount: number;
  eventIdMetadataCount: number;
  unicastCount: number;
  multicastCount: number;
  issueCount: number;
  connectionIssueCount: number;
  missingNameCount: number;
  missingTypeCount: number;
  missingRpiCount: number;
  invalidRpiCount: number;
  duplicateNameCount: number;
  warnings: string[];
}

const BOUNDARIES: ModuleConnectionReviewBoundary[] = [
  "no-controller-communication",
  "no-module-connection",
  "no-rpi-scheduling",
  "no-connection-priority-scheduling",
  "no-event-triggered-connection-dispatch",
  "no-unicast-multicast-enforcement",
  "no-connection-major-fault",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function normalizedName(connection: ModuleConnection): string | undefined {
  return connection.name?.trim().toLowerCase();
}

function duplicateNames(connections: ModuleConnection[]): Set<string> {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    const name = normalizedName(connection);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function invalidRpi(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0);
}

function issuesFor(connection: ModuleConnection, duplicates: Set<string>): ModuleConnectionReviewIssue[] {
  const issues: ModuleConnectionReviewIssue[] = [];
  if (blank(connection.name)) issues.push("missing-name");
  if (blank(connection.type)) issues.push("missing-type");
  if (connection.rpi == null) issues.push("missing-rpi");
  if (invalidRpi(connection.rpi)) issues.push("invalid-rpi");
  const name = normalizedName(connection);
  if (name && duplicates.has(name)) issues.push("duplicate-name");
  return issues;
}

function issueLabel(issue: ModuleConnectionReviewIssue): string {
  switch (issue) {
    case "missing-name":
      return "missing connection name";
    case "missing-type":
      return "missing connection type";
    case "missing-rpi":
      return "missing requested packet interval";
    case "invalid-rpi":
      return "requested packet interval must be a positive integer";
    case "duplicate-name":
      return "duplicate connection name";
  }
}

function connectionRow(connection: ModuleConnection, duplicates: Set<string>): ModuleConnectionReviewConnection {
  const rpi = connection.rpi;
  return {
    name: connection.name,
    type: connection.type,
    priority: connection.priority,
    eventId: connection.eventId,
    rpiMicroseconds: rpi,
    rpiMs: rpi == null || !Number.isFinite(rpi) ? undefined : rpi / 1000,
    unicast: connection.unicast,
    issues: issuesFor(connection, duplicates),
  };
}

function uniqueIssues(connections: ModuleConnectionReviewConnection[]): ModuleConnectionReviewIssue[] {
  return [...new Set(connections.flatMap((connection) => connection.issues))];
}

function connectionTypeIs(connection: ModuleConnectionReviewConnection, expected: string): boolean {
  return connection.type?.trim().toLowerCase() === expected;
}

function messageFor(row: Omit<ModuleConnectionReviewRow, "message">): string {
  if (row.issues.length) {
    return `I/O module "${row.moduleName}" connection metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.status === "empty") {
    return `I/O module "${row.moduleName}" has no imported module connection metadata to review.`;
  }
  return `I/O module "${row.moduleName}" has ${row.connectionCount} imported connection(s) reviewable offline; no module connection, RPI scheduling, or event-trigger dispatch is attempted.`;
}

function rowFor(input: {
  controllerId: string;
  controllerName: string;
  module: IoModule;
}): ModuleConnectionReviewRow {
  const { controllerId, controllerName, module } = input;
  const duplicates = duplicateNames(module.connections ?? []);
  const connections = (module.connections ?? []).map((connection) => connectionRow(connection, duplicates));
  const issues = uniqueIssues(connections);
  const rowBase = {
    controllerId,
    controllerName,
    moduleId: module.id,
    moduleName: module.name,
    catalogNumber: module.catalogNumber,
    slot: module.slot,
    inhibited: Boolean(module.inhibited),
    majorFaultOnConnectionLoss: Boolean(module.majorFault),
    connections,
    connectionCount: connections.length,
    inputCount: connections.filter((connection) => connectionTypeIs(connection, "input")).length,
    outputCount: connections.filter((connection) => connectionTypeIs(connection, "output")).length,
    priorityMetadataCount: connections.filter((connection) => !blank(connection.priority)).length,
    eventIdMetadataCount: connections.filter((connection) => connection.eventId != null).length,
    unicastCount: connections.filter((connection) => connection.unicast === true).length,
    multicastCount: connections.filter((connection) => connection.unicast === false).length,
    status: issues.length ? "needs-attention" as const : connections.length ? "reviewable" as const : "empty" as const,
    issues,
    moduleConnectionModelled: false as const,
    rpiSchedulingModelled: false as const,
    connectionPrioritySchedulingModelled: false as const,
    eventTriggeredConnectionDispatchModelled: false as const,
    unicastMulticastEnforced: false as const,
    connectionMajorFaultModelled: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function moduleConnectionReviewReport(project: PlcProject): ModuleConnectionReviewReport {
  const rows: ModuleConnectionReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const module of controller.ioConfiguration.modules) {
      rows.push(rowFor({ controllerId: controller.id, controllerName: controller.name, module }));
    }
  }

  const connections = rows.flatMap((row) => row.connections);
  const hasIssue = (issue: ModuleConnectionReviewIssue) =>
    connections.filter((connection) => connection.issues.includes(issue)).length;

  return {
    rows,
    moduleCount: rows.length,
    moduleWithConnectionsCount: rows.filter((row) => row.connectionCount > 0).length,
    emptyModuleCount: rows.filter((row) => row.status === "empty").length,
    connectionCount: connections.length,
    inputCount: rows.reduce((sum, row) => sum + row.inputCount, 0),
    outputCount: rows.reduce((sum, row) => sum + row.outputCount, 0),
    priorityMetadataCount: rows.reduce((sum, row) => sum + row.priorityMetadataCount, 0),
    eventIdMetadataCount: rows.reduce((sum, row) => sum + row.eventIdMetadataCount, 0),
    unicastCount: rows.reduce((sum, row) => sum + row.unicastCount, 0),
    multicastCount: rows.reduce((sum, row) => sum + row.multicastCount, 0),
    issueCount: rows.filter((row) => row.status === "needs-attention").length,
    connectionIssueCount: connections.reduce((sum, connection) => sum + connection.issues.length, 0),
    missingNameCount: hasIssue("missing-name"),
    missingTypeCount: hasIssue("missing-type"),
    missingRpiCount: hasIssue("missing-rpi"),
    invalidRpiCount: hasIssue("invalid-rpi"),
    duplicateNameCount: hasIssue("duplicate-name"),
    warnings: rows.filter((row) => row.status === "needs-attention").map((row) => row.message),
  };
}
