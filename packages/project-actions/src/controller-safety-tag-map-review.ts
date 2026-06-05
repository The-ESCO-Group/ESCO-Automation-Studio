import type { Controller, PlcProject, SafetyInfo, Tag } from "@esco/core";
import { baseTagName } from "@esco/instructions";

/**
 * Offline review of a GuardLogix controller's standard<->safety tag mapping
 * (`<SafetyInfo><SafetyTagMap>`), mirroring the Safety Tag Mapping dialog of
 * Studio 5000 controller properties.
 *
 * This is intentionally distinct from {@link controllerSafetyInfoReviewReport}:
 * that report reviews the safety enable / lock / signature / level attributes on
 * `<SafetyInfo>`. This report parses both `SafetyTag = StandardTag` entries and
 * the compact `StandardTag,SafetyTag StandardTag2,SafetyTag2` payload exported by
 * some L5X files. It flags malformed entries, duplicate operands, unresolved
 * imported tags, and safety/standard class mismatches. Everything is read-only;
 * tag lookup is offline model review only, and the runtime copy of data between
 * standard and safety scope is never modelled.
 */
export type ControllerSafetyTagMapReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerSafetyTagMapReviewIssue =
  | "malformed-mapping-entry"
  | "duplicate-mapped-tag"
  | "unresolved-mapped-tag"
  | "safety-tag-not-safety-class"
  | "standard-tag-not-standard-class";

export type ControllerSafetyTagMapReviewBoundary =
  | "no-controller-communication"
  | "no-controller-verified-tag-resolution"
  | "no-safety-standard-data-movement"
  | "no-download-preflight";

export type ControllerSafetyTagMapEntryFormat = "equals" | "comma-pair";

/** A single parsed `SafetyTag = StandardTag` mapping entry. */
export interface ControllerSafetyTagMapEntry {
  /** The raw, trimmed entry text as authored in the L5X. */
  raw: string;
  /** Which imported SafetyTagMap syntax produced this row. */
  format: ControllerSafetyTagMapEntryFormat;
  /** Safety-scope tag name (left of `=`), when the entry parses. */
  safetyTag?: string;
  /** Standard-scope tag name (right of `=`), when the entry parses. */
  standardTag?: string;
  malformed: boolean;
  /** Offline model lookup only; never verified against a live controller. */
  safetyTagResolved: boolean;
  /** Offline model lookup only; never verified against a live controller. */
  standardTagResolved: boolean;
  safetyTagDataType?: string;
  standardTagDataType?: string;
  safetyTagSafetyClass?: string;
  standardTagSafetyClass?: string;
}

export interface ControllerSafetyTagMapReviewRow {
  controllerId: string;
  controllerName: string;
  safetyTagMap?: string;
  entries: ControllerSafetyTagMapEntry[];
  mappingCount: number;
  resolvedMappingCount: number;
  safetyTagMapPresent: boolean;
  status: ControllerSafetyTagMapReviewStatus;
  issues: ControllerSafetyTagMapReviewIssue[];
  controllerCommunicationModelled: false;
  offlineTagResolutionAvailable: boolean;
  tagResolutionModelled: false;
  safetyStandardDataMovementModelled: false;
  downloadPreflightModelled: false;
  boundaries: ControllerSafetyTagMapReviewBoundary[];
  message: string;
}

export interface ControllerSafetyTagMapReviewReport {
  rows: ControllerSafetyTagMapReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  mappingCount: number;
  resolvedMappingCount: number;
  issueCount: number;
  malformedEntryCount: number;
  duplicateMappedTagCount: number;
  unresolvedMappedTagCount: number;
  safetyClassMismatchCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerSafetyTagMapReviewBoundary[] = [
  "no-controller-communication",
  "no-controller-verified-tag-resolution",
  "no-safety-standard-data-movement",
  "no-download-preflight",
];

interface ParsedSafetyTagMapEntry {
  raw: string;
  format: ControllerSafetyTagMapEntryFormat;
  safetyTag?: string;
  standardTag?: string;
  malformed: boolean;
}

interface TagPath {
  path: string;
  baseTag: string;
  programName?: string;
}

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function normalizeSafetyClass(value: string | undefined): "safety" | "standard" | "unknown" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "safety") return "safety";
  if (normalized === "standard") return "standard";
  return "unknown";
}

function tagPath(value: string): TagPath | undefined {
  const trimmed = value.trim();
  const qualified = trimmed.match(/^Program:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
  if (qualified) {
    return {
      path: trimmed,
      programName: qualified[1],
      baseTag: qualified[2]!,
    };
  }
  const base = baseTagName(trimmed);
  if (!base) return undefined;
  return { path: trimmed, baseTag: base };
}

function resolveTag(controller: Controller, value: string | undefined): Tag | undefined {
  if (blank(value)) return undefined;
  const path = tagPath(value!);
  if (!path) return undefined;
  const matchesBase = (tag: Tag) => tag.name.toLowerCase() === path.baseTag.toLowerCase();
  if (path.programName) {
    const targetProgram = controller.programs.find((candidate) => candidate.name.toLowerCase() === path.programName!.toLowerCase());
    return targetProgram?.programTags.find(matchesBase);
  }
  return (
    controller.controllerTags.find(matchesBase) ??
    controller.programs.flatMap((program) => program.programTags).find(matchesBase)
  );
}

/**
 * Split the tag-map payload into entries. Equality form is authored as
 * `SafetyTag = StandardTag, SafetyTag2 = StandardTag2`. Compact comma-pair form
 * is authored as whitespace/semicolon separated `StandardTag,SafetyTag` pairs.
 */
function parseEntries(safetyTagMap: string | undefined): ParsedSafetyTagMapEntry[] {
  if (blank(safetyTagMap)) return [];
  const payload = safetyTagMap!.trim();
  if (payload.includes("=")) {
    return payload
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((raw) => {
        const halves = raw.split("=").map((half) => half.trim());
        if (halves.length !== 2 || halves[0] === "" || halves[1] === "") {
          return { raw, format: "equals", malformed: true };
        }
        return { raw, format: "equals", safetyTag: halves[0], standardTag: halves[1], malformed: false };
      });
  }

  return payload
    .split(/[\s;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((raw) => {
      const halves = raw.split(",").map((half) => half.trim());
      if (halves.length !== 2 || halves[0] === "" || halves[1] === "") {
        return { raw, format: "comma-pair", malformed: true };
      }
      return { raw, format: "comma-pair", standardTag: halves[0], safetyTag: halves[1], malformed: false };
    });
}

function enrichEntry(controller: Controller, entry: ParsedSafetyTagMapEntry): ControllerSafetyTagMapEntry {
  if (entry.malformed) {
    return {
      ...entry,
      safetyTagResolved: false,
      standardTagResolved: false,
    };
  }
  const safetyTag = resolveTag(controller, entry.safetyTag);
  const standardTag = resolveTag(controller, entry.standardTag);
  return {
    ...entry,
    safetyTagResolved: Boolean(safetyTag),
    standardTagResolved: Boolean(standardTag),
    safetyTagDataType: safetyTag?.dataType,
    standardTagDataType: standardTag?.dataType,
    safetyTagSafetyClass: safetyTag?.safetyClass,
    standardTagSafetyClass: standardTag?.safetyClass,
  };
}

function issuesFor(entries: ControllerSafetyTagMapEntry[]): ControllerSafetyTagMapReviewIssue[] {
  const issues: ControllerSafetyTagMapReviewIssue[] = [];
  if (entries.some((entry) => entry.malformed)) issues.push("malformed-mapping-entry");

  // A given tag may be mapped only once; a repeated safety- or standard-side
  // operand (case-insensitive, matching Logix tag-name semantics) is invalid.
  const seen = new Set<string>();
  const duplicate = entries.some((entry) => {
    if (entry.malformed) return false;
    const keys = [entry.safetyTag!.toLowerCase(), entry.standardTag!.toLowerCase()];
    for (const key of keys) {
      if (seen.has(key)) return true;
    }
    keys.forEach((key) => seen.add(key));
    return false;
  });
  if (duplicate) issues.push("duplicate-mapped-tag");
  if (entries.some((entry) => !entry.malformed && (!entry.safetyTagResolved || !entry.standardTagResolved))) {
    issues.push("unresolved-mapped-tag");
  }
  if (entries.some((entry) => !entry.malformed && entry.safetyTagResolved && normalizeSafetyClass(entry.safetyTagSafetyClass) !== "safety")) {
    issues.push("safety-tag-not-safety-class");
  }
  if (entries.some((entry) => !entry.malformed && entry.standardTagResolved && normalizeSafetyClass(entry.standardTagSafetyClass) !== "standard")) {
    issues.push("standard-tag-not-standard-class");
  }
  return issues;
}

function issueLabel(issue: ControllerSafetyTagMapReviewIssue): string {
  switch (issue) {
    case "malformed-mapping-entry":
      return "SafetyTagMap entries must be \"SafetyTag = StandardTag\" or \"StandardTag,SafetyTag\" pairs";
    case "duplicate-mapped-tag":
      return "a tag is mapped more than once in SafetyTagMap";
    case "unresolved-mapped-tag":
      return "one or more mapped tags are not present in the imported tag database";
    case "safety-tag-not-safety-class":
      return "one or more safety-side mapped tags are not marked Class=\"Safety\"";
    case "standard-tag-not-standard-class":
      return "one or more standard-side mapped tags are not marked Class=\"Standard\"";
  }
}

function statusFor(
  info: SafetyInfo | undefined,
  issues: ControllerSafetyTagMapReviewIssue[],
): ControllerSafetyTagMapReviewStatus {
  if (blank(info?.safetyTagMap)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerSafetyTagMapReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" SafetyTagMap needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.safetyTagMapPresent) {
    return `Controller "${row.controllerName}" has no imported SafetyTagMap to review.`;
  }
  return `Controller "${row.controllerName}" SafetyTagMap defines ${row.mappingCount} standard<->safety mapping(s) for offline review; ${row.resolvedMappingCount} resolve against imported tags, while controller-verified tag resolution and safety/standard data movement are not modelled.`;
}

function rowFor(controller: Controller): ControllerSafetyTagMapReviewRow {
  const info = controller.safetyInfo;
  const entries = parseEntries(info?.safetyTagMap).map((entry) => enrichEntry(controller, entry));
  const issues = issuesFor(entries);
  const resolvedMappingCount = entries.filter((entry) => !entry.malformed && entry.safetyTagResolved && entry.standardTagResolved).length;
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    safetyTagMap: present(info?.safetyTagMap),
    entries,
    mappingCount: entries.length,
    resolvedMappingCount,
    safetyTagMapPresent: !blank(info?.safetyTagMap),
    status: statusFor(info, issues),
    issues,
    controllerCommunicationModelled: false as const,
    offlineTagResolutionAvailable: resolvedMappingCount > 0,
    tagResolutionModelled: false as const,
    safetyStandardDataMovementModelled: false as const,
    downloadPreflightModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerSafetyTagMapReviewReport(
  project: PlcProject,
): ControllerSafetyTagMapReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerSafetyTagMapReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.safetyTagMapPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    mappingCount: rows.reduce((sum, row) => sum + row.mappingCount, 0),
    resolvedMappingCount: rows.reduce((sum, row) => sum + row.resolvedMappingCount, 0),
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    malformedEntryCount: hasIssue("malformed-mapping-entry"),
    duplicateMappedTagCount: hasIssue("duplicate-mapped-tag"),
    unresolvedMappedTagCount: hasIssue("unresolved-mapped-tag"),
    safetyClassMismatchCount:
      hasIssue("safety-tag-not-safety-class") + hasIssue("standard-tag-not-standard-class"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
