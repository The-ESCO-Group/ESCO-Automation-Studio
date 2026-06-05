import type { PlcProject, Program, ProgramParameter } from "@esco/core";

export type ProgramInterfaceReviewDirection = "input" | "output" | "inout" | "unknown";

export type ProgramInterfaceReviewStatus = "reviewable" | "empty" | "needs-attention";

export type ProgramInterfaceReviewIssue =
  | "missing-name"
  | "missing-data-type"
  | "unknown-usage"
  | "invalid-dimensions";

export type ProgramInterfaceReviewBoundary =
  | "no-cross-program-parameter-binding"
  | "no-program-connection-scheduling"
  | "no-runtime-parameter-transfer"
  | "no-controller-verified-interface";

export interface ProgramParameterReviewRow {
  name: string;
  dataType: string;
  usage?: string;
  direction: ProgramInterfaceReviewDirection;
  required: boolean;
  dimension?: number;
  dimensions?: number[];
  defaultValue?: string;
  description?: string;
  radix?: string;
  externalAccess?: ProgramParameter["externalAccess"];
  issues: ProgramInterfaceReviewIssue[];
}

export interface ProgramInterfaceReviewRow {
  controllerId: string;
  controllerName: string;
  programId: string;
  programName: string;
  safetyClass?: string;
  inhibited: boolean;
  parameters: ProgramParameterReviewRow[];
  parameterCount: number;
  inputCount: number;
  outputCount: number;
  inOutCount: number;
  requiredCount: number;
  status: ProgramInterfaceReviewStatus;
  issues: ProgramInterfaceReviewIssue[];
  connectionModelled: false;
  runtimeTransferModelled: false;
  controllerVerified: false;
  boundaries: ProgramInterfaceReviewBoundary[];
  message: string;
}

export interface ProgramInterfaceReviewReport {
  rows: ProgramInterfaceReviewRow[];
  programCount: number;
  programWithParametersCount: number;
  emptyProgramCount: number;
  parameterCount: number;
  inputCount: number;
  outputCount: number;
  inOutCount: number;
  requiredCount: number;
  issueCount: number;
  parameterIssueCount: number;
  missingNameCount: number;
  missingDataTypeCount: number;
  unknownUsageCount: number;
  invalidDimensionCount: number;
  warnings: string[];
}

const BOUNDARIES: ProgramInterfaceReviewBoundary[] = [
  "no-cross-program-parameter-binding",
  "no-program-connection-scheduling",
  "no-runtime-parameter-transfer",
  "no-controller-verified-interface",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function directionFor(usage: string | undefined): ProgramInterfaceReviewDirection {
  const normalized = usage?.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "input") return "input";
  if (normalized === "output") return "output";
  if (normalized === "inout") return "inout";
  return "unknown";
}

function invalidDimensions(parameter: ProgramParameter): boolean {
  const dimension = parameter.dimension;
  const dimensions = parameter.dimensions;
  if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) return true;
  if (dimensions === undefined) return false;
  if (dimensions.length === 0) return true;
  if (!dimensions.every((candidate) => Number.isInteger(candidate) && candidate > 0)) return true;
  return dimension !== undefined && dimensions[0] !== dimension;
}

function issuesFor(parameter: ProgramParameter): ProgramInterfaceReviewIssue[] {
  const issues: ProgramInterfaceReviewIssue[] = [];
  if (blank(parameter.name)) issues.push("missing-name");
  if (blank(parameter.dataType)) issues.push("missing-data-type");
  if (directionFor(parameter.usage) === "unknown") issues.push("unknown-usage");
  if (invalidDimensions(parameter)) issues.push("invalid-dimensions");
  return issues;
}

function issueLabel(issue: ProgramInterfaceReviewIssue): string {
  switch (issue) {
    case "missing-name":
      return "missing parameter name";
    case "missing-data-type":
      return "missing parameter data type";
    case "unknown-usage":
      return "unknown parameter usage";
    case "invalid-dimensions":
      return "invalid parameter dimensions";
  }
}

function uniqueIssues(parameters: ProgramParameterReviewRow[]): ProgramInterfaceReviewIssue[] {
  return [...new Set(parameters.flatMap((parameter) => parameter.issues))];
}

function parameterRow(parameter: ProgramParameter): ProgramParameterReviewRow {
  return {
    name: parameter.name,
    dataType: parameter.dataType,
    usage: parameter.usage,
    direction: directionFor(parameter.usage),
    required: Boolean(parameter.required),
    dimension: parameter.dimension,
    dimensions: parameter.dimensions,
    defaultValue: parameter.defaultValue,
    description: parameter.description,
    radix: parameter.radix,
    externalAccess: parameter.externalAccess,
    issues: issuesFor(parameter),
  };
}

function messageFor(row: Omit<ProgramInterfaceReviewRow, "message">): string {
  if (row.issues.length) {
    return `Program "${row.programName}" interface needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.status === "empty") {
    return `Program "${row.programName}" has no imported program parameters to review.`;
  }
  return `Program "${row.programName}" exposes ${row.parameterCount} imported parameter(s) for offline review; runtime parameter transfer and controller-verified connections are not modelled.`;
}

function rowFor(input: {
  controllerId: string;
  controllerName: string;
  program: Program;
}): ProgramInterfaceReviewRow {
  const { controllerId, controllerName, program } = input;
  const parameters = (program.parameters ?? []).map(parameterRow);
  const issues = uniqueIssues(parameters);
  const rowBase = {
    controllerId,
    controllerName,
    programId: program.id,
    programName: program.name,
    safetyClass: program.safetyClass,
    inhibited: Boolean(program.inhibited),
    parameters,
    parameterCount: parameters.length,
    inputCount: parameters.filter((parameter) => parameter.direction === "input").length,
    outputCount: parameters.filter((parameter) => parameter.direction === "output").length,
    inOutCount: parameters.filter((parameter) => parameter.direction === "inout").length,
    requiredCount: parameters.filter((parameter) => parameter.required).length,
    status: issues.length ? "needs-attention" as const : parameters.length ? "reviewable" as const : "empty" as const,
    issues,
    connectionModelled: false as const,
    runtimeTransferModelled: false as const,
    controllerVerified: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function programInterfaceReviewReport(project: PlcProject): ProgramInterfaceReviewReport {
  const rows: ProgramInterfaceReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      rows.push(rowFor({ controllerId: controller.id, controllerName: controller.name, program }));
    }
  }

  const parameterRows = rows.flatMap((row) => row.parameters);
  const countIssue = (issue: ProgramInterfaceReviewIssue) =>
    parameterRows.filter((parameter) => parameter.issues.includes(issue)).length;

  return {
    rows,
    programCount: rows.length,
    programWithParametersCount: rows.filter((row) => row.parameterCount > 0).length,
    emptyProgramCount: rows.filter((row) => row.status === "empty").length,
    parameterCount: parameterRows.length,
    inputCount: rows.reduce((sum, row) => sum + row.inputCount, 0),
    outputCount: rows.reduce((sum, row) => sum + row.outputCount, 0),
    inOutCount: rows.reduce((sum, row) => sum + row.inOutCount, 0),
    requiredCount: rows.reduce((sum, row) => sum + row.requiredCount, 0),
    issueCount: rows.filter((row) => row.status === "needs-attention").length,
    parameterIssueCount: parameterRows.reduce((sum, parameter) => sum + parameter.issues.length, 0),
    missingNameCount: countIssue("missing-name"),
    missingDataTypeCount: countIssue("missing-data-type"),
    unknownUsageCount: countIssue("unknown-usage"),
    invalidDimensionCount: countIssue("invalid-dimensions"),
    warnings: rows.filter((row) => row.status === "needs-attention").map((row) => row.message),
  };
}
