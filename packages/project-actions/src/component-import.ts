import type { AddOnInstruction, Controller, ControllerTrend, IoModule, PlcProject, Program, Routine, Tag, Task, UserDefinedType } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { attr, child, extractAddOnInstructions, extractDataTypes, extractTrends, parseL5X, toArray, type L5XNode } from "@esco/parser-l5x";
import type { ComponentExportDependencies } from "./component-export";
import { fail, ok } from "./helpers";
import type { EscoLibraryPayload } from "./library-actions";
import { invalidLogixIdentifierReason } from "./logix-names";
import { parseNativeFileEnvelope } from "./native-format";
import type { ProjectActionReceipt, ProjectActionResult } from "./types";

/**
 * Offline component import. The Controller Organizer exposes "Import Add-On
 * Instruction...", "Import Data Type...", and "Import Trend..." commands. These
 * read a component file that ESCO previously produced — either the single
 * `esco.component.export.v1` envelope, the `esco.controller-assets.export.v1`
 * bundle written by the matching Export commands, or a checksummed `.easlib`
 * project library — and merge the contained definitions into a target controller.
 *
 * The import is purely offline and additive: it never connects to a controller,
 * never overwrites an existing component (name collisions are auto-renamed), and
 * never mutates the input project (callers receive a fresh project on success).
 */
export type ComponentImportAssetKind = "aoi" | "udt" | "trend";

interface FamilyInfo {
  label: string;
  idPrefix: string;
  /** True when names must be valid Logix identifiers (AOIs and UDTs). */
  strictName: boolean;
}

const FAMILIES: Record<ComponentImportAssetKind, FamilyInfo> = {
  aoi: { label: "Add-On Instruction", idPrefix: "aoi", strictName: true },
  udt: { label: "Data Type", idPrefix: "udt", strictName: true },
  trend: { label: "Trend", idPrefix: "trend", strictName: false },
};

/** Map an export envelope/bundle `kind` to the asset family it carries. */
function familyForExportKind(kind: unknown): ComponentImportAssetKind | undefined {
  switch (kind) {
    case "custom-instruction":
    case "add-on-instructions":
      return "aoi";
    case "data-type":
    case "user-defined-data-types":
      return "udt";
    case "controller-trend":
    case "controller-trends":
      return "trend";
    default:
      return undefined;
  }
}

/**
 * How a single incoming component should be reconciled against the target
 * controller. `import` keeps the authored name (only valid when there is no
 * collision), `overwrite` replaces the existing component in place, `rename`
 * brings it in under a fresh name, and `skip` leaves it out entirely.
 */
export type ComponentImportResolutionOption = "import" | "overwrite" | "rename" | "skip";

export interface ComponentImportResolution {
  option: ComponentImportResolutionOption;
  /** Explicit target name when `option === "rename"`; falls back to an auto-suffixed name. */
  renameTo?: string;
}

/** Per-row resolution choices keyed by {@link ComponentImportItem.id}. */
export type ComponentImportResolutionMap = Record<string, ComponentImportResolution>;

export type ComponentImportItemStatus = "create" | "rename" | "overwrite" | "skip" | "error";

export interface ComponentImportItem {
  /** Stable per-file row id (the candidate's position) used to key resolutions. */
  id: string;
  /** Component name as authored in the file. */
  sourceName: string;
  /** Name the component will receive after any rename/overwrite resolution. */
  finalName: string;
  /** create = imported as-is, rename = renamed, overwrite = replaces existing, skip = excluded, error = rejected. */
  status: ComponentImportItemStatus;
  /** True when an existing component in the target controller shares this name. */
  conflict: boolean;
  /** The existing component's name when this row conflicts. */
  existingName?: string;
  /** Resolution options the engineer may choose for this row. */
  availableOptions: ComponentImportResolutionOption[];
  /** Reason a component was renamed, overwritten, skipped, or rejected. */
  message?: string;
}

export interface ComponentImportPlan {
  ok: boolean;
  error?: string;
  /** Human label for the asset family, e.g. "Add-On Instruction". */
  kindLabel: string;
  controllerName?: string;
  /** Where the components were parsed from. */
  sourceFormat:
    | "component-envelope"
    | "controller-assets-bundle"
    | "controller-component"
    | "esco-library"
    | "esco-io-profile-pack"
    | "studio-l5x-component"
    | "raw"
    | "unknown";
  /** Human target label for dialogs. Defaults to controllerName for controller-scoped imports. */
  targetLabel?: string;
  items: ComponentImportItem[];
  createCount: number;
  renameCount: number;
  overwriteCount: number;
  skipCount: number;
  /** Rows whose authored name collides with an existing controller component. */
  conflictCount: number;
  errorCount: number;
}

interface ExtractResult {
  family: ComponentImportAssetKind;
  candidates: unknown[];
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function looksLikeXml(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<");
}

/** Pull the requested family's components out of an exported Controller payload. */
function controllerComponents(controller: Record<string, unknown>, family: ComponentImportAssetKind): unknown[] {
  if (family === "aoi") return asArray(controller.addOnInstructions);
  if (family === "udt") return asArray(controller.dataTypes);
  return asArray(controller.trends);
}

function looksLikeController(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.programs) ||
    Array.isArray(value.controllerTags) ||
    Array.isArray(value.addOnInstructions) ||
    Array.isArray(value.dataTypes)
  );
}

function looksLikeEscoLibraryEnvelope(value: Record<string, unknown>): boolean {
  return (
    value.formatName === "ESCO Automation Library" ||
    value.extension === ".easlib" ||
    (isRecord(value.native) && value.native.kind === "library")
  );
}

function extractEscoLibraryComponents(text: string, family: ComponentImportAssetKind): ExtractResult | { error: string } {
  const parsed = parseNativeFileEnvelope<EscoLibraryPayload>(text, { expectedKind: "library" });
  if (!parsed.ok || !parsed.file) {
    return { error: parsed.error ?? parsed.errors.join(" ") };
  }
  const payload = parsed.file.payload;
  if (!isRecord(payload) || !Array.isArray(payload.controllers)) {
    return { error: "This ESCO library does not contain a valid reusable controller-content payload." };
  }
  const candidates = payload.controllers.flatMap((controller) =>
    isRecord(controller) ? controllerComponents(controller, family) : [],
  );
  if (candidates.length === 0) {
    return { error: `No ${FAMILIES[family].label} components were found in this ESCO library.` };
  }
  return { family, candidates, sourceFormat: "esco-library" };
}

/** Infer the family of a bare component object from its shape. */
function inferFamily(value: Record<string, unknown>): ComponentImportAssetKind | undefined {
  if (Array.isArray(value.parameters) || Array.isArray(value.localTags) || Array.isArray(value.routineNames)) return "aoi";
  if (Array.isArray(value.members)) return "udt";
  if (Array.isArray(value.pens)) return "trend";
  return undefined;
}

/**
 * Locate the importable components in a parsed file and confirm they match the
 * requested family. Returns an error string when the file is the wrong format or
 * carries a different asset family than the menu command the engineer chose.
 */
function extractComponents(parsed: unknown, family: ComponentImportAssetKind): ExtractResult | { error: string } {
  const label = FAMILIES[family].label;

  // Bare array of components, e.g. the raw `payload` of an asset bundle.
  if (Array.isArray(parsed)) {
    return { family, candidates: parsed, sourceFormat: "raw" };
  }

  if (!isRecord(parsed)) {
    return { error: `This file is not a recognized ESCO component export.` };
  }

  const format = parsed.format;

  if (format === "esco.component.export.v1") {
    const kind = parsed.kind;
    if (kind === "controller" && isRecord(parsed.payload)) {
      return { family, candidates: controllerComponents(parsed.payload, family), sourceFormat: "controller-component" };
    }
    const fileFamily = familyForExportKind(kind);
    if (!fileFamily) return { error: `This component export (kind "${String(kind)}") cannot be imported as a ${label}.` };
    if (fileFamily !== family) {
      return { error: `This file contains ${FAMILIES[fileFamily].label} components. Use the Import ${FAMILIES[fileFamily].label} command instead.` };
    }
    return { family, candidates: asArray(parsed.payload), sourceFormat: "component-envelope" };
  }

  if (format === "esco.controller-assets.export.v1") {
    const fileFamily = familyForExportKind(parsed.kind);
    if (!fileFamily) return { error: `This asset bundle (kind "${String(parsed.kind)}") cannot be imported as a ${label}.` };
    if (fileFamily !== family) {
      return { error: `This file contains ${FAMILIES[fileFamily].label} components. Use the Import ${FAMILIES[fileFamily].label} command instead.` };
    }
    return { family, candidates: asArray(parsed.payload), sourceFormat: "controller-assets-bundle" };
  }

  // Unenveloped controller object.
  if (looksLikeController(parsed)) {
    return { family, candidates: controllerComponents(parsed, family), sourceFormat: "controller-component" };
  }

  // Bare single component object — accept only if its shape matches the family.
  const inferred = inferFamily(parsed);
  if (inferred && inferred !== family) {
    return { error: `This file looks like a ${FAMILIES[inferred].label}. Use the Import ${FAMILIES[inferred].label} command instead.` };
  }
  if (typeof parsed.name === "string") {
    return { family, candidates: [parsed], sourceFormat: "raw" };
  }

  return { error: `This file is not a recognized ESCO ${label} export.` };
}

function normalizedL5XSourceNodes(root: L5XNode): L5XNode[] {
  const controllers = toArray<L5XNode>(child(root, "Controller"));
  const sources = controllers.length ? controllers : [root];
  return sources.map((source) => {
    const normalized: L5XNode = { ...source };
    if (!child(normalized, "AddOnInstructionDefinitions") && child(source, "AddOnInstructionDefinition")) {
      normalized.AddOnInstructionDefinitions = { AddOnInstructionDefinition: child(source, "AddOnInstructionDefinition") };
    }
    if (!child(normalized, "DataTypes") && child(source, "DataType")) {
      normalized.DataTypes = { DataType: child(source, "DataType") };
    }
    if (!child(normalized, "Trends") && child(source, "Trend")) {
      normalized.Trends = { Trend: child(source, "Trend") };
    }
    return normalized;
  });
}

function extractL5XFamilyCounts(root: L5XNode): Record<ComponentImportAssetKind, number> {
  const nodes = normalizedL5XSourceNodes(root);
  return {
    aoi: nodes.reduce(
      (count, node) => count + toArray<L5XNode>(child(child(node, "AddOnInstructionDefinitions"), "AddOnInstructionDefinition")).length,
      0,
    ),
    udt: nodes.reduce((count, node) => count + toArray<L5XNode>(child(child(node, "DataTypes"), "DataType")).length, 0),
    trend: nodes.reduce((count, node) => count + toArray<L5XNode>(child(child(node, "Trends"), "Trend")).length, 0),
  };
}

function extractL5XComponents(text: string, family: ComponentImportAssetKind): ExtractResult | { error: string } {
  let root: L5XNode;
  try {
    root = parseL5X(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid L5X: the file is not valid XML." };
  }

  const counts = extractL5XFamilyCounts(root);
  const nodes = normalizedL5XSourceNodes(root);
  const registry = createDefaultRegistry();
  const candidates =
    family === "aoi"
      ? nodes.flatMap((node) => extractAddOnInstructions(node, registry).aois)
      : family === "udt"
        ? nodes.flatMap((node) => extractDataTypes(node))
        : nodes.flatMap((node) => extractTrends(node));

  if (candidates.length > 0) {
    return { family, candidates, sourceFormat: "studio-l5x-component" };
  }

  const otherFamily = (Object.entries(counts) as Array<[ComponentImportAssetKind, number]>).find(
    ([candidateFamily, count]) => candidateFamily !== family && count > 0,
  )?.[0];
  if (otherFamily) {
    return {
      error: `This L5X contains ${FAMILIES[otherFamily].label} components. Use the Import ${FAMILIES[otherFamily].label} command instead.`,
    };
  }

  const contentType = attr(root, "ContentType");
  return {
    error: `No ${FAMILIES[family].label} components were found in this L5X file${contentType ? ` (ContentType "${contentType}")` : ""}.`,
  };
}

/** Ids already present anywhere in the project, so generated ids never collide. */
function existingIds(project: PlcProject): Set<string> {
  const ids = new Set<string>();
  for (const controller of project.controllers) {
    ids.add(controller.id);
    for (const task of controller.tasks) ids.add(task.id);
    for (const tag of controller.controllerTags) ids.add(tag.id);
    for (const aoi of controller.addOnInstructions) ids.add(aoi.id);
    for (const udt of controller.dataTypes) ids.add(udt.id);
    for (const program of controller.programs) {
      ids.add(program.id);
      for (const tag of program.programTags) ids.add(tag.id);
      for (const routine of program.routines) ids.add(routine.id);
    }
    for (const module of controller.ioConfiguration.modules) ids.add(module.id);
    for (const trend of controller.trends ?? []) {
      ids.add(trend.id);
      for (const pen of trend.pens) ids.add(pen.id);
    }
  }
  return ids;
}

function makeUniqueId(prefix: string, name: string, taken: Set<string>): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "import";
  let id = `${prefix}_${slug}`;
  let counter = 1;
  while (taken.has(id)) {
    id = `${prefix}_${slug}_${counter}`;
    counter += 1;
  }
  taken.add(id);
  return id;
}

/** Find a collision-free name without mutating `taken`, auto-suffixing `_N`. */
function freeName(base: string, strict: boolean, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let counter = 1; counter < 10000; counter += 1) {
    const suffix = `_${counter}`;
    let candidate = `${base}${suffix}`;
    if (strict && candidate.length > 40) {
      candidate = `${base.slice(0, 40 - suffix.length).replace(/_+$/, "")}${suffix}`;
    }
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Extremely unlikely fallback.
  return base;
}

/** Build the final stored component from a raw entry, stamping name + fresh id. */
function materialize(
  raw: Record<string, unknown>,
  family: ComponentImportAssetKind,
  finalName: string,
  id: string,
  takenIds: Set<string>,
): AddOnInstruction | UserDefinedType | ControllerTrend {
  const clone = deepClone(raw);
  clone.name = finalName;
  clone.id = id;
  if (family === "aoi") {
    return {
      ...(clone as unknown as AddOnInstruction),
      parameters: Array.isArray(clone.parameters) ? (clone.parameters as AddOnInstruction["parameters"]) : [],
      localTags: Array.isArray(clone.localTags) ? (clone.localTags as AddOnInstruction["localTags"]) : [],
      routineNames: Array.isArray(clone.routineNames) ? (clone.routineNames as string[]) : [],
    };
  }
  if (family === "udt") {
    return {
      ...(clone as unknown as UserDefinedType),
      members: Array.isArray(clone.members) ? (clone.members as UserDefinedType["members"]) : [],
    };
  }
  const pens = (Array.isArray(clone.pens) ? clone.pens : []) as ControllerTrend["pens"];
  return {
    ...(clone as unknown as ControllerTrend),
    pens: pens.map((pen, index) => ({
      ...pen,
      id: makeUniqueId("pen", `${finalName}_${pen?.name ?? index}`, takenIds),
    })),
  };
}

interface ParsedCandidate {
  sourceName: string;
  valid: boolean;
  message?: string;
  raw?: Record<string, unknown>;
}

/** Validate a single raw component entry's name before it is reconciled. */
function parseCandidate(raw: unknown, family: ComponentImportAssetKind): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no name." };
  }
  const sourceName = raw.name.trim();
  if (FAMILIES[family].strictName) {
    const reason = invalidLogixIdentifierReason(sourceName);
    if (reason) return { sourceName, valid: false, message: `Invalid name: ${reason}.` };
  }
  return { sourceName, valid: true, raw };
}

interface ImportOp {
  kind: "add" | "overwrite";
  /** Existing component id replaced when `kind === "overwrite"`. */
  replaceId?: string;
  component: AddOnInstruction | UserDefinedType | ControllerTrend;
}

/** The id/name pairs already present in the target controller for a family. */
function listComponents(controller: Controller, family: ComponentImportAssetKind): { id: string; name: string }[] {
  if (family === "aoi") return controller.addOnInstructions.map((c) => ({ id: c.id, name: c.name }));
  if (family === "udt") return controller.dataTypes.map((c) => ({ id: c.id, name: c.name }));
  return (controller.trends ?? []).map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Reconcile every candidate in a file against the target controller, honouring
 * any per-row resolution choices. Returns the preview plan plus the concrete
 * add/overwrite operations to apply. Default (no choices) behaviour matches the
 * historical auto-rename: collisions become a `_N` rename, everything else imports.
 */
function buildPlan(
  project: PlcProject,
  controllerId: string,
  family: ComponentImportAssetKind,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: ImportOp[] } | { error: string } {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return { error: `Controller "${controllerId}" was not found.` };

  let extracted: ExtractResult | { error: string };
  if (looksLikeXml(text)) {
    extracted = extractL5XComponents(text, family);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "The selected file is not valid JSON or L5X XML. Choose an ESCO component export (.json) or .L5X component export." };
    }
    extracted =
      isRecord(parsed) && looksLikeEscoLibraryEnvelope(parsed)
        ? extractEscoLibraryComponents(text, family)
        : extractComponents(parsed, family);
  }
  if ("error" in extracted) return { error: extracted.error };

  const info = FAMILIES[family];
  if (extracted.candidates.length === 0) {
    return { error: `No ${info.label} components were found in this file.` };
  }

  const existing = listComponents(controller, family);
  const existingByLower = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const takenNames = new Set(existing.map((entry) => entry.name.toLowerCase()));
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: ImportOp[] = [];

  extracted.candidates.forEach((rawCandidate, index) => {
    const id = String(index);
    const cand = parseCandidate(rawCandidate, family);
    if (!cand.valid) {
      items.push({
        id,
        sourceName: cand.sourceName,
        finalName: cand.sourceName,
        status: "error",
        conflict: false,
        availableOptions: [],
        message: cand.message,
      });
      return;
    }

    const sourceName = cand.sourceName;
    const existingMatch = existingByLower.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict
      ? ["rename", "overwrite", "skip"]
      : ["import", "skip"];
    const requested = resolutions?.[id];
    const option: ComponentImportResolutionOption =
      requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";

    if (option === "skip") {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "skip",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: `Skipped — "${sourceName}" will not be imported.`,
      });
      return;
    }

    if (option === "overwrite" && existingMatch) {
      const finalName = existingMatch.name;
      const component = materialize(cand.raw!, family, finalName, existingMatch.id, takenIds);
      items.push({
        id,
        sourceName,
        finalName,
        status: "overwrite",
        conflict,
        existingName: existingMatch.name,
        availableOptions,
        message: `Overwrites existing ${info.label} "${existingMatch.name}".`,
      });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, component });
      return;
    }

    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid =
        Boolean(explicit) &&
        !takenNames.has(explicit!.toLowerCase()) &&
        (!info.strictName || !invalidLogixIdentifierReason(explicit!));
      finalName = explicitValid ? explicit! : freeName(sourceName, info.strictName, takenNames);
      renamed = true;
    } else {
      // option === "import": no controller conflict, but an earlier duplicate in
      // this same file may still force an auto-rename.
      if (takenNames.has(sourceName.toLowerCase())) {
        finalName = freeName(sourceName, info.strictName, takenNames);
        renamed = true;
      } else {
        finalName = sourceName;
      }
    }
    takenNames.add(finalName.toLowerCase());
    const newId = makeUniqueId(info.idPrefix, finalName, takenIds);
    const component = materialize(cand.raw!, family, finalName, newId, takenIds);
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed
        ? {
            message: conflict
              ? `Renamed from "${sourceName}" — a ${info.label} with that name already exists.`
              : `Renamed from "${sourceName}" — duplicated within the import file.`,
          }
        : {}),
    });
    ops.push({ kind: "add", component });
  });

  return {
    plan: {
      ok: true,
      kindLabel: info.label,
      controllerName: controller.name,
      targetLabel: controller.name,
      sourceFormat: extracted.sourceFormat,
      items,
      createCount: items.filter((item) => item.status === "create").length,
      renameCount: items.filter((item) => item.status === "rename").length,
      overwriteCount: items.filter((item) => item.status === "overwrite").length,
      skipCount: items.filter((item) => item.status === "skip").length,
      conflictCount: items.filter((item) => item.conflict).length,
      errorCount: items.filter((item) => item.status === "error").length,
    },
    ops,
  };
}

/**
 * Inspect a component file without mutating the project. Reports per-row how each
 * component would be reconciled (create/rename/overwrite/skip/error) under the
 * given resolution choices, so the UI can preview and offer conflict options.
 */
export function previewComponentImport(
  project: PlcProject,
  controllerId: string,
  family: ComponentImportAssetKind,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ComponentImportPlan {
  const result = buildPlan(project, controllerId, family, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: FAMILIES[family].label,
      sourceFormat: "unknown",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 0,
    };
  }
  return result.plan;
}

export interface ComponentImportSummary {
  kindLabel: string;
  controllerName: string;
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  /** Rows the engineer (or auto-resolution) left out of the import. */
  skipped: number;
  /** Entries rejected because they were invalid. */
  errors: number;
  /** Final names of the components that were merged in. */
  importedNames: string[];
}

function sourceFormatLabel(sourceFormat: ComponentImportPlan["sourceFormat"]): string {
  if (sourceFormat === "studio-l5x-component") return "Studio L5X XML component export";
  if (sourceFormat === "component-envelope") return "ESCO component export";
  if (sourceFormat === "controller-assets-bundle") return "ESCO controller assets bundle";
  if (sourceFormat === "controller-component") return "ESCO controller component export";
  if (sourceFormat === "esco-library") return "ESCO library artifact";
  if (sourceFormat === "esco-io-profile-pack") return "ESCO I/O profile pack";
  if (sourceFormat === "raw") return "Raw ESCO component payload";
  return "Unknown component source";
}

function importWarnings(plan: ComponentImportPlan): string[] {
  return plan.items.flatMap((item) => {
    if (item.status === "rename") {
      return [`${plan.kindLabel} "${item.sourceName}" was imported as "${item.finalName}" to avoid overwriting an existing component.`];
    }
    if (item.status === "overwrite") {
      return [`${plan.kindLabel} "${item.sourceName}" overwrote the existing "${item.finalName}" component by explicit resolution.`];
    }
    if (item.status === "skip") {
      return [`${plan.kindLabel} "${item.sourceName}" was skipped.${item.message ? ` ${item.message}` : ""}`];
    }
    if (item.status === "error") {
      return [`${plan.kindLabel} "${item.sourceName}" was rejected.${item.message ? ` ${item.message}` : ""}`];
    }
    return [];
  });
}

function componentImportReceipt(plan: ComponentImportPlan, importedNames: string[]): ProjectActionReceipt {
  const warnings = importWarnings(plan);
  return {
    title: `Import ${plan.kindLabel}`,
    summary: `Imported ${importedNames.length} ${plan.kindLabel} component(s) into ${plan.controllerName ?? "controller"}.`,
    status: plan.errorCount || plan.skipCount || plan.renameCount || plan.overwriteCount ? "warnings" : "succeeded",
    evidence: [
      {
        label: "Source",
        detail: sourceFormatLabel(plan.sourceFormat),
        status: "info",
        source: plan.sourceFormat,
      },
      {
        label: "Target controller",
        detail: plan.controllerName ?? "Unknown controller",
        status: "info",
      },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount ? "warning" : "ok",
      },
      {
        label: "Imported names",
        detail: importedNames.length ? importedNames.join(", ") : "No components imported",
        status: importedNames.length ? "ok" : "warning",
      },
    ],
    warnings,
    nextSteps: [
      {
        label: "Review imported component",
        detail: "Open the imported definition and confirm parameters, members, pens, and any renamed dependencies.",
        recommended: true,
      },
      {
        label: "Run Verify Controller",
        detail: "Use offline verification to surface missing dependent tags, data types, AOIs, or references.",
      },
      {
        label: "Save ESCO project",
        detail: "Persist the merged offline project to an ESCO-native project file before further edits.",
      },
    ],
  };
}

/** Replace overwritten components in place and append the freshly added ones. */
function applyOps(controller: Controller, family: ComponentImportAssetKind, ops: ImportOp[]): Controller {
  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.component]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.component);
  if (family === "aoi") {
    const merged = controller.addOnInstructions
      .map((c) => (overwriteById.get(c.id) as AddOnInstruction | undefined) ?? c)
      .concat(adds as AddOnInstruction[]);
    return { ...controller, addOnInstructions: merged };
  }
  if (family === "udt") {
    const merged = controller.dataTypes
      .map((c) => (overwriteById.get(c.id) as UserDefinedType | undefined) ?? c)
      .concat(adds as UserDefinedType[]);
    return { ...controller, dataTypes: merged };
  }
  const merged = (controller.trends ?? [])
    .map((c) => (overwriteById.get(c.id) as ControllerTrend | undefined) ?? c)
    .concat(adds as ControllerTrend[]);
  return { ...controller, trends: merged };
}

/**
 * Merge a component file's definitions into the target controller. Immutable
 * (the input project is returned unchanged when nothing applies). With no
 * `resolutions` the merge is additive and auto-renames collisions; supplying
 * resolutions lets the caller overwrite, explicitly rename, or skip each row.
 */
export function importComponents(
  project: PlcProject,
  controllerId: string,
  family: ComponentImportAssetKind,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<ComponentImportSummary> {
  const result = buildPlan(project, controllerId, family, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops } = result;

  if (ops.length === 0) {
    return fail(
      project,
      `No ${FAMILIES[family].label} components were imported — every entry was skipped or invalid.`,
    );
  }

  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) =>
      controller.id === controllerId ? applyOps(controller, family, ops) : controller,
    ),
  };

  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);

  return ok(next, {
    kindLabel: plan.kindLabel,
    controllerName: plan.controllerName ?? "",
    sourceFormat: plan.sourceFormat,
    created: plan.createCount,
    renamed: plan.renameCount,
    overwritten: plan.overwriteCount,
    skipped: plan.skipCount,
    errors: plan.errorCount,
    importedNames,
  }, importWarnings(plan), componentImportReceipt(plan, importedNames));
}

export interface RoutineComponentImportSummary {
  kindLabel: "Routine";
  controllerName: string;
  programName: string;
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  skipped: number;
  errors: number;
  importedNames: string[];
  dependencyWarnings: string[];
}

interface RoutineExtractResult {
  candidates: unknown[];
  dependencies?: ComponentExportDependencies;
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

interface RoutineImportOp {
  kind: "add" | "overwrite";
  replaceId?: string;
  routine: Routine;
}

const ROUTINE_LANGUAGES = new Set(["ladder", "structured-text", "function-block", "sfc"]);
const BUILTIN_ROUTINE_DATA_TYPES = new Set([
  "BOOL",
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
  "STRING",
  "TIMER",
  "COUNTER",
  "CONTROL",
  "MESSAGE",
  "MODULE",
  "PID",
  "PIDE",
  "ALARM_ANALOG",
  "ALARM_DIGITAL",
]);

function findProgramImportContext(
  project: PlcProject,
  programId: string,
): { controller: Controller; program: Program } | undefined {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === programId);
    if (program) return { controller, program };
  }
  return undefined;
}

function componentKindLabel(kind: unknown): string {
  const family = familyForExportKind(kind);
  if (family) return FAMILIES[family].label;
  if (kind === "routine") return "Routine";
  if (kind === "program") return "Program";
  if (kind === "task") return "Task";
  if (kind === "tag") return "Tag";
  if (kind === "controller") return "Controller";
  if (kind === "device-definition") return "Device Definition";
  if (kind === "device-tree") return "Device Tree";
  return "component";
}

function dependencyArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
}

function parseDependencies(value: unknown): ComponentExportDependencies | undefined {
  if (!isRecord(value)) return undefined;
  return {
    tags: dependencyArray(value.tags),
    dataTypes: dependencyArray(value.dataTypes),
    routines: dependencyArray(value.routines),
    devices: dependencyArray(value.devices),
  };
}

interface ControllerExtractResult {
  candidates: unknown[];
  dependencies?: ComponentExportDependencies;
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

interface ControllerImportOp {
  kind: "add";
  controller: Controller;
}

function extractControllerComponents(parsed: unknown): ControllerExtractResult | { error: string } {
  if (!isRecord(parsed)) {
    return { error: "This file is not a recognized ESCO controller component export." };
  }
  if (parsed.format === "esco.component.export.v1") {
    if (parsed.kind !== "controller") {
      const label = componentKindLabel(parsed.kind);
      return { error: `This file contains ${label} components. Use a .esco-controller.json export for controller import.` };
    }
    return {
      candidates: asArray(parsed.payload),
      dependencies: parseDependencies(parsed.dependencies),
      sourceFormat: "controller-component",
    };
  }
  if (
    typeof parsed.name === "string" &&
    Array.isArray(parsed.tasks) &&
    Array.isArray(parsed.programs) &&
    Array.isArray(parsed.controllerTags) &&
    isRecord(parsed.ioConfiguration)
  ) {
    return { candidates: [parsed], sourceFormat: "raw" };
  }
  return { error: "This file is not a recognized ESCO controller component export." };
}

function parseControllerCandidate(raw: unknown): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no controller name." };
  }
  const sourceName = raw.name.trim();
  const reason = invalidLogixIdentifierReason(sourceName);
  if (reason) return { sourceName, valid: false, message: `Invalid controller name: ${reason}.` };
  if (
    !Array.isArray(raw.tasks) ||
    !Array.isArray(raw.programs) ||
    !Array.isArray(raw.controllerTags) ||
    !Array.isArray(raw.dataTypes) ||
    !Array.isArray(raw.addOnInstructions) ||
    !isRecord(raw.ioConfiguration) ||
    !Array.isArray(raw.ioConfiguration.modules)
  ) {
    return { sourceName, valid: false, message: "Controller payload is incomplete. Export the controller again as .esco-controller.json." };
  }
  return { sourceName, valid: true, raw };
}

function materializeControllerTag(raw: unknown, controllerId: string, controllerName: string, takenIds: Set<string>): Tag | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.dataType !== "string") return undefined;
  const clone = deepClone(raw);
  clone.id = makeUniqueId("tag", `${controllerName}_${raw.name}`, takenIds);
  clone.controllerId = controllerId;
  clone.scope = "controller";
  delete clone.programId;
  return clone as unknown as Tag;
}

function materializeControllerModule(
  raw: Record<string, unknown>,
  controllerName: string,
  moduleIdMap: Map<string, string>,
  takenIds: Set<string>,
): IoModule {
  const clone = deepClone(raw);
  const sourceId = typeof raw.id === "string" ? raw.id : undefined;
  const label =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name
      : typeof raw.catalogNumber === "string" && raw.catalogNumber.trim()
        ? raw.catalogNumber
        : "module";
  clone.id = (sourceId && moduleIdMap.get(sourceId)) || makeUniqueId("mod", `${controllerName}_${label}`, takenIds);
  if (typeof clone.parentModule === "string") {
    clone.parentModule = moduleIdMap.get(clone.parentModule) ?? clone.parentModule;
  }
  if (Array.isArray(clone.ports)) {
    clone.ports = clone.ports.map((port, index) => {
      if (!isRecord(port)) return port;
      const nextPort = deepClone(port);
      if (typeof nextPort.id === "string" && nextPort.id.trim()) {
        nextPort.id = makeUniqueId("port", `${clone.id}_${nextPort.id}`, takenIds);
      } else {
        nextPort.id = makeUniqueId("port", `${clone.id}_${index}`, takenIds);
      }
      return nextPort;
    });
  }
  return clone as unknown as IoModule;
}

function materializeController(
  raw: Record<string, unknown>,
  finalName: string,
  projectId: string,
  id: string,
  takenIds: Set<string>,
): Controller {
  const sourcePrograms = asArray(raw.programs).filter((program): program is Record<string, unknown> => isRecord(program));
  const programIdMap = new Map<string, string>();
  for (const program of sourcePrograms) {
    if (typeof program.id === "string" && typeof program.name === "string") {
      programIdMap.set(program.id, makeUniqueId("prog", `${finalName}_${program.name}`, takenIds));
    }
  }
  const programs = sourcePrograms
    .map((program) => {
      if (typeof program.name !== "string" || !program.name.trim()) return undefined;
      const programId = (typeof program.id === "string" && programIdMap.get(program.id)) || makeUniqueId("prog", `${finalName}_${program.name}`, takenIds);
      return materializeProgram(program, program.name.trim(), id, programId, takenIds);
    })
    .filter((program): program is Program => Boolean(program));

  const programIds = new Set(programs.map((program) => program.id));
  const tasks = asArray(raw.tasks)
    .map((task) => {
      if (!isRecord(task) || typeof task.name !== "string" || !task.name.trim()) return undefined;
      const scheduledProgramIds = asArray(task.scheduledProgramIds)
        .map((programId) => (typeof programId === "string" ? programIdMap.get(programId) : undefined))
        .filter((programId): programId is string => typeof programId === "string" && programIds.has(programId));
      return materializeTask(task, task.name.trim(), id, makeUniqueId("task", `${finalName}_${task.name}`, takenIds), scheduledProgramIds);
    })
    .filter((task): task is Task => Boolean(task));

  const controllerTags = asArray(raw.controllerTags)
    .map((tag) => materializeControllerTag(tag, id, finalName, takenIds))
    .filter((tag): tag is Tag => Boolean(tag));

  const dataTypes = asArray(raw.dataTypes)
    .map((dataType) => {
      if (!isRecord(dataType) || typeof dataType.name !== "string" || !dataType.name.trim()) return undefined;
      return materialize(dataType, "udt", dataType.name.trim(), makeUniqueId("udt", `${finalName}_${dataType.name}`, takenIds), takenIds) as UserDefinedType;
    })
    .filter((dataType): dataType is UserDefinedType => Boolean(dataType));

  const addOnInstructions = asArray(raw.addOnInstructions)
    .map((instruction) => {
      if (!isRecord(instruction) || typeof instruction.name !== "string" || !instruction.name.trim()) return undefined;
      const aoi = materialize(
        instruction,
        "aoi",
        instruction.name.trim(),
        makeUniqueId("aoi", `${finalName}_${instruction.name}`, takenIds),
        takenIds,
      ) as AddOnInstruction;
      if (Array.isArray(instruction.routines)) {
        const routineIdMap = new Map<string, string>();
        aoi.routines = instruction.routines
          .map((routine) => repairRoutineForProgram(routine, aoi.id, takenIds, routineIdMap))
          .filter((routine): routine is Routine => Boolean(routine));
      }
      return aoi;
    })
    .filter((instruction): instruction is AddOnInstruction => Boolean(instruction));

  const ioConfiguration = isRecord(raw.ioConfiguration) ? deepClone(raw.ioConfiguration) : { modules: [] };
  const moduleIdMap = new Map<string, string>();
  const sourceModules = asArray(ioConfiguration.modules).filter((module): module is Record<string, unknown> => isRecord(module));
  for (const module of sourceModules) {
    if (typeof module.id === "string") {
      const label = typeof module.name === "string" && module.name.trim() ? module.name : module.catalogNumber;
      moduleIdMap.set(module.id, makeUniqueId("mod", `${finalName}_${label ?? "module"}`, takenIds));
    }
  }
  ioConfiguration.modules = sourceModules.map((module) => materializeControllerModule(module, finalName, moduleIdMap, takenIds));

  const trends = asArray(raw.trends)
    .map((trend) => {
      if (!isRecord(trend) || typeof trend.name !== "string" || !trend.name.trim()) return undefined;
      return materialize(trend, "trend", trend.name.trim(), makeUniqueId("trend", `${finalName}_${trend.name}`, takenIds), takenIds) as ControllerTrend;
    })
    .filter((trend): trend is ControllerTrend => Boolean(trend));

  const clone = deepClone(raw);
  clone.id = id;
  clone.projectId = projectId;
  clone.name = finalName;
  clone.tasks = tasks;
  clone.programs = programs;
  clone.controllerTags = controllerTags;
  clone.dataTypes = dataTypes;
  clone.addOnInstructions = addOnInstructions;
  clone.ioConfiguration = ioConfiguration;
  clone.trends = trends;
  return clone as unknown as Controller;
}

function controllerImportReceipt(plan: ComponentImportPlan, importedNames: string[]): ProjectActionReceipt {
  const warnings = importWarnings(plan);
  return {
    title: "Import Controller",
    summary: `Imported ${importedNames.length} Controller component(s) into ${plan.targetLabel ?? "project"}.`,
    status: warnings.length || plan.errorCount || plan.skipCount || plan.renameCount ? "warnings" : "succeeded",
    evidence: [
      { label: "Source", detail: sourceFormatLabel(plan.sourceFormat), status: "info", source: plan.sourceFormat },
      { label: "Target project", detail: plan.targetLabel ?? "Current project", status: "info" },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount || plan.renameCount ? "warning" : "ok",
      },
      {
        label: "Imported names",
        detail: importedNames.length ? importedNames.join(", ") : "No controllers imported",
        status: importedNames.length ? "ok" : "warning",
      },
    ],
    warnings,
    nextSteps: [
      { label: "Review imported controller", detail: "Open the copied controller and confirm tasks, programs, tags, I/O modules, and AOIs.", recommended: true },
      { label: "Run Verify Controller", detail: "Use offline verification to catch missing or invalid internal references before simulation." },
      { label: "Save ESCO project", detail: "Persist the merged offline project to an ESCO-native project file." },
    ],
  };
}

function buildControllerImportPlan(
  project: PlcProject,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: ControllerImportOp[] } | { error: string } {
  if (looksLikeXml(text)) {
    return { error: "Controller component import accepts ESCO-native .esco-controller.json files. Use L5X project review/import for XML files." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The selected controller file is not valid JSON. Choose an ESCO .esco-controller.json component export." };
  }
  const extracted = extractControllerComponents(parsed);
  if ("error" in extracted) return extracted;

  const existingNames = new Map(project.controllers.map((controller) => [controller.name.toLowerCase(), controller]));
  const takenNames = new Set(existingNames.keys());
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: ControllerImportOp[] = [];

  extracted.candidates.map(parseControllerCandidate).forEach((cand, index) => {
    const id = `controller-${index}`;
    const sourceName = cand.sourceName;
    if (!cand.valid || !cand.raw) {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "error",
        conflict: false,
        availableOptions: ["skip"],
        message: cand.message,
      });
      return;
    }

    const existingMatch = existingNames.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict ? ["rename", "skip"] : ["import", "skip"];
    const requested = resolutions?.[id];
    const option = requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";

    if (option === "skip") {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "skip",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: conflict ? `Skipped because Controller "${sourceName}" already exists.` : "Skipped by import resolution.",
      });
      return;
    }

    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid = Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, true, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, true, takenNames);
      renamed = true;
    } else {
      finalName = sourceName;
    }

    takenNames.add(finalName.toLowerCase());
    const controller = materializeController(cand.raw, finalName, project.id, makeUniqueId("ctrl", finalName, takenIds), takenIds);
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed ? { message: conflict ? `Renamed from "${sourceName}" - a Controller with that name already exists.` : `Renamed from "${sourceName}" - duplicated within the import file.` } : {}),
    });
    ops.push({ kind: "add", controller });
  });

  return {
    plan: {
      ok: true,
      kindLabel: "Controller",
      controllerName: project.name,
      targetLabel: project.name,
      sourceFormat: extracted.sourceFormat,
      items,
      createCount: items.filter((item) => item.status === "create").length,
      renameCount: items.filter((item) => item.status === "rename").length,
      overwriteCount: 0,
      skipCount: items.filter((item) => item.status === "skip").length,
      conflictCount: items.filter((item) => item.conflict).length,
      errorCount: items.filter((item) => item.status === "error").length,
    },
    ops,
  };
}

export function previewControllerComponentImport(project: PlcProject, text: string, resolutions?: ComponentImportResolutionMap): ComponentImportPlan {
  const result = buildControllerImportPlan(project, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: "Controller",
      controllerName: project.name,
      targetLabel: project.name,
      sourceFormat: "unknown",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 0,
    };
  }
  return result.plan;
}

export function importControllerComponent(
  project: PlcProject,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<ComponentImportSummary> {
  const result = buildControllerImportPlan(project, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops } = result;
  if (ops.length === 0) return fail(project, "No Controller components were imported - every entry was skipped or invalid.");
  const next: PlcProject = {
    ...project,
    controllers: [...project.controllers, ...ops.map((op) => op.controller)],
  };
  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename")
    .map((item) => item.finalName);
  return ok(
    next,
    {
      kindLabel: "Controller",
      controllerName: project.name,
      sourceFormat: plan.sourceFormat,
      created: plan.createCount,
      renamed: plan.renameCount,
      overwritten: 0,
      skipped: plan.skipCount,
      errors: plan.errorCount,
      importedNames,
    },
    importWarnings(plan),
    controllerImportReceipt(plan, importedNames),
  );
}

function extractRoutineComponents(parsed: unknown): RoutineExtractResult | { error: string } {
  if (Array.isArray(parsed)) {
    return { candidates: parsed, sourceFormat: "raw" };
  }
  if (!isRecord(parsed)) {
    return { error: "This file is not a recognized ESCO routine export." };
  }
  if (parsed.format === "esco.component.export.v1") {
    if (parsed.kind !== "routine") {
      const label = componentKindLabel(parsed.kind);
      return { error: `This file contains ${label} components. Use a .esco-routine.json export for routine import.` };
    }
    return {
      candidates: asArray(parsed.payload),
      dependencies: parseDependencies(parsed.dependencies),
      sourceFormat: "component-envelope",
    };
  }
  if (typeof parsed.name === "string" && typeof parsed.language === "string") {
    return { candidates: [parsed], sourceFormat: "raw" };
  }
  return { error: "This file is not a recognized ESCO routine export." };
}

function parseRoutineCandidate(raw: unknown): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no routine name." };
  }
  const sourceName = raw.name.trim();
  const reason = invalidLogixIdentifierReason(sourceName);
  if (reason) return { sourceName, valid: false, message: `Invalid routine name: ${reason}.` };
  if (typeof raw.language !== "string" || !ROUTINE_LANGUAGES.has(raw.language)) {
    return { sourceName, valid: false, message: "Routine language is missing or unsupported." };
  }
  return { sourceName, valid: true, raw };
}

function materializeRoutine(raw: Record<string, unknown>, finalName: string, programId: string, id: string): Routine {
  const clone = deepClone(raw);
  clone.name = finalName;
  clone.id = id;
  clone.programId = programId;
  return clone as unknown as Routine;
}

function routineDependencyWarnings(
  project: PlcProject,
  controller: Controller,
  program: Program,
  importedRoutineNames: string[],
  dependencies?: ComponentExportDependencies,
): string[] {
  if (!dependencies) return [];
  const knownTags = new Set([
    ...controller.controllerTags.map((tag) => tag.name),
    ...program.programTags.map((tag) => tag.name),
    ...(program.parameters ?? []).map((parameter) => parameter.name),
  ]);
  const knownDataTypes = new Set([
    ...BUILTIN_ROUTINE_DATA_TYPES,
    ...controller.dataTypes.map((dataType) => dataType.name),
    ...controller.addOnInstructions.map((instruction) => instruction.name),
    ...controller.controllerTags.map((tag) => tag.dataType),
    ...program.programTags.map((tag) => tag.dataType),
    ...(program.parameters ?? []).map((parameter) => parameter.dataType),
  ]);
  const importedNames = new Set(importedRoutineNames);
  const knownRoutines = new Set([...program.routines.map((routine) => routine.name), ...importedRoutineNames]);
  const missingTags = dependencies.tags.filter((name) => !knownTags.has(name));
  const missingDataTypes = dependencies.dataTypes.filter((name) => !knownDataTypes.has(name));
  const missingRoutines = dependencies.routines.filter((name) => !knownRoutines.has(name) && !importedNames.has(name));
  const projectDeviceNames = new Set(
    project.controllers.flatMap((candidate) => candidate.ioConfiguration.modules.map((module) => module.name || module.catalogNumber)),
  );
  const missingDevices = dependencies.devices.filter((name) => !projectDeviceNames.has(name));
  return [
    ...missingTags.map((name) => `Missing tag dependency "${name}" in target controller/program scope.`),
    ...missingDataTypes.map((name) => `Missing data type/AOI dependency "${name}" in target controller.`),
    ...missingRoutines.map((name) => `Missing routine dependency "${name}" in target program.`),
    ...missingDevices.map((name) => `Missing device dependency "${name}" in the offline I/O tree.`),
  ];
}

function appendDependencyMessage(items: ComponentImportItem[], dependencyWarnings: string[]): ComponentImportItem[] {
  if (dependencyWarnings.length === 0) return items;
  const detail = `Dependency review: ${dependencyWarnings.slice(0, 3).join(" ")}`;
  return items.map((item, index) => (index === 0 && item.status !== "error" ? { ...item, message: [item.message, detail].filter(Boolean).join(" ") } : item));
}

function buildRoutineImportPlan(
  project: PlcProject,
  programId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: RoutineImportOp[]; dependencyWarnings: string[] } | { error: string } {
  const context = findProgramImportContext(project, programId);
  if (!context) return { error: `Program "${programId}" was not found.` };
  if (looksLikeXml(text)) {
    return { error: "Routine component import accepts ESCO-native .esco-routine.json files. Use L5X project review/import for XML files." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The selected routine file is not valid JSON. Choose an ESCO .esco-routine.json component export." };
  }
  const extracted = extractRoutineComponents(parsed);
  if ("error" in extracted) return { error: extracted.error };
  if (extracted.candidates.length === 0) return { error: "No Routine components were found in this file." };

  const existing = context.program.routines.map((routine) => ({ id: routine.id, name: routine.name }));
  const existingByLower = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const takenNames = new Set(existing.map((entry) => entry.name.toLowerCase()));
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: RoutineImportOp[] = [];

  extracted.candidates.forEach((rawCandidate, index) => {
    const id = String(index);
    const cand = parseRoutineCandidate(rawCandidate);
    if (!cand.valid) {
      items.push({
        id,
        sourceName: cand.sourceName,
        finalName: cand.sourceName,
        status: "error",
        conflict: false,
        availableOptions: [],
        message: cand.message,
      });
      return;
    }
    const sourceName = cand.sourceName;
    const existingMatch = existingByLower.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict
      ? ["rename", "overwrite", "skip"]
      : ["import", "skip"];
    const requested = resolutions?.[id];
    const option: ComponentImportResolutionOption =
      requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";

    if (option === "skip") {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "skip",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: `Skipped — "${sourceName}" will not be imported.`,
      });
      return;
    }

    if (option === "overwrite" && existingMatch) {
      const routine = materializeRoutine(cand.raw!, existingMatch.name, programId, existingMatch.id);
      items.push({
        id,
        sourceName,
        finalName: existingMatch.name,
        status: "overwrite",
        conflict,
        existingName: existingMatch.name,
        availableOptions,
        message: `Overwrites existing Routine "${existingMatch.name}".`,
      });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, routine });
      return;
    }

    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid =
        Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, true, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, true, takenNames);
      renamed = true;
    } else {
      finalName = sourceName;
    }
    takenNames.add(finalName.toLowerCase());
    const routine = materializeRoutine(cand.raw!, finalName, programId, makeUniqueId("rtn", finalName, takenIds));
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed
        ? {
            message: conflict
              ? `Renamed from "${sourceName}" — a Routine with that name already exists.`
              : `Renamed from "${sourceName}" — duplicated within the import file.`,
          }
        : {}),
    });
    ops.push({ kind: "add", routine });
  });

  const importedNames = items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);
  const dependencyWarnings = routineDependencyWarnings(project, context.controller, context.program, importedNames, extracted.dependencies);
  const reviewedItems = appendDependencyMessage(items, dependencyWarnings);

  return {
    plan: {
      ok: true,
      kindLabel: "Routine",
      controllerName: context.controller.name,
      targetLabel: context.program.name,
      sourceFormat: extracted.sourceFormat,
      items: reviewedItems,
      createCount: reviewedItems.filter((item) => item.status === "create").length,
      renameCount: reviewedItems.filter((item) => item.status === "rename").length,
      overwriteCount: reviewedItems.filter((item) => item.status === "overwrite").length,
      skipCount: reviewedItems.filter((item) => item.status === "skip").length,
      conflictCount: reviewedItems.filter((item) => item.conflict).length,
      errorCount: reviewedItems.filter((item) => item.status === "error").length,
    },
    ops,
    dependencyWarnings,
  };
}

export function previewRoutineComponentImport(
  project: PlcProject,
  programId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ComponentImportPlan {
  const result = buildRoutineImportPlan(project, programId, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: "Routine",
      sourceFormat: "unknown",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 0,
    };
  }
  return result.plan;
}

function routineImportReceipt(
  plan: ComponentImportPlan,
  importedNames: string[],
  dependencyWarnings: string[],
): ProjectActionReceipt {
  const warnings = [...importWarnings(plan), ...dependencyWarnings];
  return {
    title: "Import Routine",
    summary: `Imported ${importedNames.length} Routine component(s) into ${plan.targetLabel ?? "program"}.`,
    status: warnings.length ? "warnings" : "succeeded",
    evidence: [
      {
        label: "Source",
        detail: sourceFormatLabel(plan.sourceFormat),
        status: "info",
        source: plan.sourceFormat,
      },
      {
        label: "Target program",
        detail: plan.targetLabel ?? "Unknown program",
        status: "info",
      },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount || dependencyWarnings.length ? "warning" : "ok",
      },
      {
        label: "Dependency review",
        detail: dependencyWarnings.length
          ? `${dependencyWarnings.length} missing dependency warning(s); run offline verify after import.`
          : "Exported routine dependencies are present in the offline target model.",
        status: dependencyWarnings.length ? "warning" : "ok",
      },
      {
        label: "Imported names",
        detail: importedNames.length ? importedNames.join(", ") : "No routines imported",
        status: importedNames.length ? "ok" : "warning",
      },
    ],
    warnings,
    nextSteps: [
      {
        label: "Open imported routine",
        detail: "Review logic, comments, and any renamed references before scheduling or simulating it.",
        recommended: true,
      },
      {
        label: "Run Verify Controller",
        detail: "Use offline verification to resolve missing tags, UDTs, AOIs, or called routines.",
      },
      {
        label: "Save ESCO project",
        detail: "Persist the merged offline project to an ESCO-native project file.",
      },
    ],
  };
}

function applyRoutineOps(program: Program, ops: RoutineImportOp[]): Program {
  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.routine]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.routine);
  return {
    ...program,
    routines: program.routines.map((routine) => overwriteById.get(routine.id) ?? routine).concat(adds),
  };
}

export function importRoutineComponent(
  project: PlcProject,
  programId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<RoutineComponentImportSummary> {
  const result = buildRoutineImportPlan(project, programId, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops, dependencyWarnings } = result;
  if (ops.length === 0) {
    return fail(project, "No Routine components were imported — every entry was skipped or invalid.");
  }

  const context = findProgramImportContext(project, programId)!;
  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) =>
      controller.id === context.controller.id
        ? {
            ...controller,
            programs: controller.programs.map((program) => (program.id === programId ? applyRoutineOps(program, ops) : program)),
          }
        : controller,
    ),
  };

  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);

  return ok(next, {
    kindLabel: "Routine",
    controllerName: context.controller.name,
    programName: context.program.name,
    sourceFormat: plan.sourceFormat,
    created: plan.createCount,
    renamed: plan.renameCount,
    overwritten: plan.overwriteCount,
    skipped: plan.skipCount,
    errors: plan.errorCount,
    importedNames,
    dependencyWarnings,
  }, [...importWarnings(plan), ...dependencyWarnings], routineImportReceipt(plan, importedNames, dependencyWarnings));
}

export interface ProgramComponentImportSummary {
  kindLabel: "Program";
  controllerName: string;
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  skipped: number;
  errors: number;
  importedNames: string[];
  dependencyWarnings: string[];
}

interface ProgramExtractResult {
  candidates: unknown[];
  dependencies?: ComponentExportDependencies;
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

interface ProgramImportOp {
  kind: "add" | "overwrite";
  replaceId?: string;
  program: Program;
}

function extractProgramComponents(parsed: unknown): ProgramExtractResult | { error: string } {
  if (Array.isArray(parsed)) {
    return { candidates: parsed, sourceFormat: "raw" };
  }
  if (!isRecord(parsed)) {
    return { error: "This file is not a recognized ESCO program export." };
  }
  if (parsed.format === "esco.component.export.v1") {
    if (parsed.kind !== "program") {
      const label = componentKindLabel(parsed.kind);
      return { error: `This file contains ${label} components. Use a .esco-program.json export for program import.` };
    }
    return {
      candidates: asArray(parsed.payload),
      dependencies: parseDependencies(parsed.dependencies),
      sourceFormat: "component-envelope",
    };
  }
  if (typeof parsed.name === "string" && Array.isArray(parsed.routines) && Array.isArray(parsed.programTags)) {
    return { candidates: [parsed], sourceFormat: "raw" };
  }
  return { error: "This file is not a recognized ESCO program export." };
}

function parseProgramCandidate(raw: unknown): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no program name." };
  }
  const sourceName = raw.name.trim();
  const reason = invalidLogixIdentifierReason(sourceName);
  if (reason) return { sourceName, valid: false, message: `Invalid program name: ${reason}.` };
  if (!Array.isArray(raw.routines) || !Array.isArray(raw.programTags)) {
    return { sourceName, valid: false, message: "Program payload is missing routines or program tags." };
  }
  return { sourceName, valid: true, raw };
}

function repairRoutineForProgram(raw: unknown, programId: string, takenIds: Set<string>, routineIdMap: Map<string, string>): Routine | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.language !== "string") return undefined;
  const sourceId = typeof raw.id === "string" ? raw.id : "";
  const nextId = makeUniqueId("rtn", `${programId}_${raw.name}`, takenIds);
  if (sourceId) routineIdMap.set(sourceId, nextId);
  const clone = deepClone(raw);
  clone.id = nextId;
  clone.programId = programId;
  if (isRecord(clone.ladder) && Array.isArray(clone.ladder.rungs)) {
    clone.ladder = {
      ...clone.ladder,
      rungs: clone.ladder.rungs.map((rung) => (isRecord(rung) ? { ...rung, routineId: nextId } : rung)),
    };
  }
  return clone as unknown as Routine;
}

function repairProgramTag(raw: unknown, controllerId: string, programId: string, programName: string, takenIds: Set<string>): Tag | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.dataType !== "string") return undefined;
  const clone = deepClone(raw);
  clone.id = makeUniqueId("tag", `${programName}_${raw.name}`, takenIds);
  clone.controllerId = controllerId;
  clone.scope = "program";
  clone.programId = programId;
  return clone as unknown as Tag;
}

function materializeProgram(
  raw: Record<string, unknown>,
  finalName: string,
  controllerId: string,
  id: string,
  takenIds: Set<string>,
): Program {
  const routineIdMap = new Map<string, string>();
  const routines = asArray(raw.routines)
    .map((routine) => repairRoutineForProgram(routine, id, takenIds, routineIdMap))
    .filter((routine): routine is Routine => Boolean(routine));
  const programTags = asArray(raw.programTags)
    .map((tag) => repairProgramTag(tag, controllerId, id, finalName, takenIds))
    .filter((tag): tag is Tag => Boolean(tag));
  const clone = deepClone(raw);
  clone.id = id;
  clone.controllerId = controllerId;
  clone.name = finalName;
  clone.routines = routines;
  clone.programTags = programTags;
  if (typeof clone.mainRoutineId === "string") {
    clone.mainRoutineId = routineIdMap.get(clone.mainRoutineId) ?? routines[0]?.id;
  }
  if (typeof clone.faultRoutineId === "string") {
    clone.faultRoutineId = routineIdMap.get(clone.faultRoutineId);
  }
  return clone as unknown as Program;
}

function programDependencyWarnings(
  project: PlcProject,
  controller: Controller,
  importedPrograms: Program[],
  dependencies?: ComponentExportDependencies,
): string[] {
  if (!dependencies) return [];
  const importedProgramTags = importedPrograms.flatMap((program) => program.programTags);
  const importedRoutines = importedPrograms.flatMap((program) => program.routines);
  const knownTags = new Set([...controller.controllerTags.map((tag) => tag.name), ...importedProgramTags.map((tag) => tag.name)]);
  const knownDataTypes = new Set([
    ...BUILTIN_ROUTINE_DATA_TYPES,
    ...controller.dataTypes.map((dataType) => dataType.name),
    ...controller.addOnInstructions.map((instruction) => instruction.name),
    ...controller.controllerTags.map((tag) => tag.dataType),
    ...importedProgramTags.map((tag) => tag.dataType),
  ]);
  const knownRoutines = new Set(importedRoutines.map((routine) => routine.name));
  const projectDeviceNames = new Set(
    project.controllers.flatMap((candidate) => candidate.ioConfiguration.modules.map((module) => module.name || module.catalogNumber)),
  );
  const missingTags = dependencies.tags.filter((name) => !knownTags.has(name));
  const missingDataTypes = dependencies.dataTypes.filter((name) => !knownDataTypes.has(name));
  const missingRoutines = dependencies.routines.filter((name) => !knownRoutines.has(name));
  const missingDevices = dependencies.devices.filter((name) => !projectDeviceNames.has(name));
  return [
    ...missingTags.map((name) => `Missing tag dependency "${name}" in target controller or imported program scope.`),
    ...missingDataTypes.map((name) => `Missing data type/AOI dependency "${name}" in target controller.`),
    ...missingRoutines.map((name) => `Missing routine dependency "${name}" in imported program.`),
    ...missingDevices.map((name) => `Missing device dependency "${name}" in the offline I/O tree.`),
  ];
}

function buildProgramImportPlan(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: ProgramImportOp[]; dependencyWarnings: string[] } | { error: string } {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return { error: `Controller "${controllerId}" was not found.` };
  if (looksLikeXml(text)) {
    return { error: "Program component import accepts ESCO-native .esco-program.json files. Use L5X project review/import for XML files." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The selected program file is not valid JSON. Choose an ESCO .esco-program.json component export." };
  }
  const extracted = extractProgramComponents(parsed);
  if ("error" in extracted) return { error: extracted.error };
  if (extracted.candidates.length === 0) return { error: "No Program components were found in this file." };

  const existing = controller.programs.map((program) => ({ id: program.id, name: program.name }));
  const existingByLower = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const takenNames = new Set(existing.map((entry) => entry.name.toLowerCase()));
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: ProgramImportOp[] = [];

  extracted.candidates.forEach((rawCandidate, index) => {
    const id = String(index);
    const cand = parseProgramCandidate(rawCandidate);
    if (!cand.valid) {
      items.push({
        id,
        sourceName: cand.sourceName,
        finalName: cand.sourceName,
        status: "error",
        conflict: false,
        availableOptions: [],
        message: cand.message,
      });
      return;
    }
    const sourceName = cand.sourceName;
    const existingMatch = existingByLower.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict
      ? ["rename", "overwrite", "skip"]
      : ["import", "skip"];
    const requested = resolutions?.[id];
    const option: ComponentImportResolutionOption =
      requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";

    if (option === "skip") {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "skip",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: `Skipped — "${sourceName}" will not be imported.`,
      });
      return;
    }

    if (option === "overwrite" && existingMatch) {
      const program = materializeProgram(cand.raw!, existingMatch.name, controllerId, existingMatch.id, takenIds);
      items.push({
        id,
        sourceName,
        finalName: existingMatch.name,
        status: "overwrite",
        conflict,
        existingName: existingMatch.name,
        availableOptions,
        message: `Overwrites existing Program "${existingMatch.name}". Existing task scheduling is preserved by id.`,
      });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, program });
      return;
    }

    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid =
        Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, true, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, true, takenNames);
      renamed = true;
    } else {
      finalName = sourceName;
    }
    takenNames.add(finalName.toLowerCase());
    const program = materializeProgram(cand.raw!, finalName, controllerId, makeUniqueId("prog", finalName, takenIds), takenIds);
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed
        ? {
            message: conflict
              ? `Renamed from "${sourceName}" — a Program with that name already exists.`
              : `Renamed from "${sourceName}" — duplicated within the import file.`,
          }
        : {}),
    });
    ops.push({ kind: "add", program });
  });

  const importedPrograms = ops.map((op) => op.program);
  const dependencyWarnings = programDependencyWarnings(project, controller, importedPrograms, extracted.dependencies);
  const reviewedItems = appendDependencyMessage(items, dependencyWarnings);
  return {
    plan: {
      ok: true,
      kindLabel: "Program",
      controllerName: controller.name,
      targetLabel: controller.name,
      sourceFormat: extracted.sourceFormat,
      items: reviewedItems,
      createCount: reviewedItems.filter((item) => item.status === "create").length,
      renameCount: reviewedItems.filter((item) => item.status === "rename").length,
      overwriteCount: reviewedItems.filter((item) => item.status === "overwrite").length,
      skipCount: reviewedItems.filter((item) => item.status === "skip").length,
      conflictCount: reviewedItems.filter((item) => item.conflict).length,
      errorCount: reviewedItems.filter((item) => item.status === "error").length,
    },
    ops,
    dependencyWarnings,
  };
}

export function previewProgramComponentImport(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ComponentImportPlan {
  const result = buildProgramImportPlan(project, controllerId, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: "Program",
      sourceFormat: "unknown",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 0,
    };
  }
  return result.plan;
}

function programImportReceipt(
  plan: ComponentImportPlan,
  importedNames: string[],
  dependencyWarnings: string[],
): ProjectActionReceipt {
  const warnings = [
    ...importWarnings(plan),
    ...dependencyWarnings,
    ...((plan.createCount + plan.renameCount) > 0
      ? ["Imported Programs are not automatically scheduled into Tasks. Add the Program to a Task after review when needed."]
      : []),
  ];
  return {
    title: "Import Program",
    summary: `Imported ${importedNames.length} Program component(s) into ${plan.targetLabel ?? "controller"}.`,
    status: warnings.length ? "warnings" : "succeeded",
    evidence: [
      {
        label: "Source",
        detail: sourceFormatLabel(plan.sourceFormat),
        status: "info",
        source: plan.sourceFormat,
      },
      {
        label: "Target controller",
        detail: plan.targetLabel ?? "Unknown controller",
        status: "info",
      },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount || dependencyWarnings.length ? "warning" : "ok",
      },
      {
        label: "Scheduling",
        detail: "Newly imported Programs are left unscheduled until an engineer adds them to a Task.",
        status: plan.createCount + plan.renameCount > 0 ? "warning" : "info",
      },
      {
        label: "Dependency review",
        detail: dependencyWarnings.length
          ? `${dependencyWarnings.length} missing dependency warning(s); run offline verify after import.`
          : "Exported program dependencies are present in the offline target model.",
        status: dependencyWarnings.length ? "warning" : "ok",
      },
      {
        label: "Imported names",
        detail: importedNames.length ? importedNames.join(", ") : "No programs imported",
        status: importedNames.length ? "ok" : "warning",
      },
    ],
    warnings,
    nextSteps: [
      {
        label: "Open imported program",
        detail: "Review routines, local tags, main routine selection, and any renamed references.",
        recommended: true,
      },
      {
        label: "Assign to a Task",
        detail: "Use Add Existing Program on a Task if this Program should scan in the virtual runtime.",
      },
      {
        label: "Run Verify Controller",
        detail: "Use offline verification to resolve missing tags, UDTs, AOIs, called routines, or device references.",
      },
    ],
  };
}

function applyProgramOps(controller: Controller, ops: ProgramImportOp[]): Controller {
  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.program]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.program);
  return {
    ...controller,
    programs: controller.programs.map((program) => overwriteById.get(program.id) ?? program).concat(adds),
  };
}

export function importProgramComponent(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<ProgramComponentImportSummary> {
  const result = buildProgramImportPlan(project, controllerId, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops, dependencyWarnings } = result;
  if (ops.length === 0) {
    return fail(project, "No Program components were imported — every entry was skipped or invalid.");
  }
  const controller = project.controllers.find((candidate) => candidate.id === controllerId)!;
  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((candidate) =>
      candidate.id === controllerId ? applyProgramOps(candidate, ops) : candidate,
    ),
  };
  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);
  return ok(next, {
    kindLabel: "Program",
    controllerName: controller.name,
    sourceFormat: plan.sourceFormat,
    created: plan.createCount,
    renamed: plan.renameCount,
    overwritten: plan.overwriteCount,
    skipped: plan.skipCount,
    errors: plan.errorCount,
    importedNames,
    dependencyWarnings,
  }, [...importWarnings(plan), ...dependencyWarnings], programImportReceipt(plan, importedNames, dependencyWarnings));
}

export type TagComponentImportTarget =
  | { scope: "controller"; controllerId: string }
  | { scope: "program"; controllerId: string; programId: string };

export interface TagComponentImportSummary {
  kindLabel: "Tag";
  controllerName: string;
  programName?: string;
  targetScope: "controller" | "program";
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  skipped: number;
  errors: number;
  importedNames: string[];
  dependencyWarnings: string[];
}

interface TagExtractResult {
  candidates: unknown[];
  dependencies?: ComponentExportDependencies;
  owner?: { type: "controller" | "program"; name?: string };
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

interface TagImportOp {
  kind: "add" | "overwrite";
  replaceId?: string;
  tag: Tag;
}

function parseTagOwner(value: unknown): TagExtractResult["owner"] {
  if (!isRecord(value)) return undefined;
  if (value.type !== "controller" && value.type !== "program") return undefined;
  return { type: value.type, ...(typeof value.name === "string" ? { name: value.name } : {}) };
}

function extractTagComponents(parsed: unknown): TagExtractResult | { error: string } {
  if (Array.isArray(parsed)) return { candidates: parsed, sourceFormat: "raw" };
  if (!isRecord(parsed)) return { error: "This file is not a recognized ESCO tag export." };
  if (parsed.format === "esco.component.export.v1") {
    if (parsed.kind !== "tag") {
      const label = componentKindLabel(parsed.kind);
      return { error: `This file contains ${label} components. Use a .esco-tag.json export for tag import.` };
    }
    return {
      candidates: asArray(parsed.payload),
      dependencies: parseDependencies(parsed.dependencies),
      owner: parseTagOwner(parsed.owner),
      sourceFormat: "component-envelope",
    };
  }
  if (typeof parsed.name === "string" && typeof parsed.dataType === "string") {
    return { candidates: [parsed], sourceFormat: "raw" };
  }
  return { error: "This file is not a recognized ESCO tag export." };
}

function findTagImportTarget(
  project: PlcProject,
  target: TagComponentImportTarget,
): { controller: Controller; program?: Program; targetLabel: string } | { error: string } {
  const controller = project.controllers.find((candidate) => candidate.id === target.controllerId);
  if (!controller) return { error: `Controller "${target.controllerId}" was not found.` };
  if (target.scope === "controller") return { controller, targetLabel: "Controller Tags" };
  const program = controller.programs.find((candidate) => candidate.id === target.programId);
  if (!program) return { error: `Program "${target.programId}" was not found in controller "${controller.name}".` };
  return { controller, program, targetLabel: `${program.name} Tags` };
}

function parseTagCandidate(raw: unknown): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no tag name." };
  }
  const sourceName = raw.name.trim();
  const reason = invalidLogixIdentifierReason(sourceName);
  if (reason) return { sourceName, valid: false, message: `Invalid tag name: ${reason}.` };
  if (typeof raw.dataType !== "string" || !raw.dataType.trim()) {
    return { sourceName, valid: false, message: "Tag payload is missing a data type." };
  }
  return { sourceName, valid: true, raw };
}

function targetTags(controller: Controller, target: TagComponentImportTarget, program?: Program): Tag[] {
  return target.scope === "controller" ? controller.controllerTags : program?.programTags ?? [];
}

function materializeTag(
  raw: Record<string, unknown>,
  finalName: string,
  controllerId: string,
  target: TagComponentImportTarget,
  id: string,
): Tag {
  const clone = deepClone(raw);
  clone.id = id;
  clone.controllerId = controllerId;
  clone.name = finalName;
  clone.scope = target.scope;
  if (target.scope === "program") {
    clone.programId = target.programId;
  } else {
    delete clone.programId;
  }
  return clone as unknown as Tag;
}

function tagDependencyWarnings(
  project: PlcProject,
  controller: Controller,
  target: TagComponentImportTarget,
  importedTags: Tag[],
  importedSourceNames: string[],
  dependencies?: ComponentExportDependencies,
  owner?: TagExtractResult["owner"],
): string[] {
  const warnings: string[] = [];
  if (owner?.type && owner.type !== target.scope) {
    const source = owner.name ? `${owner.type} "${owner.name}"` : `${owner.type} scope`;
    const destination = target.scope === "controller" ? "Controller Tags" : "Program Tags";
    warnings.push(`Source tag was exported from ${source}; it will be imported into ${destination} with the selected offline scope.`);
  }
  const knownTagNames = new Set([
    ...controller.controllerTags.map((tag) => tag.name),
    ...(target.scope === "program"
      ? controller.programs.find((program) => program.id === target.programId)?.programTags.map((tag) => tag.name) ?? []
      : []),
    ...importedTags.map((tag) => tag.name),
    ...importedSourceNames,
  ]);
  const knownDataTypes = new Set([
    ...BUILTIN_ROUTINE_DATA_TYPES,
    ...controller.dataTypes.map((dataType) => dataType.name),
    ...controller.addOnInstructions.map((instruction) => instruction.name),
    ...controller.controllerTags.map((tag) => tag.dataType),
    ...controller.programs.flatMap((program) => program.programTags.map((tag) => tag.dataType)),
  ]);
  const requiredDataTypes = new Set([
    ...importedTags.map((tag) => tag.dataType),
    ...(dependencies?.dataTypes ?? []),
  ]);
  const deviceNames = new Set(
    project.controllers.flatMap((candidate) => candidate.ioConfiguration.modules.map((module) => module.name || module.catalogNumber)),
  );
  if (dependencies) {
    const missingTags = dependencies.tags.filter((name) => !knownTagNames.has(name));
    const missingDevices = dependencies.devices.filter((name) => !deviceNames.has(name));
    warnings.push(...missingTags.map((name) => `Missing tag dependency "${name}" in the selected offline tag scope.`));
    const missingDataTypes = Array.from(requiredDataTypes).filter((name) => !knownDataTypes.has(name));
    warnings.push(...missingDataTypes.map((name) => `Missing data type/AOI dependency "${name}" in target controller.`));
    warnings.push(...missingDevices.map((name) => `Missing device dependency "${name}" in the offline I/O tree.`));
    return warnings;
  }
  const missingDataTypes = Array.from(requiredDataTypes).filter((name) => !knownDataTypes.has(name));
  warnings.push(...missingDataTypes.map((name) => `Missing data type/AOI dependency "${name}" in target controller.`));
  return warnings;
}

function buildTagImportPlan(
  project: PlcProject,
  target: TagComponentImportTarget,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: TagImportOp[]; dependencyWarnings: string[] } | { error: string } {
  const context = findTagImportTarget(project, target);
  if ("error" in context) return { error: context.error };
  if (looksLikeXml(text)) return { error: "Tag component import accepts ESCO-native .esco-tag.json files. Use L5X project review/import for XML files." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The selected tag file is not valid JSON. Choose an ESCO .esco-tag.json component export." };
  }
  const extracted = extractTagComponents(parsed);
  if ("error" in extracted) return { error: extracted.error };
  if (extracted.candidates.length === 0) return { error: "No Tag components were found in this file." };

  const existing = targetTags(context.controller, target, context.program).map((tag) => ({ id: tag.id, name: tag.name }));
  const existingByLower = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const takenNames = new Set(existing.map((entry) => entry.name.toLowerCase()));
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: TagImportOp[] = [];

  extracted.candidates.forEach((rawCandidate, index) => {
    const id = String(index);
    const cand = parseTagCandidate(rawCandidate);
    if (!cand.valid) {
      items.push({
        id,
        sourceName: cand.sourceName,
        finalName: cand.sourceName,
        status: "error",
        conflict: false,
        availableOptions: [],
        message: cand.message,
      });
      return;
    }
    const sourceName = cand.sourceName;
    const existingMatch = existingByLower.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict ? ["rename", "overwrite", "skip"] : ["import", "skip"];
    const requested = resolutions?.[id];
    const option: ComponentImportResolutionOption =
      requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";

    if (option === "skip") {
      items.push({
        id,
        sourceName,
        finalName: sourceName,
        status: "skip",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: `Skipped — "${sourceName}" will not be imported.`,
      });
      return;
    }

    if (option === "overwrite" && existingMatch) {
      const tag = materializeTag(cand.raw!, existingMatch.name, context.controller.id, target, existingMatch.id);
      items.push({
        id,
        sourceName,
        finalName: existingMatch.name,
        status: "overwrite",
        conflict,
        existingName: existingMatch.name,
        availableOptions,
        message: `Overwrites existing Tag "${existingMatch.name}" in ${context.targetLabel}.`,
      });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, tag });
      return;
    }

    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid =
        Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, true, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, true, takenNames);
      renamed = true;
    } else {
      finalName = sourceName;
    }
    takenNames.add(finalName.toLowerCase());
    const tag = materializeTag(cand.raw!, finalName, context.controller.id, target, makeUniqueId("tag", finalName, takenIds));
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed
        ? {
            message: conflict
              ? `Renamed from "${sourceName}" — a Tag with that name already exists in ${context.targetLabel}.`
              : `Renamed from "${sourceName}" — duplicated within the import file.`,
          }
        : {}),
    });
    ops.push({ kind: "add", tag });
  });

  const importedTags = ops.map((op) => op.tag);
  const importedSourceNames = items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.sourceName);
  const dependencyWarnings = tagDependencyWarnings(
    project,
    context.controller,
    target,
    importedTags,
    importedSourceNames,
    extracted.dependencies,
    extracted.owner,
  );
  const reviewedItems = appendDependencyMessage(items, dependencyWarnings);
  return {
    plan: {
      ok: true,
      kindLabel: "Tag",
      controllerName: context.controller.name,
      targetLabel: context.targetLabel,
      sourceFormat: extracted.sourceFormat,
      items: reviewedItems,
      createCount: reviewedItems.filter((item) => item.status === "create").length,
      renameCount: reviewedItems.filter((item) => item.status === "rename").length,
      overwriteCount: reviewedItems.filter((item) => item.status === "overwrite").length,
      skipCount: reviewedItems.filter((item) => item.status === "skip").length,
      conflictCount: reviewedItems.filter((item) => item.conflict).length,
      errorCount: reviewedItems.filter((item) => item.status === "error").length,
    },
    ops,
    dependencyWarnings,
  };
}

export function previewTagComponentImport(
  project: PlcProject,
  target: TagComponentImportTarget,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ComponentImportPlan {
  const result = buildTagImportPlan(project, target, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: "Tag",
      sourceFormat: "unknown",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 0,
    };
  }
  return result.plan;
}

function tagImportReceipt(
  plan: ComponentImportPlan,
  importedNames: string[],
  dependencyWarnings: string[],
): ProjectActionReceipt {
  const warnings = [...importWarnings(plan), ...dependencyWarnings];
  return {
    title: "Import Tag",
    summary: `Imported ${importedNames.length} Tag component(s) into ${plan.targetLabel ?? "tag scope"}.`,
    status: warnings.length ? "warnings" : "succeeded",
    evidence: [
      { label: "Source", detail: sourceFormatLabel(plan.sourceFormat), status: "info", source: plan.sourceFormat },
      { label: "Target tag scope", detail: plan.targetLabel ?? "Unknown tag scope", status: "info" },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount || dependencyWarnings.length ? "warning" : "ok",
      },
      {
        label: "Dependency review",
        detail: dependencyWarnings.length
          ? `${dependencyWarnings.length} dependency warning(s); run offline verify after import.`
          : "Exported tag dependencies are present in the selected offline target scope.",
        status: dependencyWarnings.length ? "warning" : "ok",
      },
      { label: "Imported names", detail: importedNames.length ? importedNames.join(", ") : "No tags imported", status: importedNames.length ? "ok" : "warning" },
    ],
    warnings,
    nextSteps: [
      { label: "Open imported tag", detail: "Review scope, data type, alias/producer metadata, dimensions, and authored value.", recommended: true },
      { label: "Run Verify Controller", detail: "Use offline verification to resolve data type, alias, produced/consumed, or device references." },
      { label: "Save ESCO project", detail: "Persist the merged offline project to an ESCO-native project file." },
    ],
  };
}

function applyTagOps(controller: Controller, target: TagComponentImportTarget, ops: TagImportOp[]): Controller {
  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.tag]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.tag);
  if (target.scope === "controller") {
    return {
      ...controller,
      controllerTags: controller.controllerTags.map((tag) => overwriteById.get(tag.id) ?? tag).concat(adds),
    };
  }
  return {
    ...controller,
    programs: controller.programs.map((program) =>
      program.id === target.programId
        ? { ...program, programTags: program.programTags.map((tag) => overwriteById.get(tag.id) ?? tag).concat(adds) }
        : program,
    ),
  };
}

export function importTagComponent(
  project: PlcProject,
  target: TagComponentImportTarget,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<TagComponentImportSummary> {
  const result = buildTagImportPlan(project, target, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops, dependencyWarnings } = result;
  if (ops.length === 0) return fail(project, "No Tag components were imported — every entry was skipped or invalid.");
  const context = findTagImportTarget(project, target);
  if ("error" in context) return fail(project, context.error);
  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) =>
      controller.id === target.controllerId ? applyTagOps(controller, target, ops) : controller,
    ),
  };
  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);
  return ok(next, {
    kindLabel: "Tag",
    controllerName: context.controller.name,
    ...(context.program ? { programName: context.program.name } : {}),
    targetScope: target.scope,
    sourceFormat: plan.sourceFormat,
    created: plan.createCount,
    renamed: plan.renameCount,
    overwritten: plan.overwriteCount,
    skipped: plan.skipCount,
    errors: plan.errorCount,
    importedNames,
    dependencyWarnings,
  }, [...importWarnings(plan), ...dependencyWarnings], tagImportReceipt(plan, importedNames, dependencyWarnings));
}

export interface TaskComponentImportSummary {
  kindLabel: "Task";
  controllerName: string;
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  skipped: number;
  errors: number;
  importedNames: string[];
  dependencyWarnings: string[];
}

interface TaskExtractResult {
  candidates: unknown[];
  dependencies?: ComponentExportDependencies;
  sourceFormat: ComponentImportPlan["sourceFormat"];
}

interface TaskImportOp {
  kind: "add" | "overwrite";
  replaceId?: string;
  task: Task;
}

function extractTaskComponents(parsed: unknown): TaskExtractResult | { error: string } {
  if (Array.isArray(parsed)) return { candidates: parsed, sourceFormat: "raw" };
  if (!isRecord(parsed)) return { error: "This file is not a recognized ESCO task export." };
  if (parsed.format === "esco.component.export.v1") {
    if (parsed.kind !== "task") {
      const label = componentKindLabel(parsed.kind);
      return { error: `This file contains ${label} components. Use a .esco-task.json export for task import.` };
    }
    return { candidates: asArray(parsed.payload), dependencies: parseDependencies(parsed.dependencies), sourceFormat: "component-envelope" };
  }
  if (typeof parsed.name === "string" && typeof parsed.type === "string" && Array.isArray(parsed.scheduledProgramIds)) {
    return { candidates: [parsed], sourceFormat: "raw" };
  }
  return { error: "This file is not a recognized ESCO task export." };
}

function parseTaskCandidate(raw: unknown): ParsedCandidate {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) {
    return { sourceName: "(unnamed)", valid: false, message: "Entry has no task name." };
  }
  const sourceName = raw.name.trim();
  const reason = invalidLogixIdentifierReason(sourceName);
  if (reason) return { sourceName, valid: false, message: `Invalid task name: ${reason}.` };
  if (raw.type !== "continuous" && raw.type !== "periodic" && raw.type !== "event") {
    return { sourceName, valid: false, message: "Task type is missing or unsupported." };
  }
  return { sourceName, valid: true, raw };
}

function materializeTask(
  raw: Record<string, unknown>,
  finalName: string,
  controllerId: string,
  id: string,
  scheduledProgramIds: string[],
): Task {
  const clone = deepClone(raw);
  clone.id = id;
  clone.controllerId = controllerId;
  clone.name = finalName;
  clone.scheduledProgramIds = scheduledProgramIds;
  return clone as unknown as Task;
}

function taskDependencyWarnings(controller: Controller, dependencies?: ComponentExportDependencies): string[] {
  if (!dependencies) return [];
  const knownProgramNames = new Set(controller.programs.map((program) => program.name));
  const knownProgramTags = new Set(controller.programs.flatMap((program) => program.programTags.map((tag) => tag.name)));
  const knownDataTypes = new Set([
    ...BUILTIN_ROUTINE_DATA_TYPES,
    ...controller.dataTypes.map((dataType) => dataType.name),
    ...controller.addOnInstructions.map((instruction) => instruction.name),
    ...controller.programs.flatMap((program) => program.programTags.map((tag) => tag.dataType)),
  ]);
  const missingTags = dependencies.tags.filter((name) => !knownProgramTags.has(name) && !controller.controllerTags.some((tag) => tag.name === name));
  const missingDataTypes = dependencies.dataTypes.filter((name) => !knownDataTypes.has(name));
  const missingPrograms = dependencies.routines.filter((name) => !knownProgramNames.has(name) && !controller.programs.some((program) => program.routines.some((routine) => routine.name === name)));
  return [
    ...missingTags.map((name) => `Missing tag dependency "${name}" in task scheduled program scope.`),
    ...missingDataTypes.map((name) => `Missing data type/AOI dependency "${name}" in target controller.`),
    ...missingPrograms.map((name) => `Missing program/routine dependency "${name}" for imported task scheduling review.`),
  ];
}

function buildTaskImportPlan(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: TaskImportOp[]; dependencyWarnings: string[] } | { error: string } {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return { error: `Controller "${controllerId}" was not found.` };
  if (looksLikeXml(text)) return { error: "Task component import accepts ESCO-native .esco-task.json files. Use L5X project review/import for XML files." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The selected task file is not valid JSON. Choose an ESCO .esco-task.json component export." };
  }
  const extracted = extractTaskComponents(parsed);
  if ("error" in extracted) return { error: extracted.error };
  if (extracted.candidates.length === 0) return { error: "No Task components were found in this file." };

  const existing = controller.tasks.map((task) => ({ id: task.id, name: task.name, scheduledProgramIds: task.scheduledProgramIds }));
  const existingByLower = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const takenNames = new Set(existing.map((entry) => entry.name.toLowerCase()));
  const takenIds = existingIds(project);
  const items: ComponentImportItem[] = [];
  const ops: TaskImportOp[] = [];

  extracted.candidates.forEach((rawCandidate, index) => {
    const id = String(index);
    const cand = parseTaskCandidate(rawCandidate);
    if (!cand.valid) {
      items.push({ id, sourceName: cand.sourceName, finalName: cand.sourceName, status: "error", conflict: false, availableOptions: [], message: cand.message });
      return;
    }
    const sourceName = cand.sourceName;
    const existingMatch = existingByLower.get(sourceName.toLowerCase());
    const conflict = Boolean(existingMatch);
    const availableOptions: ComponentImportResolutionOption[] = conflict ? ["rename", "overwrite", "skip"] : ["import", "skip"];
    const requested = resolutions?.[id];
    const option: ComponentImportResolutionOption =
      requested && availableOptions.includes(requested.option) ? requested.option : conflict ? "rename" : "import";
    if (option === "skip") {
      items.push({ id, sourceName, finalName: sourceName, status: "skip", conflict, existingName: existingMatch?.name, availableOptions, message: `Skipped — "${sourceName}" will not be imported.` });
      return;
    }
    if (option === "overwrite" && existingMatch) {
      const task = materializeTask(cand.raw!, existingMatch.name, controllerId, existingMatch.id, existingMatch.scheduledProgramIds);
      items.push({ id, sourceName, finalName: existingMatch.name, status: "overwrite", conflict, existingName: existingMatch.name, availableOptions, message: `Overwrites existing Task "${existingMatch.name}". Existing task scheduling is preserved by id.` });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, task });
      return;
    }
    let finalName: string;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid = Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, true, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, true, takenNames);
      renamed = true;
    } else {
      finalName = sourceName;
    }
    takenNames.add(finalName.toLowerCase());
    const task = materializeTask(cand.raw!, finalName, controllerId, makeUniqueId("task", finalName, takenIds), []);
    items.push({
      id,
      sourceName,
      finalName,
      status: renamed ? "rename" : "create",
      conflict,
      existingName: existingMatch?.name,
      availableOptions,
      ...(renamed ? { message: conflict ? `Renamed from "${sourceName}" — a Task with that name already exists.` : `Renamed from "${sourceName}" — duplicated within the import file.` } : {}),
    });
    ops.push({ kind: "add", task });
  });

  const dependencyWarnings = taskDependencyWarnings(controller, extracted.dependencies);
  const reviewedItems = appendDependencyMessage(items, dependencyWarnings);
  return {
    plan: {
      ok: true,
      kindLabel: "Task",
      controllerName: controller.name,
      targetLabel: controller.name,
      sourceFormat: extracted.sourceFormat,
      items: reviewedItems,
      createCount: reviewedItems.filter((item) => item.status === "create").length,
      renameCount: reviewedItems.filter((item) => item.status === "rename").length,
      overwriteCount: reviewedItems.filter((item) => item.status === "overwrite").length,
      skipCount: reviewedItems.filter((item) => item.status === "skip").length,
      conflictCount: reviewedItems.filter((item) => item.conflict).length,
      errorCount: reviewedItems.filter((item) => item.status === "error").length,
    },
    ops,
    dependencyWarnings,
  };
}

export function previewTaskComponentImport(project: PlcProject, controllerId: string, text: string, resolutions?: ComponentImportResolutionMap): ComponentImportPlan {
  const result = buildTaskImportPlan(project, controllerId, text, resolutions);
  if ("error" in result) {
    return { ok: false, error: result.error, kindLabel: "Task", sourceFormat: "unknown", items: [], createCount: 0, renameCount: 0, overwriteCount: 0, skipCount: 0, conflictCount: 0, errorCount: 0 };
  }
  return result.plan;
}

function taskImportReceipt(plan: ComponentImportPlan, importedNames: string[], dependencyWarnings: string[]): ProjectActionReceipt {
  const warnings = [
    ...importWarnings(plan),
    ...dependencyWarnings,
    ...((plan.createCount + plan.renameCount) > 0 ? ["Imported Tasks are not automatically scheduled with Programs. Add Programs to the Task after review when needed."] : []),
  ];
  return {
    title: "Import Task",
    summary: `Imported ${importedNames.length} Task component(s) into ${plan.targetLabel ?? "controller"}.`,
    status: warnings.length ? "warnings" : "succeeded",
    evidence: [
      { label: "Source", detail: sourceFormatLabel(plan.sourceFormat), status: "info", source: plan.sourceFormat },
      { label: "Target controller", detail: plan.targetLabel ?? "Unknown controller", status: "info" },
      { label: "Resolution", detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`, status: plan.errorCount || plan.skipCount || dependencyWarnings.length ? "warning" : "ok" },
      { label: "Scheduling", detail: "Newly imported Tasks are left without scheduled Programs until an engineer reviews them.", status: plan.createCount + plan.renameCount > 0 ? "warning" : "info" },
      { label: "Dependency review", detail: dependencyWarnings.length ? `${dependencyWarnings.length} dependency warning(s); run offline verify after import.` : "Exported task dependencies are present for offline review.", status: dependencyWarnings.length ? "warning" : "ok" },
      { label: "Imported names", detail: importedNames.length ? importedNames.join(", ") : "No tasks imported", status: importedNames.length ? "ok" : "warning" },
    ],
    warnings,
    nextSteps: [
      { label: "Open imported task", detail: "Review task type, period, priority, watchdog, and inhibited state.", recommended: true },
      { label: "Assign Programs", detail: "Use Add Existing Program if the Task should scan logic in the virtual runtime." },
      { label: "Run Verify Controller", detail: "Use offline verification after assigning Programs and dependencies." },
    ],
  };
}

function applyTaskOps(controller: Controller, ops: TaskImportOp[]): Controller {
  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.task]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.task);
  return { ...controller, tasks: controller.tasks.map((task) => overwriteById.get(task.id) ?? task).concat(adds) };
}

export function importTaskComponent(project: PlcProject, controllerId: string, text: string, resolutions?: ComponentImportResolutionMap): ProjectActionResult<TaskComponentImportSummary> {
  const result = buildTaskImportPlan(project, controllerId, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops, dependencyWarnings } = result;
  if (ops.length === 0) return fail(project, "No Task components were imported — every entry was skipped or invalid.");
  const controller = project.controllers.find((candidate) => candidate.id === controllerId)!;
  const next: PlcProject = { ...project, controllers: project.controllers.map((candidate) => candidate.id === controllerId ? applyTaskOps(candidate, ops) : candidate) };
  const importedNames = plan.items.filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite").map((item) => item.finalName);
  return ok(next, {
    kindLabel: "Task",
    controllerName: controller.name,
    sourceFormat: plan.sourceFormat,
    created: plan.createCount,
    renamed: plan.renameCount,
    overwritten: plan.overwriteCount,
    skipped: plan.skipCount,
    errors: plan.errorCount,
    importedNames,
    dependencyWarnings,
  }, [...importWarnings(plan), ...dependencyWarnings], taskImportReceipt(plan, importedNames, dependencyWarnings));
}
