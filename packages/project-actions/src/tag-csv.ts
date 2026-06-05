import {
  arrayDimensionsOf,
  type ExternalAccess,
  type PlcProject,
  type Program,
  type Tag,
  type TagComment,
  type TagEngineeringUnit,
  type TagScope,
} from "@esco/core";
import { fail, ok } from "./helpers";
import { logixIdentifierError } from "./logix-names";
import {
  createTag,
  setTagAlias,
  setTagComments,
  setTagDataType,
  setTagDescription,
  setTagDimensions,
  setTagEngineeringUnits,
  setTagMetadata,
} from "./tag-actions";
import type { ProjectActionResult } from "./types";

/**
 * Tag CSV import/export backend. Pure, UI-free helpers: export the project's
 * tags to CSV text, parse + validate a CSV into a previewable plan, and apply
 * that plan through the controlled action layer (no React, no files, no
 * mutation of the input project). The UI (Codex) renders the preview and the
 * Apply button on top of these.
 */

const EXTERNAL_ACCESS = new Set<ExternalAccess>(["read-write", "read-only", "none"]);

export const TAG_CSV_HEADER = [
  "Scope",
  "Program",
  "Name",
  "DataType",
  "Dimension",
  "AliasFor",
  "Constant",
  "ExternalAccess",
  "Radix",
  "Description",
  "Comments",
  "EngineeringUnits",
] as const;

export interface TagCsvRow {
  scope: TagScope;
  /** Program name for program-scoped tags (empty for controller scope). */
  program?: string;
  name: string;
  dataType: string;
  dimension?: number;
  dimensions?: number[];
  /** Present (including "") when the CSV contains an AliasFor column; blank clears an existing alias on update. */
  aliasFor?: string;
  /** Present when the CSV contains a Constant column; false clears the flag on update. */
  constant?: boolean;
  /** Present (including "") when the CSV contains an ExternalAccess column; blank clears authored metadata. */
  externalAccess?: ExternalAccess | "";
  /** Present (including "") when the CSV contains a Radix column; blank clears authored display style. */
  radix?: string;
  /** Present (including "") when the CSV contains a Description column; blank clears the description on update. */
  description?: string;
  /** Present when the CSV contains a Comments column; empty array clears comments on update. */
  comments?: TagComment[];
  /** Present when the CSV contains an EngineeringUnits column; empty array clears units on update. */
  engineeringUnits?: TagEngineeringUnit[];
}

export type TagCsvRowStatus = "create" | "update" | "error";

export interface TagCsvPreviewRow {
  /** 1-based source line in the CSV (header is line 1). */
  line: number;
  row?: TagCsvRow;
  status: TagCsvRowStatus;
  /** Per-row errors (status "error") or warnings (still applied). */
  messages: string[];
}

export interface TagCsvImportPreview {
  rows: TagCsvPreviewRow[];
  createCount: number;
  updateCount: number;
  errorCount: number;
  /** File-level problems (e.g. missing required columns). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function dimensionCell(tag: Tag): string {
  return arrayDimensionsOf(tag).join(" ");
}

function annotationCell(rows: readonly (TagComment | TagEngineeringUnit)[] | undefined): string {
  return rows?.length ? JSON.stringify(rows.map((row) => ({ operand: row.operand, text: row.text }))) : "";
}

interface CsvRecord {
  line: number;
  cells: string[];
}

/** Parse CSV records into trimmed cells, honoring quotes, "" escapes, and quoted newlines. */
function parseCsvRecords(csv: string): { records: CsvRecord[]; warnings: string[] } {
  const records: CsvRecord[] = [];
  const row: string[] = [];
  let current = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quotedFieldLine = 1;

  const pushCell = () => {
    row.push(current.trim());
    current = "";
  };
  const pushRow = () => {
    pushCell();
    records.push({ line: rowLine, cells: [...row] });
    row.length = 0;
    rowLine = line + 1;
  };

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        if (char === "\r") {
          if (csv[i + 1] === "\n") i += 1;
          line += 1;
          current += "\n";
          continue;
        }
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
      quotedFieldLine = line;
    } else if (char === ",") {
      pushCell();
    } else if (char === "\n") {
      pushRow();
      line += 1;
    } else if (char === "\r") {
      pushRow();
      if (csv[i + 1] === "\n") i += 1;
      line += 1;
    } else {
      current += char;
    }
  }

  if (current !== "" || row.length > 0 || csv.length === 0 || !csv.endsWith("\n")) {
    pushCell();
    records.push({ line: rowLine, cells: [...row] });
  }

  return {
    records,
    warnings: inQuotes ? [`CSV has an unterminated quoted field starting on line ${quotedFieldLine}.`] : [],
  };
}

function parseAnnotationCell(
  value: string,
  label: string,
): { rows?: Array<TagComment | TagEngineeringUnit>; message?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { rows: [] };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return { message: `${label} must be a JSON array.` };
      const rows = parsed.map((entry) => {
        if (!entry || typeof entry !== "object") throw new Error(`${label} entries must be objects.`);
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.operand !== "string" || typeof candidate.text !== "string") {
          throw new Error(`${label} entries require string operand and text fields.`);
        }
        return { operand: candidate.operand, text: candidate.text };
      });
      return { rows };
    } catch (error) {
      return { message: error instanceof Error ? error.message : `Invalid ${label} JSON.` };
    }
  }

  const rows = trimmed.split(/\s*\|\s*/).filter(Boolean).map((part) => {
    const equals = part.indexOf("=");
    if (equals < 0) return { operand: "", text: part.trim() };
    return {
      operand: part.slice(0, equals).trim(),
      text: part.slice(equals + 1).trim(),
    };
  });
  return { rows };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Serialize every controller- and program-scoped tag to CSV text. */
export function exportTagsCsv(project: PlcProject): string {
  const lines: string[] = [TAG_CSV_HEADER.join(",")];
  for (const controller of project.controllers) {
    const emit = (tag: Tag, program?: string) => {
      lines.push(
        [
          tag.scope,
          program ?? "",
          tag.name,
          tag.dataType,
          dimensionCell(tag),
          tag.aliasFor ?? "",
          tag.constant ? "true" : "",
          tag.externalAccess ?? "",
          tag.radix ?? "",
          tag.description ?? "",
          annotationCell(tag.comments),
          annotationCell(tag.engineeringUnits),
        ]
          .map((value) => csvField(String(value)))
          .join(","),
      );
    };
    for (const tag of controller.controllerTags) emit(tag);
    for (const program of controller.programs) {
      for (const tag of program.programTags) emit(tag, program.name);
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Parse + preview
// ---------------------------------------------------------------------------

/** Map a header row to column indices by (case-insensitive) name. */
function headerIndex(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((name, i) => {
    index[name.trim().toLowerCase()] = i;
  });
  return index;
}

function hasColumn(col: Record<string, number>, key: string): boolean {
  return col[key] != null;
}

function sameLogixName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function resolveProgram(project: PlcProject, name: string): { program?: Program; error?: string } {
  const matches = project.controllers.flatMap((controller) =>
    controller.programs.filter((program) => sameLogixName(program.name, name)),
  );
  if (matches.length === 0) return { error: `Program "${name}" not found for program-scoped tag.` };
  if (matches.length > 1) return { error: `Program "${name}" is ambiguous across controllers.` };
  return { program: matches[0] };
}

function csvRowKey(scope: TagScope, program: string | undefined, name: string): string {
  return `${scope}\u0000${scope === "program" ? (program ?? "").toLowerCase() : ""}\u0000${name.toLowerCase()}`;
}

function findExistingTag(
  project: PlcProject,
  row: TagCsvRow,
): { tag?: Tag; program?: Program; error?: string } {
  if (row.scope === "program") {
    const resolved = resolveProgram(project, row.program ?? "");
    if (resolved.error) return { error: resolved.error };
    const tag = resolved.program!.programTags.find((candidate) => sameLogixName(candidate.name, row.name));
    return { tag, program: resolved.program };
  }

  const matches = project.controllers.flatMap((controller) =>
    controller.controllerTags.filter((tag) => sameLogixName(tag.name, row.name)),
  );
  if (matches.length > 1) return { error: `Controller tag "${row.name}" is ambiguous across controllers.` };
  return { tag: matches[0] };
}

function parseDimensionCell(value: string): {
  dimension?: number;
  dimensions?: number[];
  message?: string;
} {
  const raw = value.trim();
  if (!raw) return {};
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  const dimensions = parts.map((part) => Number(part));
  if (!dimensions.every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
    return { message: `Invalid dimension "${value}". Dimensions must be positive integers.` };
  }
  const normalized = dimensions.map((dimension) => Math.floor(dimension));
  return {
    ...(normalized[0] ? { dimension: normalized[0] } : {}),
    dimensions: normalized,
  };
}

function parseBooleanCell(value: string, label: string): { value?: boolean; message?: string } {
  const raw = value.trim().toLowerCase();
  if (!raw) return {};
  if (["true", "yes", "1"].includes(raw)) return { value: true };
  if (["false", "no", "0"].includes(raw)) return { value: false };
  return { message: `Invalid ${label} value "${value}".` };
}

function dimensionInput(row: TagCsvRow): { dimension?: number; dimensions?: number[] } {
  if (row.dimensions !== undefined) return { dimensions: row.dimensions };
  if (row.dimension !== undefined) return { dimension: row.dimension };
  return {};
}

function rowTarget(project: PlcProject, row: TagCsvRow): {
  target?: { name: string; scope: TagScope; programId?: string };
  tag?: Tag;
  error?: string;
} {
  const existing = findExistingTag(project, row);
  if (existing.error) return { error: existing.error };
  return {
    tag: existing.tag,
    target: {
      name: row.name,
      scope: row.scope,
      ...(row.scope === "program" ? { programId: existing.program!.id } : {}),
    },
  };
}

function appendWarnings(messages: string[], result: ProjectActionResult): void {
  for (const warning of result.warnings ?? []) messages.push(warning);
}

function applyCsvRow(
  project: PlcProject,
  row: TagCsvRow,
  status: Exclude<TagCsvRowStatus, "error">,
): ProjectActionResult {
  const target = rowTarget(project, row);
  if (target.error || !target.target) return fail(project, target.error ?? "Tag target could not be resolved.");

  let next = project;
  const messages: string[] = [];

  if (status === "create") {
    const created = createTag(next, {
      name: row.name,
      dataType: row.dataType,
      scope: row.scope,
      ...(target.target.programId ? { programId: target.target.programId } : {}),
      ...(row.description !== undefined ? { description: row.description } : {}),
      ...(row.constant ? { constant: true } : {}),
      ...(row.externalAccess ? { externalAccess: row.externalAccess } : {}),
      ...dimensionInput(row),
    });
    if (!created.ok) return created;
    next = created.project;
    appendWarnings(messages, created);

    if (row.radix !== undefined) {
      const metadata = setTagMetadata(next, { ...target.target, radix: row.radix });
      if (!metadata.ok) return metadata;
      next = metadata.project;
      appendWarnings(messages, metadata);
    }

    if (row.aliasFor !== undefined && row.aliasFor.trim()) {
      const alias = setTagAlias(next, { ...target.target, aliasFor: row.aliasFor.trim() });
      if (!alias.ok) return alias;
      next = alias.project;
      appendWarnings(messages, alias);
    }

    if (row.comments !== undefined) {
      const comments = setTagComments(next, { ...target.target, comments: row.comments });
      if (!comments.ok) return comments;
      next = comments.project;
      appendWarnings(messages, comments);
    }

    if (row.engineeringUnits !== undefined) {
      const engineeringUnits = setTagEngineeringUnits(next, {
        ...target.target,
        engineeringUnits: row.engineeringUnits,
      });
      if (!engineeringUnits.ok) return engineeringUnits;
      next = engineeringUnits.project;
      appendWarnings(messages, engineeringUnits);
    }

    return ok(next, undefined, messages.length ? messages : undefined);
  }

  const current = target.tag;
  if (!current) return fail(project, `Tag "${row.name}" does not exist for update.`);

  if (!sameLogixName(current.dataType, row.dataType)) {
    const typed = setTagDataType(next, { ...target.target, dataType: row.dataType });
    if (!typed.ok) return typed;
    next = typed.project;
    appendWarnings(messages, typed);
  }

  if (row.dimensions !== undefined || row.dimension !== undefined) {
    const sized = setTagDimensions(next, { ...target.target, ...dimensionInput(row) });
    if (!sized.ok) return sized;
    next = sized.project;
    appendWarnings(messages, sized);
  }

  if (row.description !== undefined) {
    const described = setTagDescription(next, { ...target.target, description: row.description });
    if (!described.ok) return described;
    next = described.project;
    appendWarnings(messages, described);
  }

  if (row.externalAccess !== undefined || row.constant !== undefined || row.radix !== undefined) {
    const metadata = setTagMetadata(next, {
      ...target.target,
      ...(row.externalAccess !== undefined ? { externalAccess: row.externalAccess } : {}),
      ...(row.constant !== undefined ? { constant: row.constant } : {}),
      ...(row.radix !== undefined ? { radix: row.radix } : {}),
    });
    if (!metadata.ok) return metadata;
    next = metadata.project;
    appendWarnings(messages, metadata);
  }

  if (row.aliasFor !== undefined) {
    const alias = setTagAlias(next, { ...target.target, aliasFor: row.aliasFor.trim() || undefined });
    if (!alias.ok) return alias;
    next = alias.project;
    appendWarnings(messages, alias);
  }

  if (row.comments !== undefined) {
    const comments = setTagComments(next, { ...target.target, comments: row.comments });
    if (!comments.ok) return comments;
    next = comments.project;
    appendWarnings(messages, comments);
  }

  if (row.engineeringUnits !== undefined) {
    const engineeringUnits = setTagEngineeringUnits(next, {
      ...target.target,
      engineeringUnits: row.engineeringUnits,
    });
    if (!engineeringUnits.ok) return engineeringUnits;
    next = engineeringUnits.project;
    appendWarnings(messages, engineeringUnits);
  }

  return ok(next, undefined, messages.length ? messages : undefined);
}

/**
 * Parse and validate a tag CSV against the project, producing a previewable
 * plan. Never mutates the project. Each row is dry-run through the same
 * controlled tag actions used by Apply, so preview and import agree on Logix
 * scope, data type, alias, dimension, and metadata validation.
 */
export function previewTagCsvImport(project: PlcProject, csv: string): TagCsvImportPreview {
  const warnings: string[] = [];
  const parsed = parseCsvRecords(csv);
  warnings.push(...parsed.warnings);
  const nonEmpty = parsed.records.filter((entry) => entry.cells.some((cell) => cell.trim() !== ""));

  if (nonEmpty.length === 0) {
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, warnings: [...warnings, "CSV is empty."] };
  }

  const header = nonEmpty[0]!.cells;
  const col = headerIndex(header);
  if (col["name"] == null || col["datatype"] == null) {
    warnings.push('CSV must include at least "Name" and "DataType" columns.');
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, warnings };
  }

  const seenInCsv = new Set<string>();
  const rows: TagCsvPreviewRow[] = [];
  let validationProject = project;

  for (const { cells, line } of nonEmpty.slice(1)) {
    const at = (key: string): string => {
      const i = col[key];
      return i == null ? "" : (cells[i] ?? "").trim();
    };
    const messages: string[] = [];

    const name = at("name");
    const dataType = at("datatype");
    const scopeText = at("scope");
    const scopeRaw = scopeText.toLowerCase();
    const scope: TagScope = scopeRaw === "program" ? "program" : "controller";
    const program = at("program") || undefined;

    if (!name) messages.push("Missing tag name.");
    else {
      const invalidName = logixIdentifierError(name, "Tag");
      if (invalidName) messages.push(invalidName);
    }
    if (scopeRaw && scopeRaw !== "controller" && scopeRaw !== "program") {
      messages.push(`Invalid scope "${scopeText}". Use "controller" or "program".`);
    }
    if (name) {
      const key = csvRowKey(scope, program, name);
      if (seenInCsv.has(key)) {
        messages.push(
          scope === "program" && program
            ? `Duplicate tag "${name}" within the CSV for program "${program}".`
            : `Duplicate controller tag "${name}" within the CSV.`,
        );
      }
      seenInCsv.add(key);
    }
    if (!dataType) messages.push("Missing data type.");
    if (scope === "program" && !program) messages.push("Program is required for program-scoped tags.");
    if (scope === "controller" && program) messages.push('Program can only be set when Scope is "program".');

    const dimensionColumn = hasColumn(col, "dimension");
    const dimensionParsed = dimensionColumn ? parseDimensionCell(at("dimension")) : {};
    if (dimensionParsed.message) messages.push(dimensionParsed.message);

    const constantColumn = hasColumn(col, "constant");
    const constantParsed = constantColumn ? parseBooleanCell(at("constant"), "Constant") : {};
    if (constantParsed.message) messages.push(constantParsed.message);

    const externalColumn = hasColumn(col, "externalaccess");
    const externalRaw = at("externalaccess");
    let externalAccess: ExternalAccess | "" | undefined;
    if (externalColumn) {
      if (!externalRaw) externalAccess = "";
      else if (EXTERNAL_ACCESS.has(externalRaw as ExternalAccess)) externalAccess = externalRaw as ExternalAccess;
      else messages.push(`Unknown external access "${externalRaw}".`);
    }

    const commentColumn = hasColumn(col, "comments");
    const commentsParsed = commentColumn ? parseAnnotationCell(at("comments"), "Comments") : {};
    if (commentsParsed.message) messages.push(commentsParsed.message);

    const engineeringUnitsColumn = hasColumn(col, "engineeringunits");
    const engineeringUnitsParsed = engineeringUnitsColumn
      ? parseAnnotationCell(at("engineeringunits"), "EngineeringUnits")
      : {};
    if (engineeringUnitsParsed.message) messages.push(engineeringUnitsParsed.message);

    if (messages.length > 0) {
      rows.push({ line, status: "error", messages });
      continue;
    }

    const row: TagCsvRow = {
      scope,
      program: scope === "program" ? program : undefined,
      name,
      dataType,
      ...(dimensionParsed.dimension ? { dimension: dimensionParsed.dimension } : {}),
      ...(dimensionColumn ? { dimensions: dimensionParsed.dimensions ?? [] } : {}),
      ...(hasColumn(col, "aliasfor") ? { aliasFor: at("aliasfor") } : {}),
      ...(constantColumn ? { constant: constantParsed.value ?? false } : {}),
      ...(externalColumn ? { externalAccess } : {}),
      ...(hasColumn(col, "radix") ? { radix: at("radix") } : {}),
      ...(hasColumn(col, "description") ? { description: at("description") } : {}),
      ...(commentColumn ? { comments: commentsParsed.rows as TagComment[] } : {}),
      ...(engineeringUnitsColumn ? { engineeringUnits: engineeringUnitsParsed.rows as TagEngineeringUnit[] } : {}),
    };

    const existing = findExistingTag(validationProject, row);
    if (existing.error) {
      rows.push({ line, row, status: "error", messages: [existing.error] });
      continue;
    }

    const status: Exclude<TagCsvRowStatus, "error"> = existing.tag ? "update" : "create";
    const validated = applyCsvRow(validationProject, row, status);
    if (!validated.ok) {
      rows.push({ line, row, status: "error", messages: [validated.error ?? "Tag CSV row failed validation."] });
      continue;
    }

    validationProject = validated.project;
    appendWarnings(messages, validated);
    rows.push({ line, row, status, messages });
  }

  return {
    rows,
    createCount: rows.filter((r) => r.status === "create").length,
    updateCount: rows.filter((r) => r.status === "update").length,
    errorCount: rows.filter((r) => r.status === "error").length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Apply a tag CSV to the project after a clean preview. Rows are replayed
 * through the controlled tag actions; any preview error blocks the entire file
 * so import never partially applies a malformed CSV.
 */
export function applyTagCsvImport(
  project: PlcProject,
  csv: string,
): ProjectActionResult<{ created: number; updated: number; skipped: number }> {
  const preview = previewTagCsvImport(project, csv);
  if (preview.errorCount > 0) {
    return fail(project, `Tag CSV has ${preview.errorCount} error(s); preview and fix the file before applying.`);
  }

  let next = project;
  const warnings: string[] = [];
  for (const previewRow of preview.rows) {
    if (!previewRow.row || previewRow.status === "error") continue;
    const applied = applyCsvRow(next, previewRow.row, previewRow.status);
    if (!applied.ok) return fail(project, applied.error ?? "Tag CSV import failed.");
    next = applied.project;
    appendWarnings(warnings, applied);
  }

  return ok(next, {
    created: preview.createCount,
    updated: preview.updateCount,
    skipped: 0,
  }, warnings.length ? warnings : undefined);
}
