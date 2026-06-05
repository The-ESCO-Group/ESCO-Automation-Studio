import type { AddOnInstruction, PlcProject, Tag, UserDefinedType } from "@esco/core";

export type ProcessLibraryObjectKind = "aoi-definition" | "udt-definition" | "tag-instance";
export type ProcessLibraryObjectStatus = "reviewable" | "metadata-only" | "needs-attention";

export type ProcessLibraryBoundary =
  | "metadata-display-only"
  | "no-vendor-faceplate-runtime"
  | "no-process-object-execution"
  | "no-runtime-tag-writes"
  | "no-controller-communication"
  | "no-proprietary-binary-support";

export type ProcessLibraryIssue =
  | "source-protected-aoi"
  | "missing-definition"
  | "no-parameters-or-members"
  | "safety-metadata-display-only";

export interface ProcessLibraryObjectRow {
  id: string;
  kind: ProcessLibraryObjectKind;
  status: ProcessLibraryObjectStatus;
  controllerName: string;
  programName?: string;
  name: string;
  dataType?: string;
  matchedPrefix: string;
  category: string;
  description?: string;
  vendor?: string;
  revision?: string;
  safetyClass?: string;
  sourceProtected?: boolean;
  signaturePresent?: boolean;
  parameterCount: number;
  localTagCount: number;
  routineCount: number;
  memberCount: number;
  tagInstanceCount: number;
  representativeFields: string[];
  issues: ProcessLibraryIssue[];
  boundaries: ProcessLibraryBoundary[];
  message: string;
}

export interface ProcessLibraryReviewReport {
  rows: ProcessLibraryObjectRow[];
  objectCount: number;
  aoiDefinitionCount: number;
  udtDefinitionCount: number;
  tagInstanceCount: number;
  reviewableCount: number;
  metadataOnlyCount: number;
  issueCount: number;
  protectedAoiCount: number;
  prefixCounts: { key: string; count: number }[];
  categoryCounts: { key: string; count: number }[];
  sampleNames: string[];
  boundaries: ProcessLibraryBoundary[];
  warnings: string[];
}

const PROCESS_PREFIXES: readonly string[] = [
  "raC_",
  "raP_",
  "PVLV",
  "PINTLK",
  "PPERM",
  "PPID",
  "PAI",
  "PDI",
  "P_",
];

const BOUNDARIES: ProcessLibraryBoundary[] = [
  "metadata-display-only",
  "no-vendor-faceplate-runtime",
  "no-process-object-execution",
  "no-runtime-tag-writes",
  "no-controller-communication",
  "no-proprietary-binary-support",
];

function matchProcessPrefix(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const prefix of PROCESS_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) return prefix;
  }
  return undefined;
}

function processCategory(name: string, dataType?: string): string {
  const text = `${name} ${dataType ?? ""}`.toLowerCase();
  if (/alarm|almd|alm_/.test(text)) return "alarm";
  if (/pide|pid|ppid/.test(text)) return "pid-loop";
  if (/vlv|valve/.test(text)) return "valve";
  if (/mot|motor|pump/.test(text)) return "motor";
  if (/intlk|interlock|perm|permissive/.test(text)) return "interlock-permissive";
  if (/ai|analog/.test(text)) return "analog";
  if (/di|digital/.test(text)) return "discrete";
  return "process-object";
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function rowsFromMap(map: Map<string, number>): { key: string; count: number }[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function representativeNames(items: { name: string; dataType?: string }[], limit = 8): string[] {
  return [...new Set(items.map((item) => item.dataType ?? item.name))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

function firstFields(values: readonly { name: string; dataType: string }[], limit = 8): string[] {
  return values
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((field) => `${field.name}: ${field.dataType}`);
}

function issueLabels(issues: ProcessLibraryIssue[]): string {
  if (issues.length === 0) return "";
  return issues
    .map((issue) => {
      switch (issue) {
        case "source-protected-aoi":
          return "source-protected AOI logic";
        case "missing-definition":
          return "definition not imported";
        case "no-parameters-or-members":
          return "no parameter/member metadata";
        case "safety-metadata-display-only":
          return "safety metadata display-only";
      }
    })
    .join("; ");
}

function statusFor(issues: ProcessLibraryIssue[], protectedSource = false): ProcessLibraryObjectStatus {
  if (issues.includes("missing-definition")) return "needs-attention";
  if (protectedSource || issues.includes("source-protected-aoi")) return "metadata-only";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function tagKey(tag: Tag, controllerName: string, programName?: string): string {
  return `${controllerName}:${programName ?? "controller"}:${tag.name}`;
}

function tagInstanceCountByType(project: PlcProject): Map<string, number> {
  const counts = new Map<string, number>();
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) increment(counts, tag.dataType);
    for (const program of controller.programs) {
      for (const tag of program.programTags) increment(counts, tag.dataType);
    }
  }
  return counts;
}

function aoiRow(
  controllerName: string,
  aoi: AddOnInstruction,
  tagCounts: Map<string, number>,
): ProcessLibraryObjectRow | undefined {
  const prefix = matchProcessPrefix(aoi.name);
  if (!prefix) return undefined;
  const issues: ProcessLibraryIssue[] = [];
  if (aoi.protected) issues.push("source-protected-aoi");
  if (aoi.parameters.length + aoi.localTags.length === 0) issues.push("no-parameters-or-members");
  if (aoi.safetyClass) issues.push("safety-metadata-display-only");
  const status = statusFor(issues, aoi.protected);
  return {
    id: `process-library:aoi:${controllerName}:${aoi.name}`,
    kind: "aoi-definition",
    status,
    controllerName,
    name: aoi.name,
    dataType: aoi.name,
    matchedPrefix: prefix,
    category: processCategory(aoi.name),
    ...(aoi.description ? { description: aoi.description } : {}),
    ...(aoi.vendor ? { vendor: aoi.vendor } : {}),
    ...(aoi.revision ? { revision: aoi.revision } : {}),
    ...(aoi.safetyClass ? { safetyClass: aoi.safetyClass } : {}),
    sourceProtected: Boolean(aoi.protected),
    signaturePresent: Boolean(aoi.signature),
    parameterCount: aoi.parameters.length,
    localTagCount: aoi.localTags.length,
    routineCount: aoi.routines?.length ?? aoi.routineNames.length,
    memberCount: 0,
    tagInstanceCount: tagCounts.get(aoi.name) ?? 0,
    representativeFields: firstFields([
      ...aoi.parameters.map((parameter) => ({ name: parameter.name, dataType: parameter.dataType })),
      ...aoi.localTags.map((tag) => ({ name: tag.name, dataType: tag.dataType })),
    ]),
    issues,
    boundaries: BOUNDARIES,
    message: issues.length
      ? `Process AOI "${aoi.name}" is imported for metadata review; ${issueLabels(issues)}.`
      : `Process AOI "${aoi.name}" exposes parameters, local tags, and imported routine metadata for offline review only.`,
  };
}

function udtRow(
  controllerName: string,
  udt: UserDefinedType,
  tagCounts: Map<string, number>,
): ProcessLibraryObjectRow | undefined {
  const prefix = matchProcessPrefix(udt.name);
  if (!prefix) return undefined;
  const issues: ProcessLibraryIssue[] = [];
  if (udt.members.length === 0) issues.push("no-parameters-or-members");
  if (udt.safetyClass) issues.push("safety-metadata-display-only");
  return {
    id: `process-library:udt:${controllerName}:${udt.name}`,
    kind: "udt-definition",
    status: statusFor(issues),
    controllerName,
    name: udt.name,
    dataType: udt.name,
    matchedPrefix: prefix,
    category: processCategory(udt.name),
    ...(udt.description ? { description: udt.description } : {}),
    ...(udt.safetyClass ? { safetyClass: udt.safetyClass } : {}),
    sourceProtected: false,
    signaturePresent: false,
    parameterCount: 0,
    localTagCount: 0,
    routineCount: 0,
    memberCount: udt.members.length,
    tagInstanceCount: tagCounts.get(udt.name) ?? 0,
    representativeFields: firstFields(udt.members.map((member) => ({ name: member.name, dataType: member.dataType }))),
    issues,
    boundaries: BOUNDARIES,
    message: issues.length
      ? `Process UDT "${udt.name}" is imported for structure review; ${issueLabels(issues)}.`
      : `Process UDT "${udt.name}" exposes member layout for offline review only.`,
  };
}

function tagRow(input: {
  controllerName: string;
  programName?: string;
  tag: Tag;
  definitions: Set<string>;
}): ProcessLibraryObjectRow | undefined {
  const prefix = matchProcessPrefix(input.tag.dataType) ?? matchProcessPrefix(input.tag.name);
  if (!prefix) return undefined;
  const issues: ProcessLibraryIssue[] = [];
  if (!input.definitions.has(input.tag.dataType)) issues.push("missing-definition");
  if (input.tag.safetyClass) issues.push("safety-metadata-display-only");
  return {
    id: `process-library:tag:${tagKey(input.tag, input.controllerName, input.programName)}`,
    kind: "tag-instance",
    status: statusFor(issues),
    controllerName: input.controllerName,
    ...(input.programName ? { programName: input.programName } : {}),
    name: input.tag.name,
    dataType: input.tag.dataType,
    matchedPrefix: prefix,
    category: processCategory(input.tag.name, input.tag.dataType),
    ...(input.tag.description ? { description: input.tag.description } : {}),
    ...(input.tag.safetyClass ? { safetyClass: input.tag.safetyClass } : {}),
    sourceProtected: false,
    signaturePresent: false,
    parameterCount: 0,
    localTagCount: 0,
    routineCount: 0,
    memberCount: 0,
    tagInstanceCount: 1,
    representativeFields: [],
    issues,
    boundaries: BOUNDARIES,
    message: issues.length
      ? `Process tag "${input.tag.name}" uses ${input.tag.dataType}; ${issueLabels(issues)}.`
      : `Process tag "${input.tag.name}" is an imported ${input.tag.dataType} instance for offline review only.`,
  };
}

export function processLibraryReviewReport(project: PlcProject): ProcessLibraryReviewReport {
  const rows: ProcessLibraryObjectRow[] = [];
  const tagCounts = tagInstanceCountByType(project);
  const definitions = new Set<string>();
  for (const controller of project.controllers) {
    for (const aoi of controller.addOnInstructions) definitions.add(aoi.name);
    for (const udt of controller.dataTypes) definitions.add(udt.name);
  }

  for (const controller of project.controllers) {
    for (const aoi of controller.addOnInstructions) {
      const row = aoiRow(controller.name, aoi, tagCounts);
      if (row) rows.push(row);
    }
    for (const udt of controller.dataTypes) {
      const row = udtRow(controller.name, udt, tagCounts);
      if (row) rows.push(row);
    }
    for (const tag of controller.controllerTags) {
      const row = tagRow({ controllerName: controller.name, tag, definitions });
      if (row) rows.push(row);
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        const row = tagRow({ controllerName: controller.name, programName: program.name, tag, definitions });
        if (row) rows.push(row);
      }
    }
  }

  rows.sort(
    (a, b) =>
      Number(b.status === "needs-attention") - Number(a.status === "needs-attention") ||
      a.category.localeCompare(b.category) ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );

  const prefixCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const row of rows) {
    increment(prefixCounts, row.matchedPrefix);
    increment(categoryCounts, row.category);
  }
  const warnings = rows.filter((row) => row.issues.length > 0).map((row) => row.message);

  return {
    rows,
    objectCount: rows.length,
    aoiDefinitionCount: rows.filter((row) => row.kind === "aoi-definition").length,
    udtDefinitionCount: rows.filter((row) => row.kind === "udt-definition").length,
    tagInstanceCount: rows.filter((row) => row.kind === "tag-instance").length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    metadataOnlyCount: rows.filter((row) => row.status === "metadata-only").length,
    issueCount: rows.reduce((sum, row) => sum + row.issues.length, 0),
    protectedAoiCount: rows.filter((row) => row.kind === "aoi-definition" && row.sourceProtected).length,
    prefixCounts: rowsFromMap(prefixCounts),
    categoryCounts: rowsFromMap(categoryCounts),
    sampleNames: representativeNames(rows),
    boundaries: BOUNDARIES,
    warnings,
  };
}
