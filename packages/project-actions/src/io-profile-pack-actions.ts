import type { Controller, IoModule, PlcProject } from "@esco/core";
import { nowIso } from "@esco/shared";
import type {
  ComponentImportItem,
  ComponentImportPlan,
  ComponentImportResolutionMap,
  ComponentImportResolutionOption,
} from "./component-import";
import { fail, ok } from "./helpers";
import { invalidLogixIdentifierReason } from "./logix-names";
import {
  createNativeFileEnvelope,
  getEscoNativeFormat,
  parseNativeFileEnvelope,
  serializeNativeFileEnvelope,
} from "./native-format";
import type { ProjectActionReceipt, ProjectActionResult } from "./types";

export interface IoProfilePackPayload {
  controller: {
    id: string;
    name: string;
  };
  modules: IoModule[];
  boundaries: string[];
}

export interface IoProfilePackExportData {
  fileName: string;
  mediaType: "application/vnd.esco.io+json";
  text: string;
  envelope: ReturnType<typeof createNativeFileEnvelope<IoProfilePackPayload>>;
}

export interface IoProfilePackImportSummary {
  kindLabel: "I/O Module Profile";
  controllerName: string;
  sourceFormat: ComponentImportPlan["sourceFormat"];
  created: number;
  renamed: number;
  overwritten: number;
  skipped: number;
  errors: number;
  importedNames: string[];
}

type ModuleImportOp = { kind: "add" | "overwrite"; replaceId?: string; sourceName: string; module: IoModule };

const IO_PROFILE_PACK_BOUNDARIES = [
  "ESCO-owned offline metadata only.",
  "No AOP install parsing or vendor profile download.",
  "No hardware browse, module command, RPI scheduling, or controller communication.",
  "No PLC upload/download, go-online, online-edit, physical forces, or proprietary binary project support.",
] as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFilePart(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "io-profile-pack";
}

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

function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let counter = 1; counter < 10000; counter += 1) {
    const suffix = `_${counter}`;
    const candidate =
      base.length + suffix.length > 40 ? `${base.slice(0, 40 - suffix.length).replace(/_+$/, "")}${suffix}` : `${base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

function normalizeModule(raw: unknown): { ok: true; module: IoModule } | { ok: false; sourceName: string; message: string } {
  if (!isRecord(raw)) return { ok: false, sourceName: "(unnamed)", message: "Entry is not an object." };
  const sourceName = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!sourceName) return { ok: false, sourceName: "(unnamed)", message: "I/O module entry has no name." };
  const invalidName = invalidLogixIdentifierReason(sourceName);
  if (invalidName) return { ok: false, sourceName, message: `Invalid I/O module name: ${invalidName}.` };
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "import";
  const module = { ...(cloneJson(raw) as unknown as IoModule), id, name: sourceName };
  if (!Array.isArray(module.ports)) delete module.ports;
  if (!Array.isArray(module.connections)) delete module.connections;
  return { ok: true, module };
}

function parseIoProfilePack(text: string): { ok: true; modules: IoModule[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The selected I/O profile pack is not valid JSON." };
  }

  if (isRecord(parsed) && (parsed.formatName === getEscoNativeFormat("io").name || parsed.extension === ".easio")) {
    const result = parseNativeFileEnvelope<IoProfilePackPayload>(text, { expectedKind: "io" });
    if (!result.ok || !result.file) return { ok: false, error: result.error ?? result.errors.join(" ") };
    const payload = result.file.payload;
    if (!isRecord(payload) || !Array.isArray(payload.modules)) {
      return { ok: false, error: "ESCO I/O profile pack is missing its modules array." };
    }
    return { ok: true, modules: payload.modules as IoModule[] };
  }

  if (isRecord(parsed) && parsed.format === "esco.component.export.v1" && parsed.kind === "device-tree") {
    const payload = parsed.payload;
    if (!isRecord(payload) || !Array.isArray(payload.modules)) {
      return { ok: false, error: "ESCO device-tree component is missing its modules array." };
    }
    return { ok: true, modules: payload.modules as IoModule[] };
  }

  if (isRecord(parsed) && Array.isArray(parsed.modules)) return { ok: true, modules: parsed.modules as IoModule[] };
  return { ok: false, error: "This file is not an ESCO I/O profile pack or device-tree export." };
}

function slotKey(module: IoModule): string | undefined {
  if (module.slot == null || Number.isNaN(module.slot)) return undefined;
  return `${module.parentModule ?? ""}::${module.parentPortId ?? ""}::${Math.trunc(module.slot)}`.toLowerCase();
}

function slotConflict(
  controller: Controller,
  module: IoModule,
  importedByName: Map<string, string>,
  excludeModuleId?: string,
): string | undefined {
  const remappedParent = module.parentModule ? importedByName.get(module.parentModule.toLowerCase()) ?? module.parentModule : undefined;
  const candidate: IoModule = { ...module, ...(remappedParent ? { parentModule: remappedParent } : {}) };
  const key = slotKey(candidate);
  if (!key) return undefined;
  const match = controller.ioConfiguration.modules.find(
    (existing) => existing.id !== excludeModuleId && slotKey(existing) === key,
  );
  return match?.name;
}

function planReceipt(plan: ComponentImportPlan, importedNames: string[]): ProjectActionReceipt {
  const warnings = plan.items.flatMap((item) => {
    if (item.status === "rename") return [`I/O module profile "${item.sourceName}" was imported as "${item.finalName}".`];
    if (item.status === "overwrite") return [`I/O module profile "${item.sourceName}" overwrote "${item.finalName}".`];
    if (item.status === "skip") return [`I/O module profile "${item.sourceName}" was skipped.`];
    if (item.status === "error") return [`I/O module profile "${item.sourceName}" was rejected.${item.message ? ` ${item.message}` : ""}`];
    return [];
  });
  return {
    title: "Import ESCO I/O Profile Pack",
    summary: `Imported ${importedNames.length} offline I/O module profile(s) into ${plan.controllerName ?? "controller"}.`,
    status: plan.errorCount || plan.skipCount || plan.renameCount || plan.overwriteCount ? "warnings" : "succeeded",
    evidence: [
      { label: "Source", detail: "ESCO I/O profile pack (.easio)", status: "info", source: "esco-io-profile-pack" },
      { label: "Target controller", detail: plan.controllerName ?? "Unknown controller", status: "info" },
      {
        label: "Resolution",
        detail: `${plan.createCount} created, ${plan.renameCount} renamed, ${plan.overwriteCount} overwritten, ${plan.skipCount} skipped, ${plan.errorCount} rejected.`,
        status: plan.errorCount || plan.skipCount ? "warning" : "ok",
      },
      {
        label: "Offline boundary",
        detail: "Imported metadata only; no AOP install parsing, hardware browse, module command, or controller communication.",
        status: "ok",
        source: "offline-only",
      },
    ],
    warnings,
    nextSteps: [
      {
        label: "Review module profile rows",
        detail: "Open I/O Configuration and confirm ports, channels, keying, RPI, and diagnostic metadata.",
        recommended: true,
      },
      {
        label: "Run Verify Controller",
        detail: "Use offline validation to catch duplicate slots, missing parents, and profile metadata gaps.",
      },
    ],
  };
}

function buildIoProfilePackPlan(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): { plan: ComponentImportPlan; ops: ModuleImportOp[] } | { error: string } {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return { error: `Controller "${controllerId}" was not found.` };
  const parsed = parseIoProfilePack(text);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.modules.length === 0) return { error: "No I/O module profiles were found in this pack." };

  const existingByLower = new Map(controller.ioConfiguration.modules.map((module) => [module.name.toLowerCase(), module]));
  const takenNames = new Set(controller.ioConfiguration.modules.map((module) => module.name.toLowerCase()));
  const takenIds = existingIds(project);
  const importedNameMap = new Map<string, string>();
  const items: ComponentImportItem[] = [];
  const ops: ModuleImportOp[] = [];

  parsed.modules.forEach((rawModule, index) => {
    const id = String(index);
    const normalized = normalizeModule(rawModule);
    if (!normalized.ok) {
      items.push({
        id,
        sourceName: normalized.sourceName,
        finalName: normalized.sourceName,
        status: "error",
        conflict: false,
        availableOptions: [],
        message: normalized.message,
      });
      return;
    }

    const sourceName = normalized.module.name;
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
      const finalModule = { ...cloneJson(normalized.module), id: existingMatch.id, name: existingMatch.name };
      const slotOwner = slotConflict(controller, finalModule, importedNameMap, existingMatch.id);
      if (slotOwner) {
        items.push({
          id,
          sourceName,
          finalName: existingMatch.name,
          status: "error",
          conflict,
          existingName: existingMatch.name,
          availableOptions,
          message: `Slot ${finalModule.slot} is already used by "${slotOwner}".`,
        });
        return;
      }
      importedNameMap.set(sourceName.toLowerCase(), existingMatch.name);
      items.push({
        id,
        sourceName,
        finalName: existingMatch.name,
        status: "overwrite",
        conflict,
        existingName: existingMatch.name,
        availableOptions,
        message: `Overwrites existing I/O module profile "${existingMatch.name}".`,
      });
      ops.push({ kind: "overwrite", replaceId: existingMatch.id, sourceName, module: finalModule });
      return;
    }

    let finalName = sourceName;
    let renamed = false;
    if (option === "rename") {
      const explicit = requested?.renameTo?.trim();
      const explicitValid =
        Boolean(explicit) && !takenNames.has(explicit!.toLowerCase()) && !invalidLogixIdentifierReason(explicit!);
      finalName = explicitValid ? explicit! : freeName(sourceName, takenNames);
      renamed = true;
    } else if (takenNames.has(sourceName.toLowerCase())) {
      finalName = freeName(sourceName, takenNames);
      renamed = true;
    }
    const finalModule = {
      ...cloneJson(normalized.module),
      id: makeUniqueId("iomod", finalName, takenIds),
      name: finalName,
    };
    const slotOwner = slotConflict(controller, finalModule, importedNameMap);
    if (slotOwner) {
      items.push({
        id,
        sourceName,
        finalName,
        status: "error",
        conflict,
        existingName: existingMatch?.name,
        availableOptions,
        message: `Slot ${finalModule.slot} is already used by "${slotOwner}". Choose overwrite when replacing an existing module, or edit the target slot first.`,
      });
      return;
    }
    takenNames.add(finalName.toLowerCase());
    importedNameMap.set(sourceName.toLowerCase(), finalName);
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
              ? `Renamed from "${sourceName}" — a module with that name already exists.`
              : `Renamed from "${sourceName}" — duplicated within the import file.`,
          }
        : {}),
    });
    ops.push({ kind: "add", sourceName, module: finalModule });
  });

  const remappedOps = ops.map((op) => {
    const parent = op.module.parentModule;
    const remappedParent = parent ? importedNameMap.get(parent.toLowerCase()) : undefined;
    return remappedParent ? { ...op, module: { ...op.module, parentModule: remappedParent } } : op;
  });

  return {
    plan: {
      ok: true,
      kindLabel: "I/O Module Profile",
      controllerName: controller.name,
      targetLabel: controller.name,
      sourceFormat: "esco-io-profile-pack",
      items,
      createCount: items.filter((item) => item.status === "create").length,
      renameCount: items.filter((item) => item.status === "rename").length,
      overwriteCount: items.filter((item) => item.status === "overwrite").length,
      skipCount: items.filter((item) => item.status === "skip").length,
      conflictCount: items.filter((item) => item.conflict).length,
      errorCount: items.filter((item) => item.status === "error").length,
    },
    ops: remappedOps,
  };
}

export function exportIoProfilePack(
  project: PlcProject,
  controllerId: string,
): ProjectActionResult<IoProfilePackExportData> {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" was not found for I/O profile-pack export.`);
  const payload: IoProfilePackPayload = {
    controller: { id: controller.id, name: controller.name },
    modules: cloneJson(controller.ioConfiguration.modules),
    boundaries: [...IO_PROFILE_PACK_BOUNDARIES],
  };
  const envelope = createNativeFileEnvelope("io", payload);
  return ok(project, {
    fileName: `${safeFilePart(controller.name)}-io-profile-pack.easio`,
    mediaType: getEscoNativeFormat("io").mediaType as "application/vnd.esco.io+json",
    text: serializeNativeFileEnvelope(envelope),
    envelope,
  });
}

export function previewIoProfilePackImport(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ComponentImportPlan {
  const result = buildIoProfilePackPlan(project, controllerId, text, resolutions);
  if ("error" in result) {
    return {
      ok: false,
      error: result.error,
      kindLabel: "I/O Module Profile",
      sourceFormat: "esco-io-profile-pack",
      items: [],
      createCount: 0,
      renameCount: 0,
      overwriteCount: 0,
      skipCount: 0,
      conflictCount: 0,
      errorCount: 1,
    };
  }
  return result.plan;
}

export function importIoProfilePack(
  project: PlcProject,
  controllerId: string,
  text: string,
  resolutions?: ComponentImportResolutionMap,
): ProjectActionResult<IoProfilePackImportSummary> {
  const result = buildIoProfilePackPlan(project, controllerId, text, resolutions);
  if ("error" in result) return fail(project, result.error);
  const { plan, ops } = result;
  if (ops.length === 0) return fail(project, "No I/O module profiles were imported — every entry was skipped or invalid.");

  const overwriteById = new Map(ops.filter((op) => op.kind === "overwrite").map((op) => [op.replaceId!, op.module]));
  const adds = ops.filter((op) => op.kind === "add").map((op) => op.module);
  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((controller) =>
      controller.id === controllerId
        ? {
            ...controller,
            ioConfiguration: {
              ...controller.ioConfiguration,
              modules: controller.ioConfiguration.modules
                .map((module) => overwriteById.get(module.id) ?? module)
                .concat(adds),
            },
          }
        : controller,
    ),
  };
  const importedNames = plan.items
    .filter((item) => item.status === "create" || item.status === "rename" || item.status === "overwrite")
    .map((item) => item.finalName);
  const warnings = planReceipt(plan, importedNames).warnings;
  return ok(
    next,
    {
      kindLabel: "I/O Module Profile",
      controllerName: plan.controllerName ?? "",
      sourceFormat: "esco-io-profile-pack",
      created: plan.createCount,
      renamed: plan.renameCount,
      overwritten: plan.overwriteCount,
      skipped: plan.skipCount,
      errors: plan.errorCount,
      importedNames,
    },
    warnings,
    planReceipt(plan, importedNames),
  );
}
