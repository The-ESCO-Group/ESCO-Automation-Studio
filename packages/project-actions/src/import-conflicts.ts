import type { PlcProject, TagScope } from "@esco/core";

export type EscoImportComponentKind =
  | "program"
  | "routine"
  | "data-type"
  | "custom-instruction"
  | "device-definition"
  | "tag";

export type EscoImportItemKind = EscoImportComponentKind | "tag-reference";

export type EscoImportResolutionOption =
  | "overwrite"
  | "rename"
  | "skip"
  | "map-existing-tag"
  | "create-new-tag";

export type EscoImportPreviewStatus =
  | "new"
  | "conflict"
  | "duplicate-in-import"
  | "tag-reference-mapped"
  | "tag-reference-missing";

export type EscoImportActionType =
  | "import"
  | "overwrite"
  | "rename"
  | "skip"
  | "map-existing-tag"
  | "create-new-tag";

export interface EscoImportNamespace {
  controllerName?: string;
  programName?: string;
  tagScope?: TagScope;
}

export interface EscoImportExistingName extends EscoImportNamespace {
  kind: EscoImportComponentKind;
  name: string;
}

export interface EscoImportIncomingItem extends EscoImportNamespace {
  kind: EscoImportItemKind;
  name: string;
  dataType?: string;
}

export interface EscoImportConflictPreviewRow extends EscoImportNamespace {
  id: string;
  kind: EscoImportItemKind;
  originalName: string;
  status: EscoImportPreviewStatus;
  existingName?: string;
  suggestedName?: string;
  dataType?: string;
  availableOptions: EscoImportResolutionOption[];
  defaultOption?: EscoImportResolutionOption;
  messages: string[];
}

export interface EscoImportConflictPreview {
  rows: EscoImportConflictPreviewRow[];
  existingNames: EscoImportExistingName[];
  newCount: number;
  conflictCount: number;
  duplicateInImportCount: number;
  mappedTagReferenceCount: number;
  missingTagReferenceCount: number;
}

export interface PreviewEscoImportConflictsInput {
  existingNames: readonly EscoImportExistingName[];
  incoming: readonly EscoImportIncomingItem[];
}

export interface EscoImportRenameOptions {
  separator?: string;
  maxLength?: number;
  startAt?: number;
}

export interface EscoImportResolutionChoice {
  id: string;
  option: EscoImportResolutionOption;
  renameTo?: string;
  mapToTagName?: string;
  mapToScope?: TagScope;
  mapToProgramName?: string;
  createTagName?: string;
  dataType?: string;
}

export interface EscoImportResolvedAction extends EscoImportNamespace {
  id: string;
  kind: EscoImportItemKind;
  originalName: string;
  action: EscoImportActionType;
  finalName?: string;
  existingName?: string;
  targetName?: string;
  dataType?: string;
}

export interface EscoImportResolutionError {
  id: string;
  message: string;
}

export interface EscoImportResolutionPlan {
  actions: EscoImportResolvedAction[];
  errors: EscoImportResolutionError[];
  importCount: number;
  overwriteCount: number;
  renameCount: number;
  skipCount: number;
  mappedTagCount: number;
  createdTagCount: number;
}

export interface ResolveEscoImportConflictsInput {
  preview: EscoImportConflictPreview;
  choices?: readonly EscoImportResolutionChoice[];
}

const DEFAULT_RENAME_MAX_LENGTH = 40;
const DEFAULT_TAG_DATA_TYPE = "BOOL";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sameName(left: string | undefined, right: string | undefined): boolean {
  return normalizeName(left ?? "") === normalizeName(right ?? "");
}

function displayName(name: string | undefined): string {
  return name?.trim() ?? "";
}

function compactNamespace(namespace: EscoImportNamespace): EscoImportNamespace {
  return {
    ...(displayName(namespace.controllerName) ? { controllerName: displayName(namespace.controllerName) } : {}),
    ...(displayName(namespace.programName) ? { programName: displayName(namespace.programName) } : {}),
    ...(namespace.tagScope ? { tagScope: namespace.tagScope } : {}),
  };
}

function namespaceKey(kind: EscoImportComponentKind, namespace: EscoImportNamespace): string {
  const controller = normalizeName(namespace.controllerName ?? "");
  if (kind === "routine") {
    return `${kind}|controller:${controller}|program:${normalizeName(namespace.programName ?? "")}`;
  }
  if (kind === "tag") {
    const scope = namespace.tagScope ?? "controller";
    const program = scope === "program" ? normalizeName(namespace.programName ?? "") : "";
    return `${kind}|controller:${controller}|scope:${scope}|program:${program}`;
  }
  return `${kind}|controller:${controller}`;
}

function nameKey(kind: EscoImportComponentKind, namespace: EscoImportNamespace, name: string): string {
  return `${namespaceKey(kind, namespace)}|name:${normalizeName(name)}`;
}

function usedNamesKey(kind: EscoImportComponentKind, namespace: EscoImportNamespace): string {
  return namespaceKey(kind, namespace);
}

function uniqueValues(values: Iterable<string | undefined>): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const name = displayName(value);
    if (name && !byKey.has(normalizeName(name))) byKey.set(normalizeName(name), name);
  }
  return [...byKey.values()];
}

function inferNamespace(
  item: EscoImportIncomingItem,
  existingNames: readonly EscoImportExistingName[],
): EscoImportNamespace {
  const controllerNames = uniqueValues(existingNames.map((entry) => entry.controllerName));
  const controllerName = displayName(item.controllerName) || (controllerNames.length === 1 ? controllerNames[0] : "");

  const programsInController = uniqueValues(
    existingNames
      .filter((entry) => entry.kind === "program" && (!controllerName || sameName(entry.controllerName, controllerName)))
      .map((entry) => entry.name),
  );
  const programName =
    displayName(item.programName) ||
    (needsProgramContext(item) && programsInController.length === 1 ? programsInController[0] : "");

  return compactNamespace({
    controllerName,
    programName,
    tagScope: item.tagScope,
  });
}

function needsProgramContext(item: EscoImportIncomingItem): boolean {
  return item.kind === "routine" || item.kind === "tag-reference" || item.tagScope === "program";
}

function componentKindForItem(item: EscoImportIncomingItem): EscoImportComponentKind | undefined {
  return item.kind === "tag-reference" ? undefined : item.kind;
}

function tagCreateNamespace(item: EscoImportIncomingItem, namespace: EscoImportNamespace): EscoImportNamespace {
  const scope = item.tagScope ?? (namespace.programName ? "program" : "controller");
  return compactNamespace({
    controllerName: namespace.controllerName,
    tagScope: scope,
    programName: scope === "program" ? namespace.programName : undefined,
  });
}

function tagReferenceLookupNamespaces(item: EscoImportIncomingItem, namespace: EscoImportNamespace): EscoImportNamespace[] {
  if (item.tagScope === "program") {
    return [compactNamespace({ ...namespace, tagScope: "program" })];
  }
  if (item.tagScope === "controller") {
    return [compactNamespace({ controllerName: namespace.controllerName, tagScope: "controller" })];
  }
  if (namespace.programName) {
    return [
      compactNamespace({ ...namespace, tagScope: "program" }),
      compactNamespace({ controllerName: namespace.controllerName, tagScope: "controller" }),
    ];
  }
  return [compactNamespace({ controllerName: namespace.controllerName, tagScope: "controller" })];
}

function getUsedSet(
  usedByNamespace: Map<string, Set<string>>,
  kind: EscoImportComponentKind,
  namespace: EscoImportNamespace,
): Set<string> {
  const key = usedNamesKey(kind, namespace);
  let used = usedByNamespace.get(key);
  if (!used) {
    used = new Set<string>();
    usedByNamespace.set(key, used);
  }
  return used;
}

function addUsedName(
  usedByNamespace: Map<string, Set<string>>,
  kind: EscoImportComponentKind,
  namespace: EscoImportNamespace,
  name: string,
): void {
  getUsedSet(usedByNamespace, kind, namespace).add(normalizeName(name));
}

function existingNameMap(existingNames: readonly EscoImportExistingName[]): Map<string, EscoImportExistingName> {
  const map = new Map<string, EscoImportExistingName>();
  for (const entry of existingNames) {
    const key = nameKey(entry.kind, entry, entry.name);
    if (!map.has(key)) map.set(key, { ...compactNamespace(entry), kind: entry.kind, name: entry.name });
  }
  return map;
}

function initialUsedNames(existingNames: readonly EscoImportExistingName[]): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const entry of existingNames) addUsedName(used, entry.kind, entry, entry.name);
  return used;
}

function findExistingTagForReference(
  item: EscoImportIncomingItem,
  namespace: EscoImportNamespace,
  byName: Map<string, EscoImportExistingName>,
): EscoImportExistingName | undefined {
  for (const tagNamespace of tagReferenceLookupNamespaces(item, namespace)) {
    const match = byName.get(nameKey("tag", tagNamespace, item.name));
    if (match) return match;
  }
  return undefined;
}

function rowId(
  item: EscoImportIncomingItem,
  namespace: EscoImportNamespace,
  ordinalByBaseId: Map<string, number>,
): string {
  const base =
    `${item.kind}:${namespaceKey(item.kind === "tag-reference" ? "tag" : item.kind, namespace)}` +
    `:${normalizeName(item.name) || "<blank>"}`;
  const next = (ordinalByBaseId.get(base) ?? 0) + 1;
  ordinalByBaseId.set(base, next);
  return next === 1 ? base : `${base}#${next}`;
}

export function suggestEscoImportRename(
  originalName: string,
  usedNames: Iterable<string>,
  options: EscoImportRenameOptions = {},
): string {
  const separator = options.separator ?? "_";
  const maxLength = options.maxLength ?? DEFAULT_RENAME_MAX_LENGTH;
  const startAt = Math.max(1, Math.trunc(options.startAt ?? 1));
  const used = new Set([...usedNames].map(normalizeName));
  const requested = originalName.trim() || "Imported";
  if (!used.has(normalizeName(requested))) return requested;

  for (let suffixNumber = startAt; suffixNumber < Number.MAX_SAFE_INTEGER; suffixNumber += 1) {
    const suffix = `${separator}${suffixNumber}`;
    const prefixLength = Math.max(1, maxLength - suffix.length);
    let prefix = requested.slice(0, prefixLength);
    if (separator === "_") prefix = prefix.replace(/_+$/g, "") || "Imported";
    const candidate = `${prefix}${suffix}`;
    if (!used.has(normalizeName(candidate))) return candidate;
  }

  return `${requested.slice(0, Math.max(1, maxLength - 2))}${separator}1`;
}

export function collectEscoImportNames(project: PlcProject): EscoImportExistingName[] {
  const names: EscoImportExistingName[] = [];
  for (const controller of project.controllers) {
    const controllerName = controller.name;
    for (const program of controller.programs) {
      names.push({ kind: "program", controllerName, name: program.name });
      for (const routine of program.routines) {
        names.push({ kind: "routine", controllerName, programName: program.name, name: routine.name });
      }
      for (const tag of program.programTags) {
        names.push({
          kind: "tag",
          controllerName,
          programName: program.name,
          tagScope: "program",
          name: tag.name,
        });
      }
    }
    for (const tag of controller.controllerTags) {
      names.push({ kind: "tag", controllerName, tagScope: "controller", name: tag.name });
    }
    for (const dataType of controller.dataTypes) {
      names.push({ kind: "data-type", controllerName, name: dataType.name });
    }
    for (const customInstruction of controller.addOnInstructions) {
      names.push({ kind: "custom-instruction", controllerName, name: customInstruction.name });
    }
    for (const device of controller.ioConfiguration.modules) {
      names.push({ kind: "device-definition", controllerName, name: device.name });
    }
  }
  return names;
}

export function previewEscoImportConflicts(
  input: PreviewEscoImportConflictsInput,
): EscoImportConflictPreview {
  const existingNames = input.existingNames.map((entry) => ({ ...compactNamespace(entry), kind: entry.kind, name: entry.name }));
  const byName = existingNameMap(existingNames);
  const usedByNamespace = initialUsedNames(existingNames);
  const ordinalByBaseId = new Map<string, number>();
  const rows: EscoImportConflictPreviewRow[] = [];

  for (const item of input.incoming) {
    const namespace = inferNamespace(item, existingNames);
    const id = rowId(item, namespace, ordinalByBaseId);
    const originalName = item.name.trim();
    const messages: string[] = [];
    if (!originalName) messages.push("Incoming import item is missing a name.");

    if (item.kind === "tag-reference") {
      const existing = findExistingTagForReference(item, namespace, byName);
      const createNamespace = existing ? compactNamespace(existing) : tagCreateNamespace(item, namespace);
      const createUsed = getUsedSet(usedByNamespace, "tag", createNamespace);
      const suggestedName = suggestEscoImportRename(originalName, createUsed);
      if (!existing && suggestedName) createUsed.add(normalizeName(suggestedName));

      rows.push({
        id,
        kind: item.kind,
        originalName,
        ...createNamespace,
        status: existing ? "tag-reference-mapped" : "tag-reference-missing",
        ...(existing ? { existingName: existing.name } : {}),
        suggestedName,
        dataType: item.dataType,
        availableOptions: existing
          ? ["map-existing-tag", "create-new-tag", "skip"]
          : ["create-new-tag", "map-existing-tag", "skip"],
        defaultOption: existing ? "map-existing-tag" : "create-new-tag",
        messages,
      });
      continue;
    }

    const kind = componentKindForItem(item)!;
    const used = getUsedSet(usedByNamespace, kind, namespace);
    const existing = byName.get(nameKey(kind, namespace, originalName));
    const alreadyUsed = used.has(normalizeName(originalName));

    if (!existing && !alreadyUsed) {
      used.add(normalizeName(originalName));
      rows.push({
        id,
        kind,
        originalName,
        ...namespace,
        status: "new",
        dataType: item.dataType,
        availableOptions: ["rename", "skip"],
        messages,
      });
      continue;
    }

    const suggestedName = suggestEscoImportRename(originalName, used);
    used.add(normalizeName(suggestedName));
    rows.push({
      id,
      kind,
      originalName,
      ...namespace,
      status: existing ? "conflict" : "duplicate-in-import",
      ...(existing ? { existingName: existing.name } : {}),
      suggestedName,
      dataType: item.dataType,
      availableOptions: existing ? ["overwrite", "rename", "skip"] : ["rename", "skip"],
      defaultOption: "rename",
      messages,
    });
  }

  return {
    rows,
    existingNames,
    newCount: rows.filter((row) => row.status === "new").length,
    conflictCount: rows.filter((row) => row.status === "conflict").length,
    duplicateInImportCount: rows.filter((row) => row.status === "duplicate-in-import").length,
    mappedTagReferenceCount: rows.filter((row) => row.status === "tag-reference-mapped").length,
    missingTagReferenceCount: rows.filter((row) => row.status === "tag-reference-missing").length,
  };
}

function choiceMap(choices: readonly EscoImportResolutionChoice[] | undefined): Map<string, EscoImportResolutionChoice> {
  const map = new Map<string, EscoImportResolutionChoice>();
  for (const choice of choices ?? []) map.set(choice.id, choice);
  return map;
}

function pushError(errors: EscoImportResolutionError[], id: string, message: string): void {
  errors.push({ id, message });
}

function tagExists(
  preview: EscoImportConflictPreview,
  row: EscoImportConflictPreviewRow,
  name: string,
  scope: TagScope | undefined,
  programName: string | undefined,
): boolean {
  const desiredScope = scope ?? row.tagScope ?? "controller";
  return preview.existingNames.some(
    (entry) =>
      entry.kind === "tag" &&
      sameName(entry.controllerName, row.controllerName) &&
      entry.tagScope === desiredScope &&
      (desiredScope !== "program" || sameName(entry.programName, programName ?? row.programName)) &&
      sameName(entry.name, name),
  );
}

type EscoImportResolvedActionPatch = Pick<EscoImportResolvedAction, "action"> &
  Partial<Omit<EscoImportResolvedAction, "id" | "kind" | "originalName" | "action">>;

function addAction(
  actions: EscoImportResolvedAction[],
  row: EscoImportConflictPreviewRow,
  action: EscoImportResolvedActionPatch,
): void {
  actions.push({
    controllerName: row.controllerName,
    programName: row.programName,
    tagScope: row.tagScope,
    ...action,
    id: row.id,
    kind: row.kind,
    originalName: row.originalName,
  });
}

function chooseFinalName(
  row: EscoImportConflictPreviewRow,
  choice: EscoImportResolutionChoice | undefined,
  used: Set<string>,
): string {
  const requested = choice?.renameTo?.trim() || row.suggestedName || row.originalName;
  if (!used.has(normalizeName(requested))) return requested;
  return suggestEscoImportRename(row.originalName, used);
}

export function resolveEscoImportConflicts(
  input: ResolveEscoImportConflictsInput,
): EscoImportResolutionPlan {
  const choices = choiceMap(input.choices);
  const usedByNamespace = initialUsedNames(input.preview.existingNames);
  const actions: EscoImportResolvedAction[] = [];
  const errors: EscoImportResolutionError[] = [];

  for (const row of input.preview.rows) {
    const choice = choices.get(row.id);
    const option = choice?.option ?? row.defaultOption;

    if (!option) {
      if (choice?.option === "skip") {
        addAction(actions, row, { action: "skip" });
      } else if (choice?.option === "rename") {
        const used = getUsedSet(usedByNamespace, row.kind as EscoImportComponentKind, row);
        const finalName = chooseFinalName(row, choice, used);
        used.add(normalizeName(finalName));
        addAction(actions, row, { action: "rename", finalName });
      } else {
        const used = getUsedSet(usedByNamespace, row.kind as EscoImportComponentKind, row);
        used.add(normalizeName(row.originalName));
        addAction(actions, row, { action: "import", finalName: row.originalName });
      }
      continue;
    }

    if (!row.availableOptions.includes(option)) {
      pushError(errors, row.id, `"${option}" is not available for ${row.kind} "${row.originalName}".`);
      continue;
    }

    if (option === "skip") {
      addAction(actions, row, { action: "skip" });
      continue;
    }

    if (option === "overwrite") {
      addAction(actions, row, {
        action: "overwrite",
        existingName: row.existingName,
        finalName: row.existingName ?? row.originalName,
      });
      continue;
    }

    if (option === "rename") {
      const kind = row.kind as EscoImportComponentKind;
      const used = getUsedSet(usedByNamespace, kind, row);
      const explicitName = choice?.renameTo?.trim();
      if (explicitName && used.has(normalizeName(explicitName))) {
        pushError(errors, row.id, `Rename target "${explicitName}" already exists.`);
        continue;
      }
      const finalName = chooseFinalName(row, choice, used);
      used.add(normalizeName(finalName));
      addAction(actions, row, { action: "rename", finalName });
      continue;
    }

    if (option === "map-existing-tag") {
      const targetName = choice?.mapToTagName?.trim() || row.existingName;
      if (!targetName) {
        pushError(errors, row.id, `Choose an existing tag for "${row.originalName}" before mapping it.`);
        continue;
      }
      if (!tagExists(input.preview, row, targetName, choice?.mapToScope, choice?.mapToProgramName)) {
        pushError(errors, row.id, `Tag "${targetName}" does not exist in the selected ESCO tag scope.`);
        continue;
      }
      addAction(actions, row, {
        action: "map-existing-tag",
        targetName,
        tagScope: choice?.mapToScope ?? row.tagScope,
        programName: choice?.mapToProgramName ?? row.programName,
      });
      continue;
    }

    if (option === "create-new-tag") {
      const createNamespace = compactNamespace({
        controllerName: row.controllerName,
        programName: choice?.mapToProgramName ?? row.programName,
        tagScope: choice?.mapToScope ?? row.tagScope ?? "controller",
      });
      const used = getUsedSet(usedByNamespace, "tag", createNamespace);
      const requested = choice?.createTagName?.trim();
      if (requested && used.has(normalizeName(requested))) {
        pushError(errors, row.id, `Tag "${requested}" already exists in the selected ESCO tag scope.`);
        continue;
      }
      const finalName = requested || chooseFinalName(row, choice, used);
      used.add(normalizeName(finalName));
      addAction(actions, row, {
        action: "create-new-tag",
        finalName,
        dataType: choice?.dataType?.trim() || row.dataType || DEFAULT_TAG_DATA_TYPE,
        ...createNamespace,
      });
    }
  }

  return {
    actions,
    errors,
    importCount: actions.filter((action) => action.action === "import").length,
    overwriteCount: actions.filter((action) => action.action === "overwrite").length,
    renameCount: actions.filter((action) => action.action === "rename").length,
    skipCount: actions.filter((action) => action.action === "skip").length,
    mappedTagCount: actions.filter((action) => action.action === "map-existing-tag").length,
    createdTagCount: actions.filter((action) => action.action === "create-new-tag").length,
  };
}
