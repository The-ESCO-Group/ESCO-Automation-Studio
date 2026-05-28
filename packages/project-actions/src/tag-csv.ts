import {
  createTag as makeTag,
  type ExternalAccess,
  type PlcProject,
  type Tag,
  type TagScope,
} from "@esco/core";
import { getAllTags, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

/**
 * Tag CSV import/export backend. Pure, UI-free helpers: export the project's
 * tags to CSV text, parse + validate a CSV into a previewable plan, and apply
 * that plan through the controlled action layer (no React, no files, no
 * mutation of the input project). The UI (Codex) renders the preview and the
 * Apply button on top of these.
 */

const TAG_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXTERNAL_ACCESS = new Set<ExternalAccess>(["read-write", "read-only", "none"]);

/** Data types the model fully understands; others import but are flagged opaque. */
const KNOWN_DATA_TYPES = new Set([
  "BOOL", "SINT", "INT", "DINT", "LINT", "REAL", "LREAL", "STRING", "TIMER", "COUNTER",
]);

export const TAG_CSV_HEADER = [
  "Scope", "Program", "Name", "DataType", "Dimension", "AliasFor", "ExternalAccess", "Description",
] as const;

export interface TagCsvRow {
  scope: TagScope;
  /** Program name for program-scoped tags (empty for controller scope). */
  program?: string;
  name: string;
  dataType: string;
  dimension?: number;
  aliasFor?: string;
  externalAccess?: ExternalAccess;
  description?: string;
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

/** Parse a single CSV line into trimmed cells, honoring quotes and "" escapes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
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
          tag.dimension && tag.dimension > 0 ? String(tag.dimension) : "",
          tag.aliasFor ?? "",
          tag.externalAccess ?? "",
          tag.description ?? "",
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

function programNames(project: PlcProject): Set<string> {
  return new Set(project.controllers.flatMap((c) => c.programs.map((p) => p.name)));
}

/**
 * Parse and validate a tag CSV against the project, producing a previewable
 * plan. Never mutates the project. Each data row is classified create / update
 * / error; unknown data types and unresolved programs are warned, not fatal
 * (except a program-scoped row whose program does not exist, which is an error
 * so a tag is never silently mis-scoped).
 */
export function previewTagCsvImport(project: PlcProject, csv: string): TagCsvImportPreview {
  const warnings: string[] = [];
  const physicalLines = csv.split(/\r?\n/);
  const nonEmpty = physicalLines
    .map((text, i) => ({ text, line: i + 1 }))
    .filter((entry) => entry.text.trim() !== "");

  if (nonEmpty.length === 0) {
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, warnings: ["CSV is empty."] };
  }

  const header = parseCsvLine(nonEmpty[0]!.text);
  const col = headerIndex(header);
  if (col["name"] == null || col["datatype"] == null) {
    warnings.push('CSV must include at least "Name" and "DataType" columns.');
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, warnings };
  }

  const existingNames = new Set(getAllTags(project).map((t) => t.name));
  const programs = programNames(project);
  const seenInCsv = new Set<string>();
  const rows: TagCsvPreviewRow[] = [];

  for (const { text, line } of nonEmpty.slice(1)) {
    const cells = parseCsvLine(text);
    const at = (key: string): string => {
      const i = col[key];
      return i == null ? "" : (cells[i] ?? "").trim();
    };
    const messages: string[] = [];

    const name = at("name");
    const dataType = at("datatype");
    const scopeRaw = at("scope").toLowerCase();
    const scope: TagScope = scopeRaw === "program" ? "program" : "controller";
    const program = at("program") || undefined;

    // Hard errors (row skipped on apply).
    if (!name) messages.push("Missing tag name.");
    else if (!TAG_NAME_RE.test(name)) messages.push(`Invalid tag name "${name}".`);
    if (name && seenInCsv.has(name)) messages.push(`Duplicate tag "${name}" within the CSV.`);
    if (!dataType) messages.push("Missing data type.");
    if (scope === "program" && (!program || !programs.has(program))) {
      messages.push(`Program "${program ?? ""}" not found for program-scoped tag.`);
    }

    if (name) seenInCsv.add(name);

    if (messages.length > 0) {
      rows.push({ line, status: "error", messages });
      continue;
    }

    // Soft warnings (still applied).
    const dimensionRaw = at("dimension");
    let dimension: number | undefined;
    if (dimensionRaw) {
      const parsed = Number(dimensionRaw);
      if (Number.isFinite(parsed) && parsed > 0) dimension = Math.floor(parsed);
      else messages.push(`Ignoring invalid dimension "${dimensionRaw}".`);
    }
    if (!KNOWN_DATA_TYPES.has(dataType.toUpperCase()) && !at("aliasfor")) {
      messages.push(`Unmodeled data type "${dataType}" (imported, treated as opaque).`);
    }

    const externalRaw = at("externalaccess");
    let externalAccess: ExternalAccess | undefined;
    if (externalRaw) {
      if (EXTERNAL_ACCESS.has(externalRaw as ExternalAccess)) externalAccess = externalRaw as ExternalAccess;
      else messages.push(`Ignoring unknown external access "${externalRaw}".`);
    }

    const row: TagCsvRow = {
      scope,
      program: scope === "program" ? program : undefined,
      name,
      dataType,
      dimension,
      aliasFor: at("aliasfor") || undefined,
      externalAccess,
      description: at("description") || undefined,
    };

    rows.push({ line, row, status: existingNames.has(name) ? "update" : "create", messages });
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

function applyFields(tag: Tag, row: TagCsvRow): Tag {
  const next: Tag = { ...tag, dataType: row.dataType };
  if (row.description !== undefined) next.description = row.description;
  if (row.dimension !== undefined) next.dimension = row.dimension;
  else delete next.dimension;
  if (row.aliasFor !== undefined) next.aliasFor = row.aliasFor;
  if (row.externalAccess !== undefined) next.externalAccess = row.externalAccess;
  return next;
}

function buildTag(controllerId: string, row: TagCsvRow): Tag {
  const tag = makeTag(controllerId, row.name, row.dataType, {
    scope: row.scope,
    description: row.description,
    value: row.dataType.toUpperCase() === "BOOL" ? false : 0,
    dimension: row.dimension,
  });
  if (row.aliasFor) tag.aliasFor = row.aliasFor;
  if (row.externalAccess) tag.externalAccess = row.externalAccess;
  return tag;
}

/**
 * Apply a tag CSV to the project: update existing tags (by name) and create new
 * ones, skipping error rows. Returns a standard action result (new project +
 * validation findings); the input project is never mutated.
 */
export function applyTagCsvImport(
  project: PlcProject,
  csv: string,
): ProjectActionResult<{ created: number; updated: number; skipped: number }> {
  const preview = previewTagCsvImport(project, csv);
  const actionable = preview.rows.filter(
    (r): r is TagCsvPreviewRow & { row: TagCsvRow } => r.status !== "error" && r.row != null,
  );
  const updatesByName = new Map(
    actionable.filter((r) => r.status === "update").map((r) => [r.row.name, r.row]),
  );
  const creates = actionable.filter((r) => r.status === "create").map((r) => r.row);

  const controller = project.controllers[0];
  if (!controller && creates.length > 0) {
    return ok(project, { created: 0, updated: 0, skipped: preview.errorCount });
  }
  const controllerId = controller?.id ?? "";

  // 1) Update existing tags in place (by name, any scope).
  const updated: PlcProject = {
    ...project,
    controllers: project.controllers.map((c) => ({
      ...c,
      controllerTags: c.controllerTags.map((t) =>
        updatesByName.has(t.name) ? applyFields(t, updatesByName.get(t.name)!) : t,
      ),
      programs: c.programs.map((p) => ({
        ...p,
        programTags: p.programTags.map((t) =>
          updatesByName.has(t.name) ? applyFields(t, updatesByName.get(t.name)!) : t,
        ),
      })),
    })),
  };

  // 2) Insert new tags: controller-scoped onto controller[0]; program-scoped onto the named program.
  const newControllerTags = creates
    .filter((row) => row.scope === "controller")
    .map((row) => buildTag(controllerId, row));
  const newProgramTagsByProgram = new Map<string, Tag[]>();
  for (const row of creates) {
    if (row.scope !== "program" || !row.program) continue;
    const list = newProgramTagsByProgram.get(row.program) ?? [];
    list.push(buildTag(controllerId, row));
    newProgramTagsByProgram.set(row.program, list);
  }

  const next: PlcProject = {
    ...updated,
    controllers: updated.controllers.map((c, index) => ({
      ...c,
      controllerTags:
        index === 0 ? [...c.controllerTags, ...newControllerTags] : c.controllerTags,
      programs: c.programs.map((p) => {
        const extra = newProgramTagsByProgram.get(p.name);
        return extra ? { ...p, programTags: [...p.programTags, ...extra] } : p;
      }),
    })),
  };

  return ok(next, {
    created: creates.length,
    updated: updatesByName.size,
    skipped: preview.errorCount,
  });
}
