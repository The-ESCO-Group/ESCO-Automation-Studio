import type { PlcProject } from "@esco/core";
import { createId, nowIso } from "@esco/shared";
import {
  createHmiElement,
  getHmiElementDefinition,
  createHmiPopup as makeHmiPopup,
  createHmiScreen as makeHmiScreen,
  ensureHmiProject as ensureHmiModelProject,
  getHmiProject,
  importHmiLanguagePackCsv,
  touchHmiProject,
  validateHmiProject,
  withHmiProject,
  type HmiAddOnGraphicDefinition,
  type HmiCommand,
  type HmiControllerReference,
  type HmiControllerReferenceAlarm,
  type HmiControllerReferenceDataType,
  type HmiControllerReferenceSourceKind,
  type HmiControllerReferenceSyncStatus,
  type HmiControllerReferenceTag,
  type HmiAlarmDefinition,
  type HmiAlarmSeverity,
  type HmiAlarmTriggerKind,
  type HmiBindingSourceKind,
  type HmiDataLog,
  type HmiGraphicElement,
  type HmiLanguagePack,
  type HmiProject,
  type HmiPropertyBinding,
  type HmiRecipe,
  type HmiRecipeItem,
  type HmiRecipeValue,
  type HmiStyle,
  type HmiSurfaceKind,
  type HmiTrend,
} from "@esco/hmi-model";
import { fail, getAllTags, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

export interface CreateHmiScreenInput {
  name: string;
  screenId?: string;
  width?: number;
  height?: number;
}

export interface CreateHmiPopupInput {
  name: string;
  popupId?: string;
  width?: number;
  height?: number;
}

export interface CreateHmiAddOnGraphicInput {
  name: string;
  addOnGraphicId?: string;
  width?: number;
  height?: number;
  vendor?: string;
  revision?: string;
  properties?: HmiAddOnGraphicDefinition["properties"];
}

export interface AddHmiElementInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  typeId: string;
  elementId?: string;
  name?: string;
  preservedPayload?: unknown;
}

export interface UpdateHmiElementGeometryInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  geometry: HmiGraphicElement["geometry"];
}

export interface SetHmiElementBindingInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  binding: HmiPropertyBinding;
}

export interface AddHmiEventCommandInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  eventType: "press" | "release" | "state-enter" | "state-exit" | "value-change" | "load" | "unload";
  command: HmiCommand;
}

export interface AddHmiControllerReferenceInput {
  controllerId: string;
  referenceId?: string;
  name?: string;
  sourceKind?: HmiControllerReferenceSourceKind;
  sourcePath?: string;
  sourceHash?: string;
  syncStatus?: HmiControllerReferenceSyncStatus;
  statusMessage?: string;
  secured?: boolean;
  lastSyncedAt?: string;
}

export interface UpdateHmiControllerReferenceStatusInput {
  referenceId: string;
  syncStatus: HmiControllerReferenceSyncStatus;
  statusMessage?: string;
  sourceHash?: string;
  secured?: boolean;
  lastSyncedAt?: string | null;
}

export interface RemoveHmiControllerReferenceInput {
  referenceId: string;
}

function knownTagPaths(project: PlcProject): string[] {
  return getAllTags(project).map((tag) => tag.name);
}

function hmiWarnings(project: PlcProject, hmi: HmiProject): string[] {
  return validateHmiProject(hmi, { knownTagPaths: knownTagPaths(project) })
    .filter((finding) => finding.severity !== "info")
    .map((finding) => finding.message);
}

function commitHmi<T>(
  project: PlcProject,
  hmi: HmiProject,
  data: T,
  warnings: string[] = [],
): ProjectActionResult<T> {
  const touched = touchHmiProject(hmi);
  const next = withHmiProject(project, touched) as PlcProject;
  return ok(next, data, [...warnings, ...hmiWarnings(next, touched)]);
}

function surfaceLabel(kind: HmiSurfaceKind): string {
  if (kind === "system-banner") return "system banner";
  if (kind === "add-on-graphic") return "add-on graphic";
  return kind;
}

function optionalId(value: string | undefined, label: string): { ok: true; id?: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  const id = value.trim();
  if (!id) return { ok: false, error: `${label} id cannot be blank.` };
  return { ok: true, id };
}

function optionalText(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  return value.trim() || undefined;
}

function validSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

type ControllerModel = PlcProject["controllers"][number];
type ProgramModel = ControllerModel["programs"][number];
type TagModel = ControllerModel["controllerTags"][number];

function tagReferencePath(tag: TagModel, program?: ProgramModel): string {
  return program ? `Program:${program.name}.${tag.name}` : tag.name;
}

function tagReferenceSnapshot(tag: TagModel, program?: ProgramModel): HmiControllerReferenceTag {
  return {
    path: tagReferencePath(tag, program),
    name: tag.name,
    dataType: tag.dataType,
    scope: program ? "program" : "controller",
    programName: program?.name,
    externalAccess: tag.externalAccess,
    constant: tag.constant,
    produced: tag.produced,
    consumed: tag.consumed,
    description: tag.description,
  };
}

function dataTypeReferenceSnapshots(controller: ControllerModel): HmiControllerReferenceDataType[] {
  return [
    ...controller.dataTypes.map((dataType) => ({
      name: dataType.name,
      family: "udt" as const,
      memberCount: dataType.members.length,
      description: dataType.description,
    })),
    ...controller.addOnInstructions.map((aoi) => ({
      name: aoi.name,
      family: "aoi" as const,
      memberCount: aoi.parameters.length + aoi.localTags.length,
      description: aoi.description,
    })),
  ];
}

function alarmKind(dataType: string): HmiControllerReferenceAlarm["kind"] {
  const normalized = dataType.trim().toUpperCase();
  if (normalized === "ALARM_ANALOG") return "analog";
  if (normalized === "ALARM_DIGITAL") return "digital";
  return "unknown";
}

function alarmReferenceSnapshots(tags: HmiControllerReferenceTag[]): HmiControllerReferenceAlarm[] {
  return tags
    .filter((tag) => tag.dataType.trim().toUpperCase() === "ALARM_ANALOG" || tag.dataType.trim().toUpperCase() === "ALARM_DIGITAL")
    .map((tag) => ({
      name: tag.name,
      tagPath: tag.path,
      kind: alarmKind(tag.dataType),
      dataType: tag.dataType,
      scope: tag.scope,
      programName: tag.programName,
      description: tag.description,
    }));
}

function buildControllerReference(
  project: PlcProject,
  controller: ControllerModel,
  input: AddHmiControllerReferenceInput,
  referenceId: string,
): HmiControllerReference {
  const controllerTags = controller.controllerTags.map((tag) => tagReferenceSnapshot(tag));
  const programTags = controller.programs.flatMap((program) =>
    program.programTags.map((tag) => tagReferenceSnapshot(tag, program)),
  );
  const tags = [...controllerTags, ...programTags];
  const dataTypes = dataTypeReferenceSnapshots(controller);
  const alarms = alarmReferenceSnapshots(tags);
  const syncStatus = input.syncStatus ?? (input.sourceKind === "secured-offline-reference" || input.secured ? "secured" : "synchronized");

  return {
    id: referenceId,
    name: optionalText(input.name) ?? controller.name,
    controllerName: controller.name,
    sourceKind: input.sourceKind ?? "plcproj",
    sourcePath: optionalText(input.sourcePath),
    sourceProjectId: project.id,
    sourceControllerId: controller.id,
    sourceHash: optionalText(input.sourceHash),
    syncStatus,
    statusMessage: optionalText(input.statusMessage),
    lastSyncedAt: input.lastSyncedAt ?? (syncStatus === "synchronized" ? nowIso() : undefined),
    secured: input.secured,
    snapshot: {
      controllerTagCount: controllerTags.length,
      programTagCount: programTags.length,
      dataTypeCount: dataTypes.length,
      alarmCount: alarms.length,
    },
    tags,
    dataTypes,
    alarms,
  };
}

function copyAddOnGraphicProperties(
  properties: HmiAddOnGraphicDefinition["properties"] | undefined,
): HmiAddOnGraphicDefinition["properties"] {
  return (properties ?? []).map((property) => ({ ...property }));
}

function mapSurfaceElements(
  hmi: HmiProject,
  kind: HmiSurfaceKind,
  surfaceId: string,
  mapper: (elements: HmiGraphicElement[]) => HmiGraphicElement[],
): HmiProject | undefined {
  if (kind === "screen") {
    let found = false;
    const screens = hmi.screens.map((screen) => {
      if (screen.id !== surfaceId) return screen;
      found = true;
      return { ...screen, elements: mapper(screen.elements) };
    });
    return found ? { ...hmi, screens } : undefined;
  }
  if (kind === "popup") {
    let found = false;
    const popups = hmi.popups.map((popup) => {
      if (popup.id !== surfaceId) return popup;
      found = true;
      return { ...popup, elements: mapper(popup.elements) };
    });
    return found ? { ...hmi, popups } : undefined;
  }
  if (kind === "system-banner") {
    if (hmi.systemBanner.id !== surfaceId) return undefined;
    return { ...hmi, systemBanner: { ...hmi.systemBanner, elements: mapper(hmi.systemBanner.elements) } };
  }
  if (kind === "add-on-graphic") {
    let found = false;
    const addOnGraphics = hmi.addOnGraphics.map((definition) => {
      if (definition.id !== surfaceId) return definition;
      found = true;
      return { ...definition, elements: mapper(definition.elements) };
    });
    return found ? { ...hmi, addOnGraphics } : undefined;
  }
  return undefined;
}

function normalizedSurfaceSecurityRoleIds(hmi: HmiProject, roleIds: readonly string[]): string[] | undefined {
  const known = new Set(hmi.security.roles.map((role) => role.id));
  const normalized: string[] = [];
  for (const raw of roleIds) {
    const roleId = raw.trim();
    if (!roleId || normalized.includes(roleId)) continue;
    if (!known.has(roleId)) return undefined;
    normalized.push(roleId);
  }
  return normalized;
}

export function ensureHmiProject(project: PlcProject): ProjectActionResult<{ hmiProjectId: string }> {
  const existing = getHmiProject(project);
  if (existing) return ok(project, { hmiProjectId: existing.id });

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  return commitHmi(project, hmi, { hmiProjectId: hmi.id });
}

export function addHmiControllerReference(
  project: PlcProject,
  input: AddHmiControllerReferenceInput,
): ProjectActionResult<{ referenceId: string }> {
  const controller = project.controllers.find((candidate) => candidate.id === input.controllerId);
  if (!controller) return fail(project, "Controller was not found.");
  const requestedId = optionalId(input.referenceId, "HMI controller reference");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  const referenceId = requestedId.id ?? createId("hmicref");
  const name = optionalText(input.name) ?? controller.name;
  const references = hmi.controllerReferences ?? [];
  if (references.some((reference) => reference.id === referenceId)) {
    return fail(project, `HMI controller reference id "${referenceId}" already exists.`);
  }
  if (references.some((reference) => reference.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI controller reference "${name}" already exists.`);
  }

  const reference = buildControllerReference(project, controller, { ...input, name }, referenceId);
  const next = { ...hmi, controllerReferences: [...references, reference] };
  return commitHmi(project, next, { referenceId });
}

export function updateHmiControllerReferenceStatus(
  project: PlcProject,
  input: UpdateHmiControllerReferenceStatusInput,
): ProjectActionResult<{ referenceId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  let updated = false;
  const references = hmi.controllerReferences ?? [];
  const nextReferences = references.map((reference) => {
    if (reference.id !== input.referenceId) return reference;
    updated = true;
    return {
      ...reference,
      syncStatus: input.syncStatus,
      ...(input.statusMessage !== undefined ? { statusMessage: optionalText(input.statusMessage) } : {}),
      ...(input.sourceHash !== undefined ? { sourceHash: optionalText(input.sourceHash) } : {}),
      ...(input.secured !== undefined ? { secured: input.secured } : {}),
      ...(input.lastSyncedAt !== undefined
        ? { lastSyncedAt: input.lastSyncedAt === null ? undefined : optionalText(input.lastSyncedAt) }
        : input.syncStatus === "synchronized"
          ? { lastSyncedAt: reference.lastSyncedAt ?? nowIso() }
          : {}),
    };
  });
  if (!updated) return fail(project, "HMI controller reference was not found.");
  return commitHmi(project, { ...hmi, controllerReferences: nextReferences }, { referenceId: input.referenceId });
}

export function removeHmiControllerReference(
  project: PlcProject,
  input: RemoveHmiControllerReferenceInput,
): ProjectActionResult<{ referenceId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const references = hmi.controllerReferences ?? [];
  if (!references.some((reference) => reference.id === input.referenceId)) {
    return fail(project, "HMI controller reference was not found.");
  }
  return commitHmi(
    project,
    { ...hmi, controllerReferences: references.filter((reference) => reference.id !== input.referenceId) },
    { referenceId: input.referenceId },
  );
}

export function createHmiScreen(
  project: PlcProject,
  input: CreateHmiScreenInput,
): ProjectActionResult<{ screenId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI screen name is required.");
  const requestedId = optionalId(input.screenId, "HMI screen");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.screens.some((screen) => screen.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI screen "${name}" already exists.`);
  }
  if (requestedId.id && hmi.screens.some((screen) => screen.id === requestedId.id)) {
    return fail(project, `HMI screen id "${requestedId.id}" already exists.`);
  }

  const screen = makeHmiScreen(name, hmi.targetDevice);
  const sized = {
    ...screen,
    id: requestedId.id ?? screen.id,
    width: input.width ?? screen.width,
    height: input.height ?? screen.height,
  };
  const next: HmiProject = {
    ...hmi,
    homeScreenId: hmi.homeScreenId ?? sized.id,
    screens: [...hmi.screens, sized],
  };
  return commitHmi(project, next, { screenId: sized.id });
}

export function createHmiPopup(
  project: PlcProject,
  input: CreateHmiPopupInput,
): ProjectActionResult<{ popupId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI popup name is required.");
  const requestedId = optionalId(input.popupId, "HMI popup");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.popups.some((popup) => popup.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI popup "${name}" already exists.`);
  }
  if (requestedId.id && hmi.popups.some((popup) => popup.id === requestedId.id)) {
    return fail(project, `HMI popup id "${requestedId.id}" already exists.`);
  }
  const popupBase = makeHmiPopup(name, input.width, input.height);
  const popup = { ...popupBase, id: requestedId.id ?? popupBase.id };
  const next = { ...hmi, popups: [...hmi.popups, popup] };
  return commitHmi(project, next, { popupId: popup.id });
}

export function createHmiAddOnGraphic(
  project: PlcProject,
  input: CreateHmiAddOnGraphicInput,
): ProjectActionResult<{ addOnGraphicId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI Add-On Graphic name is required.");
  const requestedId = optionalId(input.addOnGraphicId, "HMI Add-On Graphic");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.addOnGraphics.some((graphic) => graphic.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI Add-On Graphic "${name}" already exists.`);
  }
  if (requestedId.id && hmi.addOnGraphics.some((graphic) => graphic.id === requestedId.id)) {
    return fail(project, `HMI Add-On Graphic id "${requestedId.id}" already exists.`);
  }

  const width = input.width ?? 320;
  const height = input.height ?? 180;
  if (!validSize(width, height)) {
    return fail(project, "HMI Add-On Graphic width and height must be greater than zero.");
  }

  const graphic: HmiAddOnGraphicDefinition = {
    id: requestedId.id ?? createId("hmiaog"),
    name,
    vendor: optionalText(input.vendor),
    revision: optionalText(input.revision),
    width,
    height,
    properties: copyAddOnGraphicProperties(input.properties),
    elements: [],
  };
  const next = { ...hmi, addOnGraphics: [...hmi.addOnGraphics, graphic] };
  return commitHmi(project, next, { addOnGraphicId: graphic.id });
}

export function addHmiElement(
  project: PlcProject,
  input: AddHmiElementInput,
): ProjectActionResult<{ elementId: string }> {
  const typeId = input.typeId?.trim();
  if (!typeId) return fail(project, "HMI element typeId is required.");
  const requestedId = optionalId(input.elementId, "HMI element");
  if (!requestedId.ok) return fail(project, requestedId.error);
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "Create or enable an HMI project before adding graphic elements.");

  const definition = getHmiElementDefinition(typeId);
  const element = createHmiElement(typeId, input.name, input.preservedPayload);
  let duplicate = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) => {
    const elementId = requestedId.id ?? element.id;
    if (elements.some((candidate) => candidate.id === elementId)) {
      duplicate = true;
      return elements;
    }
    return [...elements, { ...element, id: elementId, zIndex: elements.length }];
  });
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (duplicate) return fail(project, `HMI element id "${requestedId.id}" already exists on that surface.`);

  const elementId = requestedId.id ?? element.id;
  const readonlyWarning = definition ? [] : [`${element.typeId} was added as read-only unsupported content.`];
  return commitHmi(project, next, { elementId }, readonlyWarning);
}

export function updateHmiElementGeometry(
  project: PlcProject,
  input: UpdateHmiElementGeometryInput,
): ProjectActionResult<{ elementId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (input.geometry.width <= 0 || input.geometry.height <= 0) {
    return fail(project, "HMI element width and height must be greater than zero.");
  }

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      return { ...element, geometry: { ...input.geometry } };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId });
}

export function setHmiElementBinding(
  project: PlcProject,
  input: SetHmiElementBindingInput,
): ProjectActionResult<{ elementId: string; bindingId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      const others = element.bindings.filter((binding) => binding.id !== input.binding.id);
      return { ...element, bindings: [...others, input.binding] };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId, bindingId: input.binding.id });
}

export function addHmiEventCommand(
  project: PlcProject,
  input: AddHmiEventCommandInput,
): ProjectActionResult<{ elementId: string; commandId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      const existing = element.events.find((event) => event.eventType === input.eventType);
      if (!existing) {
        return {
          ...element,
          events: [...element.events, { id: `event_${input.eventType}`, eventType: input.eventType, commands: [input.command] }],
        };
      }
      return {
        ...element,
        events: element.events.map((event) =>
          event.id === existing.id ? { ...event, commands: [...event.commands, input.command] } : event,
        ),
      };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId, commandId: input.command.id });
}

export interface UpdateHmiElementInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  /** New element name (trimmed; must be non-empty when provided). */
  name?: string;
  /** Properties merged shallowly over the element's current properties. */
  properties?: Record<string, unknown>;
  /** Style merged shallowly over the element's current style. */
  style?: HmiStyle;
  visible?: boolean;
  locked?: boolean;
  zIndex?: number;
}

/** Update a registered element's name, properties, style, visibility, lock, or z-order. */
export function updateHmiElement(
  project: PlcProject,
  input: UpdateHmiElementInput,
): ProjectActionResult<{ elementId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (input.name !== undefined && !input.name.trim()) {
    return fail(project, "HMI element name cannot be blank.");
  }
  if (input.zIndex !== undefined && (!Number.isFinite(input.zIndex) || input.zIndex < 0)) {
    return fail(project, "HMI element z-order must be a non-negative number.");
  }

  let updated = false;
  let readOnly = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) {
        readOnly = true;
        return element;
      }
      updated = true;
      return {
        ...element,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.properties ? { properties: { ...element.properties, ...input.properties } } : {}),
        ...(input.style ? { style: { ...element.style, ...input.style } } : {}),
        ...(input.visible !== undefined ? { visible: input.visible } : {}),
        ...(input.locked !== undefined ? { locked: input.locked } : {}),
        ...(input.zIndex !== undefined ? { zIndex: input.zIndex } : {}),
      };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (readOnly) return fail(project, "Read-only unsupported HMI element cannot be edited.");
  if (!updated) return fail(project, "HMI element was not found.");
  return commitHmi(project, next, { elementId: input.elementId });
}

export interface UpdateHmiAddOnGraphicInput {
  addOnGraphicId: string;
  name?: string;
  width?: number;
  height?: number;
  vendor?: string | null;
  revision?: string | null;
  properties?: HmiAddOnGraphicDefinition["properties"];
}

export function updateHmiAddOnGraphic(
  project: PlcProject,
  input: UpdateHmiAddOnGraphicInput,
): ProjectActionResult<{ addOnGraphicId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.addOnGraphics.find((graphic) => graphic.id === input.addOnGraphicId);
  if (!target) return fail(project, "HMI Add-On Graphic was not found.");
  if (target.unsupported) return fail(project, "Read-only unsupported HMI Add-On Graphic cannot be edited.");

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) return fail(project, "HMI Add-On Graphic name is required.");
  if (hmi.addOnGraphics.some((graphic) => graphic.id !== input.addOnGraphicId && graphic.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI Add-On Graphic "${name}" already exists.`);
  }

  const width = input.width ?? target.width;
  const height = input.height ?? target.height;
  if (!validSize(width, height)) {
    return fail(project, "HMI Add-On Graphic width and height must be greater than zero.");
  }

  const nextGraphic: HmiAddOnGraphicDefinition = {
    ...target,
    name,
    width,
    height,
    ...(input.vendor !== undefined ? { vendor: optionalText(input.vendor) } : {}),
    ...(input.revision !== undefined ? { revision: optionalText(input.revision) } : {}),
    ...(input.properties !== undefined ? { properties: copyAddOnGraphicProperties(input.properties) } : {}),
  };
  const next = {
    ...hmi,
    addOnGraphics: hmi.addOnGraphics.map((graphic) =>
      graphic.id === input.addOnGraphicId ? nextGraphic : graphic,
    ),
  };
  return commitHmi(project, next, { addOnGraphicId: input.addOnGraphicId });
}

export interface DeleteHmiAddOnGraphicInput {
  addOnGraphicId: string;
}

export function deleteHmiAddOnGraphic(
  project: PlcProject,
  input: DeleteHmiAddOnGraphicInput,
): ProjectActionResult<{ addOnGraphicId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.addOnGraphics.some((graphic) => graphic.id === input.addOnGraphicId)) {
    return fail(project, "HMI Add-On Graphic was not found.");
  }

  const next = {
    ...hmi,
    addOnGraphics: hmi.addOnGraphics.filter((graphic) => graphic.id !== input.addOnGraphicId),
  };
  return commitHmi(project, next, { addOnGraphicId: input.addOnGraphicId });
}

export interface DeleteHmiElementInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
}

/** Remove an element (supported or unsupported) from a surface. */
export function deleteHmiElement(
  project: PlcProject,
  input: DeleteHmiElementInput,
): ProjectActionResult<{ elementId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let removed = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) => {
    const kept = elements.filter((element) => {
      if (element.id === input.elementId) {
        removed = true;
        return false;
      }
      return true;
    });
    return kept;
  });
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!removed) return fail(project, "HMI element was not found.");
  return commitHmi(project, next, { elementId: input.elementId });
}

export interface RemoveHmiElementBindingInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  bindingId: string;
}

/** Remove one property binding from an element. */
export function removeHmiElementBinding(
  project: PlcProject,
  input: RemoveHmiElementBindingInput,
): ProjectActionResult<{ elementId: string; bindingId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let removed = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      const bindings = element.bindings.filter((binding) => {
        if (binding.id === input.bindingId) {
          removed = true;
          return false;
        }
        return true;
      });
      return { ...element, bindings };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!removed) return fail(project, "HMI binding was not found.");
  return commitHmi(project, next, { elementId: input.elementId, bindingId: input.bindingId });
}

export interface RemoveHmiEventCommandInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  eventId: string;
  commandId: string;
}

/** Remove one command from an event handler; drops the handler if it becomes empty. */
export function removeHmiEventCommand(
  project: PlcProject,
  input: RemoveHmiEventCommandInput,
): ProjectActionResult<{ elementId: string; commandId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let removed = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      const events = element.events
        .map((event) => {
          if (event.id !== input.eventId) return event;
          const commands = event.commands.filter((command) => {
            if (command.id === input.commandId) {
              removed = true;
              return false;
            }
            return true;
          });
          return { ...event, commands };
        })
        .filter((event) => event.commands.length > 0);
      return { ...element, events };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!removed) return fail(project, "HMI event command was not found.");
  return commitHmi(project, next, { elementId: input.elementId, commandId: input.commandId });
}

export interface SetHmiHomeScreenInput {
  /** Screen id to mark as home, or null/blank to clear the home screen. */
  screenId: string | null;
}

/** Set (or clear) the project's home screen. */
export function setHmiHomeScreen(
  project: PlcProject,
  input: SetHmiHomeScreenInput,
): ProjectActionResult<{ homeScreenId?: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const screenId = input.screenId?.trim() || undefined;
  if (screenId && !hmi.screens.some((screen) => screen.id === screenId)) {
    return fail(project, `HMI screen "${screenId}" was not found.`);
  }
  const next: HmiProject = { ...hmi, homeScreenId: screenId };
  return commitHmi(project, next, { homeScreenId: screenId });
}

export interface RenameHmiSurfaceInput {
  surfaceKind: "screen" | "popup";
  surfaceId: string;
  name: string;
}

/** Rename a screen or popup (rejects duplicate names within that surface kind). */
export function renameHmiSurface(
  project: PlcProject,
  input: RenameHmiSurfaceInput,
): ProjectActionResult<{ surfaceId: string; name: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI surface name is required.");

  if (input.surfaceKind === "screen") {
    const target = hmi.screens.find((screen) => screen.id === input.surfaceId);
    if (!target) return fail(project, "HMI screen was not found.");
    if (hmi.screens.some((screen) => screen.id !== input.surfaceId && screen.name.toLowerCase() === name.toLowerCase())) {
      return fail(project, `HMI screen "${name}" already exists.`);
    }
    const next: HmiProject = {
      ...hmi,
      screens: hmi.screens.map((screen) =>
        screen.id === input.surfaceId ? { ...screen, name } : screen,
      ),
    };
    return commitHmi(project, next, { surfaceId: input.surfaceId, name });
  }

  const target = hmi.popups.find((popup) => popup.id === input.surfaceId);
  if (!target) return fail(project, "HMI popup was not found.");
  if (hmi.popups.some((popup) => popup.id !== input.surfaceId && popup.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI popup "${name}" already exists.`);
  }
  const next: HmiProject = {
    ...hmi,
    popups: hmi.popups.map((popup) =>
      popup.id === input.surfaceId ? { ...popup, name, caption: popup.caption === target.name ? name : popup.caption } : popup,
    ),
  };
  return commitHmi(project, next, { surfaceId: input.surfaceId, name });
}

export interface SetHmiSurfaceSecurityRolesInput {
  surfaceKind: "screen" | "popup" | "system-banner";
  surfaceId: string;
  roleIds: string[];
}

/** Assign security roles to a screen, popup, or system banner for offline HMI runtime preview. */
export function setHmiSurfaceSecurityRoles(
  project: PlcProject,
  input: SetHmiSurfaceSecurityRolesInput,
): ProjectActionResult<{ surfaceId: string; roleIds: string[] }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const roleIds = normalizedSurfaceSecurityRoleIds(hmi, input.roleIds ?? []);
  if (!roleIds) return fail(project, "One or more HMI security roles were not found.");

  if (input.surfaceKind === "screen") {
    let found = false;
    const screens = hmi.screens.map((screen) => {
      if (screen.id !== input.surfaceId) return screen;
      found = true;
      return { ...screen, securityRoleIds: roleIds };
    });
    if (!found) return fail(project, "HMI screen was not found.");
    return commitHmi(project, { ...hmi, screens }, { surfaceId: input.surfaceId, roleIds });
  }

  if (input.surfaceKind === "popup") {
    let found = false;
    const popups = hmi.popups.map((popup) => {
      if (popup.id !== input.surfaceId) return popup;
      found = true;
      return { ...popup, securityRoleIds: roleIds };
    });
    if (!found) return fail(project, "HMI popup was not found.");
    return commitHmi(project, { ...hmi, popups }, { surfaceId: input.surfaceId, roleIds });
  }

  if (hmi.systemBanner.id !== input.surfaceId) return fail(project, "HMI system banner was not found.");
  return commitHmi(
    project,
    { ...hmi, systemBanner: { ...hmi.systemBanner, securityRoleIds: roleIds } },
    { surfaceId: input.surfaceId, roleIds },
  );
}

export interface DeleteHmiScreenInput {
  screenId: string;
}

/**
 * Delete a screen. Reassigns the home screen to the first remaining screen (or
 * clears it) and drops shortcuts that targeted the deleted screen. Navigation
 * commands pointing at it are left intact so HMI validation honestly flags them.
 */
export function deleteHmiScreen(
  project: PlcProject,
  input: DeleteHmiScreenInput,
): ProjectActionResult<{ screenId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.screens.some((screen) => screen.id === input.screenId)) {
    return fail(project, "HMI screen was not found.");
  }

  const screens = hmi.screens.filter((screen) => screen.id !== input.screenId);
  const homeScreenId =
    hmi.homeScreenId === input.screenId ? screens[0]?.id : hmi.homeScreenId;
  const shortcuts = hmi.shortcuts.filter(
    (shortcut) => !(shortcut.targetKind === "screen" && shortcut.targetId === input.screenId),
  );
  const next: HmiProject = { ...hmi, screens, homeScreenId, shortcuts };
  return commitHmi(project, next, { screenId: input.screenId });
}

export interface DeleteHmiPopupInput {
  popupId: string;
}

/** Delete a popup and drop shortcuts that targeted it. */
export function deleteHmiPopup(
  project: PlcProject,
  input: DeleteHmiPopupInput,
): ProjectActionResult<{ popupId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.popups.some((popup) => popup.id === input.popupId)) {
    return fail(project, "HMI popup was not found.");
  }

  const popups = hmi.popups.filter((popup) => popup.id !== input.popupId);
  const shortcuts = hmi.shortcuts.filter(
    (shortcut) => !(shortcut.targetKind === "popup" && shortcut.targetId === input.popupId),
  );
  const next: HmiProject = { ...hmi, popups, shortcuts };
  return commitHmi(project, next, { popupId: input.popupId });
}

// ===========================================================================
// HMI alarm definitions
// ===========================================================================

const ALARM_SEVERITIES: HmiAlarmSeverity[] = ["info", "warning", "minor", "major", "critical"];
const ALARM_TRIGGER_KINDS: HmiAlarmTriggerKind[] = ["digital", "analog-high", "analog-low"];

export interface CreateHmiAlarmInput {
  name: string;
  tagPath: string;
  alarmId?: string;
  severity?: HmiAlarmSeverity;
  triggerKind?: HmiAlarmTriggerKind;
  threshold?: number;
  deadband?: number;
  activeValue?: boolean;
  message?: string;
  area?: string;
  allowAcknowledge?: boolean;
  enabled?: boolean;
}

function buildAlarmTrigger(
  kind: HmiAlarmTriggerKind,
  input: { threshold?: number; deadband?: number; activeValue?: boolean },
): { ok: true; trigger: HmiAlarmDefinition["trigger"] } | { ok: false; error: string } {
  if (input.deadband !== undefined && (!Number.isFinite(input.deadband) || input.deadband < 0)) {
    return { ok: false, error: "Alarm deadband must be zero or greater." };
  }
  if (kind === "digital") {
    return { ok: true, trigger: { kind, activeValue: input.activeValue ?? true } };
  }
  if (!Number.isFinite(input.threshold)) {
    return { ok: false, error: "Analog alarm triggers require a finite threshold." };
  }
  return {
    ok: true,
    trigger: {
      kind,
      threshold: input.threshold,
      ...(input.deadband !== undefined ? { deadband: input.deadband } : {}),
    },
  };
}

/** Create an HMI alarm definition (digital or analog trigger). */
export function createHmiAlarmDefinition(
  project: PlcProject,
  input: CreateHmiAlarmInput,
): ProjectActionResult<{ alarmId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI alarm name is required.");
  const tagPath = input.tagPath?.trim();
  if (!tagPath) return fail(project, "HMI alarm requires a tag path.");
  const requestedId = optionalId(input.alarmId, "HMI alarm");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const severity = input.severity ?? "warning";
  if (!ALARM_SEVERITIES.includes(severity)) return fail(project, `Invalid alarm severity "${severity}".`);
  const triggerKind = input.triggerKind ?? "digital";
  if (!ALARM_TRIGGER_KINDS.includes(triggerKind)) return fail(project, `Invalid alarm trigger kind "${triggerKind}".`);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.alarms.some((alarm) => alarm.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI alarm "${name}" already exists.`);
  }
  if (requestedId.id && hmi.alarms.some((alarm) => alarm.id === requestedId.id)) {
    return fail(project, `HMI alarm id "${requestedId.id}" already exists.`);
  }

  const trigger = buildAlarmTrigger(triggerKind, input);
  if (!trigger.ok) return fail(project, trigger.error);

  const alarm: HmiAlarmDefinition = {
    id: requestedId.id ?? createId("hmialarm"),
    name,
    tagPath,
    severity,
    trigger: trigger.trigger,
    message: optionalText(input.message),
    area: optionalText(input.area),
    allowAcknowledge: input.allowAcknowledge ?? true,
    enabled: input.enabled ?? true,
  };
  const next: HmiProject = { ...hmi, alarms: [...hmi.alarms, alarm] };
  return commitHmi(project, next, { alarmId: alarm.id });
}

export interface UpdateHmiAlarmInput {
  alarmId: string;
  name?: string;
  tagPath?: string;
  severity?: HmiAlarmSeverity;
  triggerKind?: HmiAlarmTriggerKind;
  threshold?: number;
  deadband?: number | null;
  activeValue?: boolean;
  message?: string | null;
  area?: string | null;
  allowAcknowledge?: boolean;
  enabled?: boolean;
}

/** Update fields of an existing HMI alarm definition. */
export function updateHmiAlarmDefinition(
  project: PlcProject,
  input: UpdateHmiAlarmInput,
): ProjectActionResult<{ alarmId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.alarms.find((alarm) => alarm.id === input.alarmId);
  if (!target) return fail(project, "HMI alarm was not found.");

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) return fail(project, "HMI alarm name is required.");
  if (hmi.alarms.some((alarm) => alarm.id !== input.alarmId && alarm.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI alarm "${name}" already exists.`);
  }
  if (input.severity !== undefined && !ALARM_SEVERITIES.includes(input.severity)) {
    return fail(project, `Invalid alarm severity "${input.severity}".`);
  }

  const triggerKind = input.triggerKind ?? target.trigger.kind;
  if (!ALARM_TRIGGER_KINDS.includes(triggerKind)) return fail(project, `Invalid alarm trigger kind "${triggerKind}".`);
  const deadband =
    input.deadband === null ? undefined : input.deadband ?? target.trigger.deadband;
  const trigger = buildAlarmTrigger(triggerKind, {
    threshold: input.threshold ?? target.trigger.threshold,
    deadband,
    activeValue: input.activeValue ?? (typeof target.trigger.activeValue === "boolean" ? target.trigger.activeValue : true),
  });
  if (!trigger.ok) return fail(project, trigger.error);

  const nextAlarm: HmiAlarmDefinition = {
    ...target,
    name,
    ...(input.tagPath !== undefined ? { tagPath: input.tagPath.trim() } : {}),
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    trigger: trigger.trigger,
    ...(input.message !== undefined ? { message: optionalText(input.message) } : {}),
    ...(input.area !== undefined ? { area: optionalText(input.area) } : {}),
    ...(input.allowAcknowledge !== undefined ? { allowAcknowledge: input.allowAcknowledge } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  };
  if (!nextAlarm.tagPath.trim()) return fail(project, "HMI alarm requires a tag path.");

  const next: HmiProject = {
    ...hmi,
    alarms: hmi.alarms.map((alarm) => (alarm.id === input.alarmId ? nextAlarm : alarm)),
  };
  return commitHmi(project, next, { alarmId: input.alarmId });
}

export interface DeleteHmiAlarmInput {
  alarmId: string;
}

export function deleteHmiAlarmDefinition(
  project: PlcProject,
  input: DeleteHmiAlarmInput,
): ProjectActionResult<{ alarmId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.alarms.some((alarm) => alarm.id === input.alarmId)) {
    return fail(project, "HMI alarm was not found.");
  }
  const next: HmiProject = { ...hmi, alarms: hmi.alarms.filter((alarm) => alarm.id !== input.alarmId) };
  return commitHmi(project, next, { alarmId: input.alarmId });
}

// ===========================================================================
// HMI trend definitions + pens
// ===========================================================================

export interface CreateHmiTrendInput {
  name: string;
  trendId?: string;
  sampleRateMs?: number;
  timeRangeSeconds?: number;
}

/** Create an HMI trend definition (with no pens yet). */
export function createHmiTrendDefinition(
  project: PlcProject,
  input: CreateHmiTrendInput,
): ProjectActionResult<{ trendId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI trend name is required.");
  const requestedId = optionalId(input.trendId, "HMI trend");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const sampleRateMs = input.sampleRateMs ?? 1000;
  const timeRangeSeconds = input.timeRangeSeconds ?? 300;
  if (!Number.isFinite(sampleRateMs) || sampleRateMs <= 0) {
    return fail(project, "HMI trend sample rate must be greater than zero.");
  }
  if (!Number.isFinite(timeRangeSeconds) || timeRangeSeconds <= 0) {
    return fail(project, "HMI trend time range must be greater than zero.");
  }

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.trends.some((trend) => trend.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI trend "${name}" already exists.`);
  }
  if (requestedId.id && hmi.trends.some((trend) => trend.id === requestedId.id)) {
    return fail(project, `HMI trend id "${requestedId.id}" already exists.`);
  }

  const trend: HmiTrend = {
    id: requestedId.id ?? createId("hmitrend"),
    name,
    sampleRateMs,
    timeRangeSeconds,
    traces: [],
  };
  const next: HmiProject = { ...hmi, trends: [...hmi.trends, trend] };
  return commitHmi(project, next, { trendId: trend.id });
}

export interface UpdateHmiTrendInput {
  trendId: string;
  name?: string;
  sampleRateMs?: number;
  timeRangeSeconds?: number;
}

export function updateHmiTrendDefinition(
  project: PlcProject,
  input: UpdateHmiTrendInput,
): ProjectActionResult<{ trendId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.trends.find((trend) => trend.id === input.trendId);
  if (!target) return fail(project, "HMI trend was not found.");

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) return fail(project, "HMI trend name is required.");
  if (hmi.trends.some((trend) => trend.id !== input.trendId && trend.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI trend "${name}" already exists.`);
  }
  const sampleRateMs = input.sampleRateMs ?? target.sampleRateMs;
  const timeRangeSeconds = input.timeRangeSeconds ?? target.timeRangeSeconds;
  if (!Number.isFinite(sampleRateMs) || sampleRateMs <= 0) {
    return fail(project, "HMI trend sample rate must be greater than zero.");
  }
  if (!Number.isFinite(timeRangeSeconds) || timeRangeSeconds <= 0) {
    return fail(project, "HMI trend time range must be greater than zero.");
  }

  const nextTrend: HmiTrend = { ...target, name, sampleRateMs, timeRangeSeconds };
  const next: HmiProject = {
    ...hmi,
    trends: hmi.trends.map((trend) => (trend.id === input.trendId ? nextTrend : trend)),
  };
  return commitHmi(project, next, { trendId: input.trendId });
}

export interface DeleteHmiTrendInput {
  trendId: string;
}

export function deleteHmiTrendDefinition(
  project: PlcProject,
  input: DeleteHmiTrendInput,
): ProjectActionResult<{ trendId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.trends.some((trend) => trend.id === input.trendId)) {
    return fail(project, "HMI trend was not found.");
  }
  const next: HmiProject = { ...hmi, trends: hmi.trends.filter((trend) => trend.id !== input.trendId) };
  return commitHmi(project, next, { trendId: input.trendId });
}

export interface AddHmiTrendPenInput {
  trendId: string;
  label: string;
  tagPath: string;
  color?: string;
  sourceKind?: Extract<HmiBindingSourceKind, "tag" | "expression" | "system-tag">;
  traceId?: string;
}

const TREND_PEN_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

/** Add a pen (trace) to an HMI trend, bound to a tag path or expression. */
export function addHmiTrendPen(
  project: PlcProject,
  input: AddHmiTrendPenInput,
): ProjectActionResult<{ trendId: string; traceId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.trends.find((trend) => trend.id === input.trendId);
  if (!target) return fail(project, "HMI trend was not found.");

  const label = input.label?.trim();
  if (!label) return fail(project, "HMI trend pen label is required.");
  const path = input.tagPath?.trim();
  if (!path) return fail(project, "HMI trend pen requires a tag path or expression.");
  const requestedId = optionalId(input.traceId, "HMI trend pen");
  if (!requestedId.ok) return fail(project, requestedId.error);
  if (requestedId.id && target.traces.some((trace) => trace.id === requestedId.id)) {
    return fail(project, `HMI trend pen id "${requestedId.id}" already exists.`);
  }

  const traceId = requestedId.id ?? createId("hmipen");
  const color = optionalText(input.color) ?? TREND_PEN_COLORS[target.traces.length % TREND_PEN_COLORS.length]!;
  const sourceKind = input.sourceKind ?? "tag";
  const nextTrend: HmiTrend = {
    ...target,
    traces: [...target.traces, { id: traceId, label, source: { kind: sourceKind, path }, color }],
  };
  const next: HmiProject = {
    ...hmi,
    trends: hmi.trends.map((trend) => (trend.id === input.trendId ? nextTrend : trend)),
  };
  return commitHmi(project, next, { trendId: input.trendId, traceId });
}

export interface RemoveHmiTrendPenInput {
  trendId: string;
  traceId: string;
}

export function removeHmiTrendPen(
  project: PlcProject,
  input: RemoveHmiTrendPenInput,
): ProjectActionResult<{ trendId: string; traceId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.trends.find((trend) => trend.id === input.trendId);
  if (!target) return fail(project, "HMI trend was not found.");
  if (!target.traces.some((trace) => trace.id === input.traceId)) {
    return fail(project, "HMI trend pen was not found.");
  }
  const nextTrend: HmiTrend = { ...target, traces: target.traces.filter((trace) => trace.id !== input.traceId) };
  const next: HmiProject = {
    ...hmi,
    trends: hmi.trends.map((trend) => (trend.id === input.trendId ? nextTrend : trend)),
  };
  return commitHmi(project, next, { trendId: input.trendId, traceId: input.traceId });
}

// ===========================================================================
// HMI data-log definitions
// ===========================================================================

export interface CreateHmiDataLogInput {
  name: string;
  dataLogId?: string;
  sampleRateMs?: number;
  retentionHours?: number;
  tagPaths?: string[];
  statusTagPath?: string;
}

export interface UpdateHmiDataLogInput {
  dataLogId: string;
  name?: string;
  sampleRateMs?: number;
  retentionHours?: number;
  tagPaths?: string[];
  statusTagPath?: string | null;
}

export interface DeleteHmiDataLogInput {
  dataLogId: string;
}

function normalizedDataLogTagPaths(tagPaths: string[] | undefined): string[] {
  return [...new Set((tagPaths ?? []).map((tagPath) => tagPath.trim()).filter(Boolean))];
}

function validDataLogTiming(sampleRateMs: number, retentionHours: number): string | undefined {
  if (!Number.isFinite(sampleRateMs) || sampleRateMs <= 0) {
    return "HMI data-log sample rate must be greater than zero.";
  }
  if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
    return "HMI data-log retention must be greater than zero.";
  }
  return undefined;
}

export function createHmiDataLogDefinition(
  project: PlcProject,
  input: CreateHmiDataLogInput,
): ProjectActionResult<{ dataLogId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI data-log name is required.");
  const requestedId = optionalId(input.dataLogId, "HMI data log");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const sampleRateMs = input.sampleRateMs ?? 1000;
  const retentionHours = input.retentionHours ?? 24;
  const timingError = validDataLogTiming(sampleRateMs, retentionHours);
  if (timingError) return fail(project, timingError);
  const tagPaths = normalizedDataLogTagPaths(input.tagPaths);
  if (tagPaths.length === 0) return fail(project, "HMI data log requires at least one tag path.");

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.dataLogs.some((log) => log.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI data log "${name}" already exists.`);
  }
  if (requestedId.id && hmi.dataLogs.some((log) => log.id === requestedId.id)) {
    return fail(project, `HMI data log id "${requestedId.id}" already exists.`);
  }

  const log: HmiDataLog = {
    id: requestedId.id ?? createId("hmidatalog"),
    name,
    sampleRateMs,
    retentionHours,
    tagPaths,
    statusTagPath: optionalText(input.statusTagPath),
  };
  const next: HmiProject = { ...hmi, dataLogs: [...hmi.dataLogs, log] };
  return commitHmi(project, next, { dataLogId: log.id });
}

export function updateHmiDataLogDefinition(
  project: PlcProject,
  input: UpdateHmiDataLogInput,
): ProjectActionResult<{ dataLogId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.dataLogs.find((log) => log.id === input.dataLogId);
  if (!target) return fail(project, "HMI data log was not found.");

  const name = input.name !== undefined ? input.name.trim() : target.name;
  if (!name) return fail(project, "HMI data-log name is required.");
  if (hmi.dataLogs.some((log) => log.id !== input.dataLogId && log.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI data log "${name}" already exists.`);
  }
  const sampleRateMs = input.sampleRateMs ?? target.sampleRateMs;
  const retentionHours = input.retentionHours ?? target.retentionHours;
  const timingError = validDataLogTiming(sampleRateMs, retentionHours);
  if (timingError) return fail(project, timingError);
  const tagPaths = input.tagPaths !== undefined ? normalizedDataLogTagPaths(input.tagPaths) : target.tagPaths;
  if (tagPaths.length === 0) return fail(project, "HMI data log requires at least one tag path.");

  const nextLog: HmiDataLog = {
    ...target,
    name,
    sampleRateMs,
    retentionHours,
    tagPaths,
    ...(input.statusTagPath !== undefined ? { statusTagPath: optionalText(input.statusTagPath) } : {}),
  };
  const next: HmiProject = {
    ...hmi,
    dataLogs: hmi.dataLogs.map((log) => (log.id === input.dataLogId ? nextLog : log)),
  };
  return commitHmi(project, next, { dataLogId: input.dataLogId });
}

export function deleteHmiDataLogDefinition(
  project: PlcProject,
  input: DeleteHmiDataLogInput,
): ProjectActionResult<{ dataLogId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.dataLogs.some((log) => log.id === input.dataLogId)) {
    return fail(project, "HMI data log was not found.");
  }
  const next: HmiProject = { ...hmi, dataLogs: hmi.dataLogs.filter((log) => log.id !== input.dataLogId) };
  return commitHmi(project, next, { dataLogId: input.dataLogId });
}

// ===========================================================================
// HMI recipes
// ===========================================================================

export interface HmiRecipeItemDraft {
  itemId?: string;
  tagPath: string;
  value: HmiRecipeValue;
  dataType?: string;
  description?: string;
}

export interface CreateHmiRecipeInput {
  name: string;
  recipeId?: string;
  description?: string;
  items?: HmiRecipeItemDraft[];
  securityRoleIds?: string[];
}

export interface AddHmiRecipeItemInput extends HmiRecipeItemDraft {
  recipeId: string;
}

export interface RemoveHmiRecipeItemInput {
  recipeId: string;
  itemId: string;
}

export interface DeleteHmiRecipeInput {
  recipeId: string;
}

function recipeValueOk(value: HmiRecipeValue): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function recipeItemFromDraft(
  draft: HmiRecipeItemDraft,
  usedIds: Set<string>,
  usedTags: Set<string>,
): { ok: true; item: HmiRecipeItem } | { ok: false; error: string } {
  const tagPath = draft.tagPath?.trim();
  if (!tagPath) return { ok: false, error: "HMI recipe item requires a tag path." };
  if (usedTags.has(tagPath)) return { ok: false, error: `Recipe already writes tag "${tagPath}".` };
  if (!recipeValueOk(draft.value)) return { ok: false, error: `Recipe value for "${tagPath}" must be text, number, boolean, or null.` };
  const requestedId = optionalId(draft.itemId, "HMI recipe item");
  if (!requestedId.ok) return { ok: false, error: requestedId.error };
  const id = requestedId.id ?? createId("hmirecipeitem");
  if (usedIds.has(id)) return { ok: false, error: `HMI recipe item id "${id}" already exists.` };
  return {
    ok: true,
    item: {
      id,
      tagPath,
      value: draft.value,
      dataType: optionalText(draft.dataType),
      description: optionalText(draft.description),
    },
  };
}

function normalizeRecipeItems(
  drafts: readonly HmiRecipeItemDraft[] | undefined,
): { ok: true; items: HmiRecipeItem[] } | { ok: false; error: string } {
  const usedIds = new Set<string>();
  const usedTags = new Set<string>();
  const items: HmiRecipeItem[] = [];
  for (const draft of drafts ?? []) {
    const built = recipeItemFromDraft(draft, usedIds, usedTags);
    if (!built.ok) return built;
    usedIds.add(built.item.id);
    usedTags.add(built.item.tagPath);
    items.push(built.item);
  }
  return { ok: true, items };
}

function normalizeRecipeRoleIds(hmi: HmiProject, roleIds: readonly string[] | undefined): string[] | undefined {
  if (!roleIds) return [];
  const known = new Set(hmi.security.roles.map((role) => role.id));
  const normalized: string[] = [];
  for (const raw of roleIds) {
    const roleId = raw.trim();
    if (!roleId || normalized.includes(roleId)) continue;
    if (!known.has(roleId)) return undefined;
    normalized.push(roleId);
  }
  return normalized;
}

export function createHmiRecipe(
  project: PlcProject,
  input: CreateHmiRecipeInput,
): ProjectActionResult<{ recipeId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "HMI recipe name is required.");
  const requestedId = optionalId(input.recipeId, "HMI recipe");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  const recipes = hmi.recipes ?? [];
  if (recipes.some((recipe) => recipe.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI recipe "${name}" already exists.`);
  }
  if (requestedId.id && recipes.some((recipe) => recipe.id === requestedId.id)) {
    return fail(project, `HMI recipe id "${requestedId.id}" already exists.`);
  }
  const items = normalizeRecipeItems(input.items);
  if (!items.ok) return fail(project, items.error);
  const securityRoleIds = normalizeRecipeRoleIds(hmi, input.securityRoleIds);
  if (!securityRoleIds) return fail(project, "One or more HMI recipe security roles were not found.");

  const recipe: HmiRecipe = {
    id: requestedId.id ?? createId("hmirecipe"),
    name,
    description: optionalText(input.description),
    items: items.items,
    securityRoleIds,
  };
  const next: HmiProject = { ...hmi, recipes: [...recipes, recipe] };
  return commitHmi(project, next, { recipeId: recipe.id });
}

export function addHmiRecipeItem(
  project: PlcProject,
  input: AddHmiRecipeItemInput,
): ProjectActionResult<{ recipeId: string; itemId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const recipes = hmi.recipes ?? [];
  const target = recipes.find((recipe) => recipe.id === input.recipeId);
  if (!target) return fail(project, "HMI recipe was not found.");

  const usedIds = new Set(target.items.map((item) => item.id));
  const usedTags = new Set(target.items.map((item) => item.tagPath));
  const built = recipeItemFromDraft(input, usedIds, usedTags);
  if (!built.ok) return fail(project, built.error);

  const nextRecipe: HmiRecipe = { ...target, items: [...target.items, built.item] };
  const next: HmiProject = {
    ...hmi,
    recipes: recipes.map((recipe) => (recipe.id === input.recipeId ? nextRecipe : recipe)),
  };
  return commitHmi(project, next, { recipeId: input.recipeId, itemId: built.item.id });
}

export function removeHmiRecipeItem(
  project: PlcProject,
  input: RemoveHmiRecipeItemInput,
): ProjectActionResult<{ recipeId: string; itemId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const recipes = hmi.recipes ?? [];
  const target = recipes.find((recipe) => recipe.id === input.recipeId);
  if (!target) return fail(project, "HMI recipe was not found.");
  if (!target.items.some((item) => item.id === input.itemId)) return fail(project, "HMI recipe item was not found.");

  const nextRecipe: HmiRecipe = { ...target, items: target.items.filter((item) => item.id !== input.itemId) };
  const next: HmiProject = {
    ...hmi,
    recipes: recipes.map((recipe) => (recipe.id === input.recipeId ? nextRecipe : recipe)),
  };
  return commitHmi(project, next, { recipeId: input.recipeId, itemId: input.itemId });
}

export function deleteHmiRecipe(
  project: PlcProject,
  input: DeleteHmiRecipeInput,
): ProjectActionResult<{ recipeId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const recipes = hmi.recipes ?? [];
  if (!recipes.some((recipe) => recipe.id === input.recipeId)) return fail(project, "HMI recipe was not found.");
  const next: HmiProject = { ...hmi, recipes: recipes.filter((recipe) => recipe.id !== input.recipeId) };
  return commitHmi(project, next, { recipeId: input.recipeId });
}

// ===========================================================================
// HMI language packs + localized strings
// ===========================================================================

const LANGUAGE_ID_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export interface CreateHmiLanguagePackInput {
  languageId: string;
  displayName?: string;
  languagePackId?: string;
}

/** Create a new HMI language pack (BCP-47-ish id, e.g. "de-DE"). */
export function createHmiLanguagePack(
  project: PlcProject,
  input: CreateHmiLanguagePackInput,
): ProjectActionResult<{ languageId: string }> {
  const languageId = input.languageId?.trim();
  if (!languageId) return fail(project, "Language id is required.");
  if (!LANGUAGE_ID_PATTERN.test(languageId)) {
    return fail(project, `Language id "${languageId}" is not a valid language tag (e.g. "en-US").`);
  }

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.languagePacks.some((pack) => pack.languageId.toLowerCase() === languageId.toLowerCase())) {
    return fail(project, `Language pack "${languageId}" already exists.`);
  }
  const displayName = optionalText(input.displayName) ?? languageId;
  const pack: HmiLanguagePack = {
    id: optionalText(input.languagePackId) ?? createId("hmilang"),
    languageId,
    displayName,
    strings: {},
    missingStringIds: [],
  };
  const next: HmiProject = { ...hmi, languagePacks: [...hmi.languagePacks, pack] };
  return commitHmi(project, next, { languageId });
}

export interface DeleteHmiLanguagePackInput {
  languageId: string;
}

/** Delete a language pack. Reassigns the default language when needed; the last pack cannot be removed. */
export function deleteHmiLanguagePack(
  project: PlcProject,
  input: DeleteHmiLanguagePackInput,
): ProjectActionResult<{ languageId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.languagePacks.find((pack) => pack.languageId === input.languageId);
  if (!target) return fail(project, "Language pack was not found.");
  if (hmi.languagePacks.length <= 1) {
    return fail(project, "At least one HMI language pack is required.");
  }

  const languagePacks = hmi.languagePacks.filter((pack) => pack.languageId !== input.languageId);
  const defaultLanguage =
    hmi.defaultLanguage === input.languageId ? languagePacks[0]!.languageId : hmi.defaultLanguage;
  const next: HmiProject = { ...hmi, languagePacks, defaultLanguage };
  return commitHmi(project, next, { languageId: input.languageId });
}

export interface SetHmiLanguageStringInput {
  languageId: string;
  key: string;
  value: string;
}

/** Create or update a localized string in a language pack. */
export function setHmiLanguageString(
  project: PlcProject,
  input: SetHmiLanguageStringInput,
): ProjectActionResult<{ languageId: string; key: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.languagePacks.find((pack) => pack.languageId === input.languageId);
  if (!target) return fail(project, "Language pack was not found.");
  const key = input.key?.trim();
  if (!key) return fail(project, "Localized string key is required.");
  if (typeof input.value !== "string") return fail(project, "Localized string value must be text.");

  const nextPack: HmiLanguagePack = {
    ...target,
    strings: { ...target.strings, [key]: input.value },
    missingStringIds: target.missingStringIds.filter((id) => id !== key),
  };
  const next: HmiProject = {
    ...hmi,
    languagePacks: hmi.languagePacks.map((pack) => (pack.languageId === input.languageId ? nextPack : pack)),
  };
  return commitHmi(project, next, { languageId: input.languageId, key });
}

export interface RemoveHmiLanguageStringInput {
  languageId: string;
  key: string;
}

export function removeHmiLanguageString(
  project: PlcProject,
  input: RemoveHmiLanguageStringInput,
): ProjectActionResult<{ languageId: string; key: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  const target = hmi.languagePacks.find((pack) => pack.languageId === input.languageId);
  if (!target) return fail(project, "Language pack was not found.");
  const key = input.key?.trim();
  if (!key || !(key in target.strings)) return fail(project, "Localized string was not found.");

  const nextStrings = { ...target.strings };
  delete nextStrings[key];
  const nextPack: HmiLanguagePack = { ...target, strings: nextStrings };
  const next: HmiProject = {
    ...hmi,
    languagePacks: hmi.languagePacks.map((pack) => (pack.languageId === input.languageId ? nextPack : pack)),
  };
  return commitHmi(project, next, { languageId: input.languageId, key });
}

export interface ImportHmiLanguagePackInput {
  text: string;
  sourceFileName?: string;
}

/**
 * Import a language pack from ESCO language CSV text, adding it or replacing an
 * existing pack with the same language id. Returns the imported language id.
 */
export function importHmiLanguagePack(
  project: PlcProject,
  input: ImportHmiLanguagePackInput,
): ProjectActionResult<{ languageId: string }> {
  if (typeof input.text !== "string" || !input.text.trim()) {
    return fail(project, "Language CSV content is required.");
  }
  const parsed = importHmiLanguagePackCsv(input.text, { sourceFileName: input.sourceFileName });
  if (!parsed.ok || !parsed.languagePack) {
    return fail(project, parsed.errors[0] ?? "Language CSV could not be imported.");
  }
  const pack = parsed.languagePack;
  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  const exists = hmi.languagePacks.some((candidate) => candidate.languageId === pack.languageId);
  const languagePacks = exists
    ? hmi.languagePacks.map((candidate) => (candidate.languageId === pack.languageId ? { ...pack, id: candidate.id } : candidate))
    : [...hmi.languagePacks, pack];
  const next: HmiProject = { ...hmi, languagePacks };
  return commitHmi(project, next, { languageId: pack.languageId }, parsed.warnings);
}

export interface SetHmiDefaultLanguageInput {
  languageId: string;
}

/** Set the project's default (fallback) language. */
export function setHmiDefaultLanguage(
  project: PlcProject,
  input: SetHmiDefaultLanguageInput,
): ProjectActionResult<{ languageId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.languagePacks.some((pack) => pack.languageId === input.languageId)) {
    return fail(project, "Language pack was not found.");
  }
  const next: HmiProject = { ...hmi, defaultLanguage: input.languageId };
  return commitHmi(project, next, { languageId: input.languageId });
}

// ===========================================================================
// HMI security roles + users
// ===========================================================================

export interface CreateHmiSecurityRoleInput {
  name: string;
  roleId?: string;
  permissions?: string[];
}

/** Create an HMI security role. The first role created becomes the guest role. */
export function createHmiSecurityRole(
  project: PlcProject,
  input: CreateHmiSecurityRoleInput,
): ProjectActionResult<{ roleId: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Security role name is required.");
  const requestedId = optionalId(input.roleId, "Security role");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.security.roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `Security role "${name}" already exists.`);
  }
  if (requestedId.id && hmi.security.roles.some((role) => role.id === requestedId.id)) {
    return fail(project, `Security role id "${requestedId.id}" already exists.`);
  }
  const roleId = requestedId.id ?? createId("hmirole");
  const permissions = (input.permissions ?? []).map((permission) => permission.trim()).filter(Boolean);
  const roles = [...hmi.security.roles, { id: roleId, name, permissions }];
  const guestRoleId = hmi.security.guestRoleId ?? roleId;
  const next: HmiProject = { ...hmi, security: { ...hmi.security, roles, guestRoleId } };
  return commitHmi(project, next, { roleId });
}

export interface DeleteHmiSecurityRoleInput {
  roleId: string;
}

/** Delete a security role, removing it from users and reassigning the guest role if needed. */
export function deleteHmiSecurityRole(
  project: PlcProject,
  input: DeleteHmiSecurityRoleInput,
): ProjectActionResult<{ roleId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.security.roles.some((role) => role.id === input.roleId)) {
    return fail(project, "Security role was not found.");
  }
  const roles = hmi.security.roles.filter((role) => role.id !== input.roleId);
  const users = hmi.security.users.map((user) => ({
    ...user,
    roleIds: user.roleIds.filter((roleId) => roleId !== input.roleId),
  }));
  const guestRoleId = hmi.security.guestRoleId === input.roleId ? roles[0]?.id : hmi.security.guestRoleId;
  const next: HmiProject = { ...hmi, security: { ...hmi.security, roles, users, guestRoleId } };
  return commitHmi(project, next, { roleId: input.roleId });
}

export interface CreateHmiSecurityUserInput {
  username: string;
  roleIds: string[];
  userId?: string;
  fullName?: string;
}

/** Create an HMI security user assigned to one or more existing roles. */
export function createHmiSecurityUser(
  project: PlcProject,
  input: CreateHmiSecurityUserInput,
): ProjectActionResult<{ userId: string }> {
  const username = input.username?.trim();
  if (!username) return fail(project, "Security user name is required.");
  const requestedId = optionalId(input.userId, "Security user");
  if (!requestedId.ok) return fail(project, requestedId.error);

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.security.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return fail(project, `Security user "${username}" already exists.`);
  }
  if (requestedId.id && hmi.security.users.some((user) => user.id === requestedId.id)) {
    return fail(project, `Security user id "${requestedId.id}" already exists.`);
  }
  const roleIds = (input.roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean);
  if (roleIds.length === 0) return fail(project, "Security user requires at least one role.");
  const knownRoleIds = new Set(hmi.security.roles.map((role) => role.id));
  const missing = roleIds.find((roleId) => !knownRoleIds.has(roleId));
  if (missing) return fail(project, `Security role "${missing}" was not found.`);

  const userId = requestedId.id ?? createId("hmiuser");
  const user = { id: userId, username, roleIds, fullName: optionalText(input.fullName) };
  const next: HmiProject = { ...hmi, security: { ...hmi.security, users: [...hmi.security.users, user] } };
  return commitHmi(project, next, { userId });
}

export interface DeleteHmiSecurityUserInput {
  userId: string;
}

export function deleteHmiSecurityUser(
  project: PlcProject,
  input: DeleteHmiSecurityUserInput,
): ProjectActionResult<{ userId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (!hmi.security.users.some((user) => user.id === input.userId)) {
    return fail(project, "Security user was not found.");
  }
  const users = hmi.security.users.filter((user) => user.id !== input.userId);
  const next: HmiProject = { ...hmi, security: { ...hmi.security, users } };
  return commitHmi(project, next, { userId: input.userId });
}
