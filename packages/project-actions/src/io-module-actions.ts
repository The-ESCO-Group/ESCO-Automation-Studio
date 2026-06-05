import { createTag as makeTag, type IoModule, type ModuleConnection, type PlcProject, type Tag } from "@esco/core";
import { createId, nowIso } from "@esco/shared";
import { fail, ok } from "./helpers";
import { logixIdentifierError } from "./logix-names";
import type { AddIoModuleInput, IoModuleSetupTagInput, ProjectActionResult, RemoveIoModuleInput, UpdateIoModuleInput } from "./types";

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function canonicalElectronicKeying(value: string | undefined): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  const folded = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (folded === "notspecified") return undefined;
  if (folded === "exactmatch") return "ExactMatch";
  if (folded === "compatiblemodule") return "CompatibleModule";
  if (folded === "disabled" || folded === "disable" || folded === "disablekeying" || folded === "keyingdisabled") return "Disabled";
  return text;
}

function canonicalInputConnectionType(value: string | undefined): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  const folded = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (folded === "multicast") return "Multicast";
  if (folded === "unicast") return "Unicast";
  if (folded === "null") return "Null";
  if (["analogonly", "analogandhart", "digitalonly", "inputdata", "outputdata"].includes(folded)) return "Multicast";
  if (["none", "noinput", "noinputdata"].includes(folded)) return "Null";
  return text;
}

function canonicalInputProductionTrigger(value: string | undefined): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  const folded = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (folded === "cyclic") return "Cyclic";
  if (folded === "cos" || folded === "changeofstate") return "COS";
  if (folded === "application") return "Application";
  return text;
}

interface StoredIoModuleProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

interface IoModuleProfileExtension {
  profileChannels?: StoredIoModuleProfileChannel[];
}

const SETUP_TAG_DATA_TYPES = new Set(["BOOL", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL", "STRING"]);
const SETUP_TAG_EXTERNAL_ACCESS = new Set(["read-write", "read-only", "none"]);

function cleanProfileChannels(value: unknown): StoredIoModuleProfileChannel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as StoredIoModuleProfileChannel;
    const channel: StoredIoModuleProfileChannel = {
      ...(optionalText(row.id) ? { id: optionalText(row.id) } : {}),
      ...(optionalText(row.label) ? { label: optionalText(row.label) } : {}),
      ...(optionalText(row.direction) ? { direction: optionalText(row.direction) } : {}),
      ...(optionalText(row.signal) ? { signal: optionalText(row.signal) } : {}),
      enabled: row.enabled !== false,
      ...(optionalText(row.dataFormat) ? { dataFormat: optionalText(row.dataFormat) } : {}),
      ...(optionalText(row.range) ? { range: optionalText(row.range) } : {}),
      ...(optionalText(row.diagnostic) ? { diagnostic: optionalText(row.diagnostic) } : {}),
    };
    return Object.keys(channel).length ? [channel] : [];
  });
}

function cleanSlot(slot: number | undefined): number | undefined {
  if (slot == null || Number.isNaN(slot)) return undefined;
  return Math.trunc(slot);
}

function cleanPositiveNumber(value: number | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  return Math.trunc(value);
}

function setupTagDefaultValue(dataType: string): boolean | number | string {
  if (dataType === "BOOL") return false;
  if (dataType === "STRING") return "";
  return 0;
}

function cleanSetupTagDataType(value: string | undefined): string | undefined {
  const dataType = optionalText(value)?.toUpperCase() ?? "DINT";
  return SETUP_TAG_DATA_TYPES.has(dataType) ? dataType : undefined;
}

function setupTagsFromInput(
  controllerId: string,
  existingTags: Tag[],
  rows: IoModuleSetupTagInput[] | undefined,
): { tags: Tag[]; error?: string } {
  if (!rows?.length) return { tags: [] };
  const existingNames = new Set(existingTags.map((tag) => tag.name.toLowerCase()));
  const nextNames = new Set<string>();
  const tags: Tag[] = [];
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) return { tags: [], error: "I/O setup tag name is required." };
    const invalidName = logixIdentifierError(name, "I/O setup tag");
    if (invalidName) return { tags: [], error: invalidName };
    const key = name.toLowerCase();
    if (existingNames.has(key) || nextNames.has(key)) {
      return { tags: [], error: `I/O setup tag "${name}" already exists.` };
    }
    const dataType = cleanSetupTagDataType(row.dataType);
    if (!dataType) {
      return { tags: [], error: `I/O setup tag "${name}" uses unsupported data type "${row.dataType}".` };
    }
    if (row.externalAccess && !SETUP_TAG_EXTERNAL_ACCESS.has(row.externalAccess)) {
      return { tags: [], error: `I/O setup tag "${name}" uses unsupported ExternalAccess "${row.externalAccess}".` };
    }
    nextNames.add(key);
    tags.push(
      makeTag(controllerId, name, dataType, {
        scope: "controller",
        description: optionalText(row.description),
        value: setupTagDefaultValue(dataType),
        externalAccess: row.externalAccess,
      }),
    );
  }
  return { tags };
}

function slotTaken(
  modules: IoModule[],
  slot: number,
  parentModule: string | undefined,
  parentPortId: string | undefined,
  excludeModuleId?: string,
): boolean {
  return modules.some(
    (module) =>
      module.id !== excludeModuleId &&
      module.slot === slot &&
      (module.parentModule ?? "") === (parentModule ?? "") &&
      (module.parentPortId ?? "") === (parentPortId ?? ""),
  );
}

function moduleFromInput(id: string, input: AddIoModuleInput, preserve?: Pick<IoModule, "majorFault" | "ports" | "connections">): IoModule {
  const slot = cleanSlot(input.slot);
  const electronicKeying = canonicalElectronicKeying(input.electronicKeying);
  const nextProfileChannels = cleanProfileChannels((input as AddIoModuleInput & IoModuleProfileExtension).profileChannels);
  const preservedProfileChannels = cleanProfileChannels((preserve as IoModuleProfileExtension | undefined)?.profileChannels);
  const module: IoModule = {
    id,
    name: input.name.trim(),
    ...(optionalText(input.catalogNumber) ? { catalogNumber: optionalText(input.catalogNumber) } : {}),
    ...(slot != null ? { slot } : {}),
    ...(optionalText(input.description) ? { description: optionalText(input.description) } : {}),
    ...(optionalText(input.parentModule) ? { parentModule: optionalText(input.parentModule) } : {}),
    ...(optionalText(input.parentPortId) ? { parentPortId: optionalText(input.parentPortId) } : {}),
    ...(optionalText(input.commPath) ? { commPath: optionalText(input.commPath) } : {}),
    ...(optionalText(input.vendor) ? { vendor: optionalText(input.vendor) } : {}),
    ...(optionalText(input.productType) ? { productType: optionalText(input.productType) } : {}),
    ...(optionalText(input.productCode) ? { productCode: optionalText(input.productCode) } : {}),
    ...(optionalText(input.majorRevision) ? { majorRevision: optionalText(input.majorRevision) } : {}),
    ...(optionalText(input.minorRevision) ? { minorRevision: optionalText(input.minorRevision) } : {}),
    ...(electronicKeying ? { electronicKeying } : {}),
    ...(input.inhibited ? { inhibited: true } : {}),
    ...(preserve?.majorFault != null ? { majorFault: preserve.majorFault } : {}),
    ...(preserve?.ports?.length ? { ports: preserve.ports } : {}),
    ...(preserve?.connections?.length ? { connections: preserve.connections } : {}),
  };
  const profileChannels = nextProfileChannels ?? preservedProfileChannels;
  if (profileChannels?.length) {
    (module as IoModule & IoModuleProfileExtension).profileChannels = profileChannels;
  }
  return module;
}

function firstConnectionFromInput(input: AddIoModuleInput, current?: IoModule): ModuleConnection[] | undefined {
  const existingRest = current?.connections?.slice(1) ?? [];
  if (!input.connection) return current?.connections?.length ? current.connections : undefined;
  const rpi = cleanPositiveNumber(input.connection.rpi);
  const inputConnectionType = canonicalInputConnectionType(input.connection.inputConnectionType);
  const inputProductionTrigger = canonicalInputProductionTrigger(input.connection.inputProductionTrigger);
  const first: ModuleConnection = {
    ...(optionalText(input.connection.name) ? { name: optionalText(input.connection.name) } : {}),
    ...(rpi != null ? { rpi } : {}),
    ...(optionalText(input.connection.type) ? { type: optionalText(input.connection.type) } : {}),
    ...(optionalText(input.connection.priority) ? { priority: optionalText(input.connection.priority) } : {}),
    ...(input.connection.unicast ? { unicast: true } : {}),
    ...(inputConnectionType ? { inputConnectionType } : {}),
    ...(inputProductionTrigger ? { inputProductionTrigger } : {}),
    ...(input.connection.outputRedundantOwner ? { outputRedundantOwner: true } : {}),
  };
  const connections = Object.keys(first).length ? [first, ...existingRest] : existingRest;
  return connections.length ? connections : undefined;
}

export function addIoModule(
  project: PlcProject,
  input: AddIoModuleInput,
): ProjectActionResult<{ controllerId: string; moduleId: string; setupTagIds: string[]; setupTagNames: string[] }> {
  const controllerId = input.controllerId?.trim();
  const name = input.name?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!name) return fail(project, "I/O module name is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);

  const invalidName = logixIdentifierError(name, "I/O module");
  if (invalidName) return fail(project, invalidName);
  if (controller.ioConfiguration.modules.some((module) => module.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `I/O module "${name}" already exists in controller "${controller.name}".`);
  }

  const slot = cleanSlot(input.slot);
  if (slot != null && slot < 0) return fail(project, "I/O module slot must be zero or greater.");
  const parentModule = optionalText(input.parentModule);
  const parentPortId = optionalText(input.parentPortId);
  if (slot != null && slotTaken(controller.ioConfiguration.modules, slot, parentModule, parentPortId)) {
    return fail(project, `I/O module slot ${slot} is already used in this parent I/O location.`);
  }
  const rpi = cleanPositiveNumber(input.connection?.rpi);
  if (rpi != null && rpi <= 0) return fail(project, "I/O connection RPI must be greater than zero.");

  const setupTags = setupTagsFromInput(controller.id, controller.controllerTags, input.setupTags);
  if (setupTags.error) return fail(project, setupTags.error);

  const module = moduleFromInput(createId("iomod"), input, { connections: firstConnectionFromInput(input) });

  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controllerId
        ? {
            ...candidate,
          ioConfiguration: {
            ...candidate.ioConfiguration,
            modules: [...candidate.ioConfiguration.modules, module],
          },
          controllerTags: [...candidate.controllerTags, ...setupTags.tags],
        }
      : candidate,
    ),
  };

  return ok(next, {
    controllerId,
    moduleId: module.id,
    setupTagIds: setupTags.tags.map((tag) => tag.id),
    setupTagNames: setupTags.tags.map((tag) => tag.name),
  });
}

export function updateIoModule(
  project: PlcProject,
  input: UpdateIoModuleInput,
): ProjectActionResult<{ controllerId: string; moduleId: string }> {
  const controllerId = input.controllerId?.trim();
  const moduleId = input.moduleId?.trim();
  const name = input.name?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!moduleId) return fail(project, "I/O module id is required.");
  if (!name) return fail(project, "I/O module name is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);
  const current = controller.ioConfiguration.modules.find((module) => module.id === moduleId);
  if (!current) return fail(project, `I/O module "${moduleId}" not found.`);

  const invalidName = logixIdentifierError(name, "I/O module");
  if (invalidName) return fail(project, invalidName);
  if (
    controller.ioConfiguration.modules.some(
      (module) => module.id !== moduleId && module.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return fail(project, `I/O module "${name}" already exists in controller "${controller.name}".`);
  }

  const slot = cleanSlot(input.slot);
  if (slot != null && slot < 0) return fail(project, "I/O module slot must be zero or greater.");
  const parentModule = optionalText(input.parentModule);
  const parentPortId = optionalText(input.parentPortId);
  if (slot != null && slotTaken(controller.ioConfiguration.modules, slot, parentModule, parentPortId, moduleId)) {
    return fail(project, `I/O module slot ${slot} is already used in this parent I/O location.`);
  }
  const rpi = cleanPositiveNumber(input.connection?.rpi);
  if (rpi != null && rpi <= 0) return fail(project, "I/O connection RPI must be greater than zero.");

  const connections = firstConnectionFromInput(input, current);
  const updatedModule = moduleFromInput(current.id, { ...input, name }, { ...current, connections });

  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controllerId
        ? {
            ...candidate,
            ioConfiguration: {
              ...candidate.ioConfiguration,
              modules: candidate.ioConfiguration.modules.map((module) => (module.id === moduleId ? updatedModule : module)),
            },
          }
        : candidate,
    ),
  };

  return ok(next, { controllerId, moduleId });
}

export function removeIoModule(
  project: PlcProject,
  input: RemoveIoModuleInput,
): ProjectActionResult<{ controllerId: string; moduleId: string; moduleName: string }> {
  const controllerId = input.controllerId?.trim();
  const moduleId = input.moduleId?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!moduleId) return fail(project, "I/O module id is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);
  const current = controller.ioConfiguration.modules.find((module) => module.id === moduleId);
  if (!current) return fail(project, `I/O module "${moduleId}" not found.`);

  const children = controller.ioConfiguration.modules.filter(
    (module) => module.id !== moduleId && module.parentModule?.toLowerCase() === current.name.toLowerCase(),
  );
  if (children.length > 0) {
    return fail(
      project,
      `I/O module "${current.name}" has child module${children.length === 1 ? "" : "s"} (${children
        .map((module) => module.name)
        .join(", ")}). Remove child modules first.`,
    );
  }

  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controllerId
        ? {
            ...candidate,
            ioConfiguration: {
              ...candidate.ioConfiguration,
              modules: candidate.ioConfiguration.modules.filter((module) => module.id !== moduleId),
            },
          }
        : candidate,
    ),
  };

  return ok(next, { controllerId, moduleId, moduleName: current.name });
}
