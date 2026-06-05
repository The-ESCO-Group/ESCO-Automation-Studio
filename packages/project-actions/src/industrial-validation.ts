import type { Controller, IoModule, IoPort, PlcProject, Program, Tag, Task } from "@esco/core";

export type IndustrialValidationSeverity = "error" | "warning" | "suggestion";

export type IndustrialValidationRuleId =
  | "duplicate-tag"
  | "undefined-alias"
  | "invalid-alias"
  | "alias-cycle"
  | "missing-task-schedule"
  | "missing-main-routine"
  | "missing-update-rate"
  | "invalid-update-rate"
  | "missing-rpi"
  | "invalid-rpi"
  | "invalid-module-slot"
  | "duplicate-module-slot"
  | "missing-network-address"
  | "invalid-network-address"
  | "module-parent-compatibility";

export type IndustrialValidationTargetKind =
  | "project"
  | "controller"
  | "controller-network"
  | "task"
  | "program"
  | "tag"
  | "module"
  | "module-port"
  | "module-connection";

export interface IndustrialValidationTarget {
  kind: IndustrialValidationTargetKind;
  path: string;
  projectId?: string;
  controllerId?: string;
  taskId?: string;
  programId?: string;
  tagId?: string;
  moduleId?: string;
  portId?: string;
  name?: string;
}

export interface IndustrialValidationFinding {
  ruleId: IndustrialValidationRuleId;
  severity: IndustrialValidationSeverity;
  message: string;
  target: IndustrialValidationTarget;
  relatedTargets?: IndustrialValidationTarget[];
  details?: Record<string, string | number | boolean | undefined>;
}

export interface IndustrialValidationModelLimit {
  ruleId: IndustrialValidationRuleId;
  message: string;
}

export interface IndustrialValidationSummary {
  findingCount: number;
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  controllerCount: number;
  tagCount: number;
  taskCount: number;
  moduleCount: number;
}

export interface IndustrialValidationReport {
  findings: IndustrialValidationFinding[];
  errors: IndustrialValidationFinding[];
  warnings: IndustrialValidationFinding[];
  suggestions: IndustrialValidationFinding[];
  summary: IndustrialValidationSummary;
  modelLimits: IndustrialValidationModelLimit[];
}

interface ScopedTag {
  controller: Controller;
  program?: Program;
  tag: Tag;
}

interface AliasBase {
  programName?: string;
  baseName: string;
}

const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_]*";
const QUALIFIED_ALIAS = new RegExp(`^Program:(${IDENTIFIER})\\.(${IDENTIFIER})(.*)$`, "i");
const BARE_ALIAS = new RegExp(`^(${IDENTIFIER})(.*)$`);
const NETWORK_HINT = /(ethernet|ethernet\/ip|enet|network|enbt|en2t|en3t|en4t|aent|eweb)/i;
const IP_FIELDS = ["IPAddress", "SubnetMask", "Gateway", "PrimaryDNS", "SecondaryDNS"] as const;

const MODEL_LIMITS: IndustrialValidationModelLimit[] = [
  {
    ruleId: "module-parent-compatibility",
    message:
      "ESCO validates imported module parent names, parent ports, and bus-size slot bounds; full catalog/electrical compatibility requires metadata the current project model does not carry.",
  },
  {
    ruleId: "missing-network-address",
    message:
      "ESCO can require an IP address only when Ethernet/network metadata, module port addresses, communication paths, or catalog hints are present in the offline model.",
  },
  {
    ruleId: "invalid-rpi",
    message:
      "ESCO validates authored RPI/update-rate numbers but does not model live connection negotiation, network load, or controller scheduling online.",
  },
];

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function key(value: string | undefined): string {
  return text(value)?.toLowerCase() ?? "";
}

function quotedList(values: string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function invalidPositiveInteger(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0);
}

function invalidNonNegativeInteger(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value < 0);
}

function attr(attributes: Record<string, string> | undefined, name: string): string | undefined {
  if (!attributes) return undefined;
  const direct = text(attributes[name]);
  if (direct) return direct;
  for (const [candidate, value] of Object.entries(attributes)) {
    if (candidate.toLowerCase() === name.toLowerCase()) return text(value);
  }
  return undefined;
}

function isIPv4(value: string): boolean {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function ipv4Candidates(value: string | undefined): string[] {
  return value?.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
}

function hasIPv4(value: string | undefined): boolean {
  return ipv4Candidates(value).some(isIPv4);
}

function targetController(project: PlcProject, controller: Controller): IndustrialValidationTarget {
  return {
    kind: "controller",
    projectId: project.id,
    controllerId: controller.id,
    path: `${project.name}/${controller.name}`,
    name: controller.name,
  };
}

function targetControllerNetwork(project: PlcProject, controller: Controller): IndustrialValidationTarget {
  return {
    kind: "controller-network",
    projectId: project.id,
    controllerId: controller.id,
    path: `${project.name}/${controller.name}/Network`,
    name: controller.name,
  };
}

function targetTask(project: PlcProject, controller: Controller, task: Task): IndustrialValidationTarget {
  return {
    kind: "task",
    projectId: project.id,
    controllerId: controller.id,
    taskId: task.id,
    path: `${project.name}/${controller.name}/Tasks/${task.name}`,
    name: task.name,
  };
}

function targetProgram(project: PlcProject, controller: Controller, program: Program): IndustrialValidationTarget {
  return {
    kind: "program",
    projectId: project.id,
    controllerId: controller.id,
    programId: program.id,
    path: `${project.name}/${controller.name}/Programs/${program.name}`,
    name: program.name,
  };
}

function targetTag(project: PlcProject, scoped: ScopedTag): IndustrialValidationTarget {
  const base = scoped.program
    ? `${project.name}/${scoped.controller.name}/Programs/${scoped.program.name}/Tags/${scoped.tag.name}`
    : `${project.name}/${scoped.controller.name}/Controller Tags/${scoped.tag.name}`;
  return {
    kind: "tag",
    projectId: project.id,
    controllerId: scoped.controller.id,
    programId: scoped.program?.id,
    tagId: scoped.tag.id,
    path: base,
    name: scoped.tag.name,
  };
}

function targetModule(project: PlcProject, controller: Controller, module: IoModule): IndustrialValidationTarget {
  return {
    kind: "module",
    projectId: project.id,
    controllerId: controller.id,
    moduleId: module.id,
    path: `${project.name}/${controller.name}/I/O/${module.name}`,
    name: module.name,
  };
}

function targetModulePort(
  project: PlcProject,
  controller: Controller,
  module: IoModule,
  port: IoPort,
): IndustrialValidationTarget {
  return {
    kind: "module-port",
    projectId: project.id,
    controllerId: controller.id,
    moduleId: module.id,
    portId: port.id,
    path: `${project.name}/${controller.name}/I/O/${module.name}/Ports/${port.id ?? port.type ?? "unnamed"}`,
    name: port.id ?? port.type,
  };
}

function targetModuleConnection(
  project: PlcProject,
  controller: Controller,
  module: IoModule,
  connectionIndex: number,
  connectionName: string | undefined,
): IndustrialValidationTarget {
  return {
    kind: "module-connection",
    projectId: project.id,
    controllerId: controller.id,
    moduleId: module.id,
    path: `${project.name}/${controller.name}/I/O/${module.name}/Connections/${connectionName ?? connectionIndex + 1}`,
    name: connectionName,
  };
}

function addFinding(
  findings: IndustrialValidationFinding[],
  ruleId: IndustrialValidationRuleId,
  severity: IndustrialValidationSeverity,
  message: string,
  target: IndustrialValidationTarget,
  relatedTargets?: IndustrialValidationTarget[],
  details?: IndustrialValidationFinding["details"],
): void {
  findings.push({
    ruleId,
    severity,
    message,
    target,
    ...(relatedTargets?.length ? { relatedTargets } : {}),
    ...(details ? { details } : {}),
  });
}

function allScopedTags(controller: Controller): ScopedTag[] {
  return [
    ...controller.controllerTags.map((tag) => ({ controller, tag })),
    ...controller.programs.flatMap((program) =>
      program.programTags.map((tag) => ({ controller, program, tag })),
    ),
  ];
}

function tagDisplay(scoped: ScopedTag): string {
  return scoped.program
    ? `program tag "${scoped.program.name}.${scoped.tag.name}"`
    : `controller tag "${scoped.tag.name}"`;
}

function parseAliasBase(aliasFor: string): AliasBase | undefined {
  const trimmed = aliasFor.trim();
  const qualified = trimmed.match(QUALIFIED_ALIAS);
  if (qualified) return { programName: qualified[1]!, baseName: qualified[2]! };
  const bare = trimmed.match(BARE_ALIAS);
  if (bare) return { baseName: bare[1]! };
  return undefined;
}

function resolveAliasTarget(context: ScopedTag, aliasFor: string): ScopedTag | undefined {
  const parsed = parseAliasBase(aliasFor);
  if (!parsed) return undefined;

  if (parsed.programName) {
    const program = context.controller.programs.find((candidate) => key(candidate.name) === key(parsed.programName));
    const tag = program?.programTags.find((candidate) => key(candidate.name) === key(parsed.baseName));
    return program && tag ? { controller: context.controller, program, tag } : undefined;
  }

  if (context.program) {
    const local = context.program.programTags.find((candidate) => key(candidate.name) === key(parsed.baseName));
    if (local) return { controller: context.controller, program: context.program, tag: local };
  }

  const controllerTag = context.controller.controllerTags.find((candidate) => key(candidate.name) === key(parsed.baseName));
  return controllerTag ? { controller: context.controller, tag: controllerTag } : undefined;
}

function aliasCycleIncludes(context: ScopedTag, firstTarget: ScopedTag): boolean {
  const seen = new Set<string>();
  let cursor: ScopedTag | undefined = firstTarget;
  while (cursor) {
    if (cursor.tag.id === context.tag.id) return true;
    if (seen.has(cursor.tag.id)) return false;
    seen.add(cursor.tag.id);
    cursor = cursor.tag.aliasFor ? resolveAliasTarget(cursor, cursor.tag.aliasFor) : undefined;
  }
  return false;
}

function validateDuplicateTags(project: PlcProject, controller: Controller, findings: IndustrialValidationFinding[]): void {
  function checkScope(tags: ScopedTag[], scopeTarget: IndustrialValidationTarget, scopeName: string): void {
    const groups = new Map<string, ScopedTag[]>();
    for (const scoped of tags) {
      const normalized = key(scoped.tag.name);
      if (!normalized) continue;
      groups.set(normalized, [...(groups.get(normalized) ?? []), scoped]);
    }

    for (const duplicates of groups.values()) {
      if (duplicates.length < 2) continue;
      addFinding(
        findings,
        "duplicate-tag",
        "error",
        `ESCO industrial validation found duplicate ${scopeName} tag names ${quotedList(duplicates.map((entry) => entry.tag.name))}. Tag names must be unique within a controller or program scope.`,
        scopeTarget,
        duplicates.map((entry) => targetTag(project, entry)),
        { duplicateCount: duplicates.length },
      );
    }
  }

  checkScope(
    controller.controllerTags.map((tag) => ({ controller, tag })),
    targetController(project, controller),
    "controller",
  );

  for (const program of controller.programs) {
    checkScope(
      program.programTags.map((tag) => ({ controller, program, tag })),
      targetProgram(project, controller, program),
      `program "${program.name}"`,
    );
  }
}

function validateAliases(project: PlcProject, controller: Controller, findings: IndustrialValidationFinding[]): void {
  for (const scoped of allScopedTags(controller)) {
    const aliasFor = scoped.tag.aliasFor;
    const aliasesByType = scoped.tag.dataType.trim().toUpperCase() === "ALIAS";
    if (aliasFor == null && !aliasesByType) continue;

    if (!text(aliasFor)) {
      addFinding(
        findings,
        "undefined-alias",
        "error",
        `ESCO industrial validation found ${tagDisplay(scoped)} marked as an alias without an alias target.`,
        targetTag(project, scoped),
      );
      continue;
    }

    if (!parseAliasBase(aliasFor!)) {
      addFinding(
        findings,
        "invalid-alias",
        "error",
        `Alias target "${aliasFor!.trim()}" on ${tagDisplay(scoped)} does not start with a valid tag name or Program:ProgramName.TagName path.`,
        targetTag(project, scoped),
        undefined,
        { aliasFor: aliasFor!.trim() },
      );
      continue;
    }

    const target = resolveAliasTarget(scoped, aliasFor!);
    if (!target) {
      addFinding(
        findings,
        "undefined-alias",
        "error",
        `Alias target "${aliasFor!.trim()}" on ${tagDisplay(scoped)} is not defined in the ESCO project model for controller "${controller.name}".`,
        targetTag(project, scoped),
        undefined,
        { aliasFor: aliasFor!.trim() },
      );
      continue;
    }

    if (aliasCycleIncludes(scoped, target)) {
      addFinding(
        findings,
        "alias-cycle",
        "error",
        `Alias target "${aliasFor!.trim()}" on ${tagDisplay(scoped)} creates an alias cycle.`,
        targetTag(project, scoped),
        [targetTag(project, target)],
        { aliasFor: aliasFor!.trim() },
      );
    }
  }
}

function scheduledProgramIds(controller: Controller): Set<string> {
  return new Set(controller.tasks.flatMap((task) => task.scheduledProgramIds));
}

function validateTaskTiming(
  project: PlcProject,
  controller: Controller,
  task: Task,
  findings: IndustrialValidationFinding[],
): void {
  if (task.type === "periodic" && task.periodMs == null) {
    addFinding(
      findings,
      "missing-update-rate",
      "warning",
      `Periodic task "${task.name}" has no ESCO update-rate metadata.`,
      targetTask(project, controller, task),
    );
  }

  if (task.periodMs != null && invalidPositiveInteger(task.periodMs)) {
    addFinding(
      findings,
      "invalid-update-rate",
      "error",
      `Task "${task.name}" has invalid update-rate metadata (${task.periodMs} ms). ESCO requires a positive whole number of milliseconds.`,
      targetTask(project, controller, task),
      undefined,
      { periodMs: task.periodMs },
    );
  }
}

function validateTaskSchedule(project: PlcProject, controller: Controller, findings: IndustrialValidationFinding[]): void {
  const executablePrograms = controller.programs.filter((program) => !program.useAsFolder);
  if (controller.tasks.length === 0 && executablePrograms.length > 0) {
    addFinding(
      findings,
      "missing-task-schedule",
      "warning",
      `Controller "${controller.name}" has executable programs but no imported ESCO task schedule to inspect.`,
      targetController(project, controller),
    );
  }

  const programsById = new Map(controller.programs.map((program) => [program.id, program] as const));
  for (const task of controller.tasks) {
    validateTaskTiming(project, controller, task, findings);

    if (task.scheduledProgramIds.length === 0) {
      addFinding(
        findings,
        "missing-task-schedule",
        "warning",
        `Task "${task.name}" has no scheduled programs in the ESCO project model.`,
        targetTask(project, controller, task),
      );
    }

    for (const programId of task.scheduledProgramIds) {
      const program = programsById.get(programId);
      if (!program) {
        addFinding(
          findings,
          "missing-task-schedule",
          "error",
          `Task "${task.name}" references missing scheduled program "${programId}".`,
          targetTask(project, controller, task),
          undefined,
          { scheduledProgramId: programId },
        );
      }
    }
  }

  const scheduled = scheduledProgramIds(controller);
  for (const program of executablePrograms) {
    const isScheduled = scheduled.has(program.id);
    const programTarget = targetProgram(project, controller, program);
    if (!program.mainRoutineId) {
      addFinding(
        findings,
        "missing-main-routine",
        isScheduled ? "error" : "suggestion",
        isScheduled
          ? `Scheduled program "${program.name}" has no selected main routine for ESCO to inspect.`
          : `Program "${program.name}" has no selected main routine; set one before scheduling it.`,
        programTarget,
      );
      continue;
    }

    const routine = program.routines.find((candidate) => candidate.id === program.mainRoutineId);
    if (!routine) {
      addFinding(
        findings,
        "missing-main-routine",
        isScheduled ? "error" : "warning",
        `Program "${program.name}" references missing main routine "${program.mainRoutineId}".`,
        programTarget,
        undefined,
        { mainRoutineId: program.mainRoutineId },
      );
    }
  }
}

function moduleGroupsByName(modules: IoModule[]): Map<string, IoModule[]> {
  const groups = new Map<string, IoModule[]>();
  for (const module of modules) {
    const normalized = key(module.name);
    if (!normalized) continue;
    groups.set(normalized, [...(groups.get(normalized) ?? []), module]);
  }
  return groups;
}

function parentSlotKey(module: IoModule): string | undefined {
  if (module.slot == null || invalidNonNegativeInteger(module.slot)) return undefined;
  return `${key(module.parentModule)}|${key(module.parentPortId)}|${module.slot}`;
}

function portById(module: IoModule, portId: string | undefined): IoPort | undefined {
  const normalized = key(portId);
  if (!normalized) return undefined;
  return (module.ports ?? []).find((port) => key(port.id) === normalized);
}

function parentLocation(module: IoModule): string {
  const parent = text(module.parentModule);
  const port = text(module.parentPortId);
  if (parent && port) return `parent "${parent}" port "${port}"`;
  if (parent) return `parent "${parent}"`;
  return "the controller root";
}

function validateModuleSlotsAndParents(
  project: PlcProject,
  controller: Controller,
  findings: IndustrialValidationFinding[],
): void {
  const modules = controller.ioConfiguration.modules;
  const modulesByName = moduleGroupsByName(modules);
  const slotGroups = new Map<string, IoModule[]>();

  for (const module of modules) {
    if (invalidNonNegativeInteger(module.slot)) {
      addFinding(
        findings,
        "invalid-module-slot",
        "error",
        `I/O module "${module.name}" has invalid slot metadata (${module.slot}). ESCO requires a non-negative whole number.`,
        targetModule(project, controller, module),
        undefined,
        { slot: module.slot },
      );
    }

    const slotKey = parentSlotKey(module);
    if (slotKey) slotGroups.set(slotKey, [...(slotGroups.get(slotKey) ?? []), module]);
  }

  for (const duplicates of slotGroups.values()) {
    if (duplicates.length < 2) continue;
    const slot = duplicates[0]?.slot;
    addFinding(
      findings,
      "duplicate-module-slot",
      "error",
      `I/O modules ${quotedList(duplicates.map((module) => module.name))} share slot ${slot} under ${parentLocation(duplicates[0]!)}.`,
      targetController(project, controller),
      duplicates.map((module) => targetModule(project, controller, module)),
      { slot, duplicateCount: duplicates.length },
    );
  }

  for (const module of modules) {
    const parentName = text(module.parentModule);
    const parentPortId = text(module.parentPortId);
    if (!parentName) {
      if (parentPortId) {
        addFinding(
          findings,
          "module-parent-compatibility",
          "warning",
          `I/O module "${module.name}" specifies parent port "${parentPortId}" but no parent module.`,
          targetModule(project, controller, module),
          undefined,
          { parentPortId },
        );
      }
      continue;
    }

    if (key(parentName) === key(module.name)) {
      addFinding(
        findings,
        "module-parent-compatibility",
        "error",
        `I/O module "${module.name}" cannot use itself as its parent module.`,
        targetModule(project, controller, module),
        undefined,
        { parentModule: parentName },
      );
      continue;
    }

    const parentMatches = modulesByName.get(key(parentName)) ?? [];
    if (parentMatches.length === 0) {
      addFinding(
        findings,
        "module-parent-compatibility",
        "error",
        `I/O module "${module.name}" references missing parent module "${parentName}".`,
        targetModule(project, controller, module),
        undefined,
        { parentModule: parentName },
      );
      continue;
    }

    if (parentMatches.length > 1) {
      addFinding(
        findings,
        "module-parent-compatibility",
        "warning",
        `I/O module "${module.name}" references parent module "${parentName}", but that name is duplicated in controller "${controller.name}".`,
        targetModule(project, controller, module),
        parentMatches.map((parent) => targetModule(project, controller, parent)),
        { parentModule: parentName },
      );
      continue;
    }

    const parent = parentMatches[0]!;
    if (!parentPortId) {
      if ((parent.ports ?? []).length > 1) {
        addFinding(
          findings,
          "module-parent-compatibility",
          "suggestion",
          `I/O module "${module.name}" references parent "${parentName}" without a parent port; ESCO sees multiple imported parent ports.`,
          targetModule(project, controller, module),
          [targetModule(project, controller, parent)],
          { parentModule: parentName },
        );
      }
      continue;
    }

    const parentPorts = parent.ports ?? [];
    const parentPort = portById(parent, parentPortId);
    if (parentPorts.length > 0 && !parentPort) {
      addFinding(
        findings,
        "module-parent-compatibility",
        "error",
        `I/O module "${module.name}" references missing parent port "${parentPortId}" on parent module "${parentName}".`,
        targetModule(project, controller, module),
        [targetModule(project, controller, parent)],
        { parentModule: parentName, parentPortId },
      );
      continue;
    }

    if (
      parentPort?.busSize != null &&
      module.slot != null &&
      !invalidNonNegativeInteger(module.slot) &&
      module.slot >= parentPort.busSize
    ) {
      addFinding(
        findings,
        "invalid-module-slot",
        "error",
        `I/O module "${module.name}" uses slot ${module.slot}, outside parent "${parentName}" port "${parentPortId}" bus size ${parentPort.busSize}.`,
        targetModule(project, controller, module),
        [targetModulePort(project, controller, parent, parentPort)],
        { slot: module.slot, busSize: parentPort.busSize },
      );
    }
  }
}

function moduleHasIPv4(module: IoModule): boolean {
  if (hasIPv4(module.commPath)) return true;
  return (module.ports ?? []).some((port) => hasIPv4(port.address));
}

function portLooksNetworked(port: IoPort): boolean {
  return NETWORK_HINT.test(`${port.type ?? ""} ${port.address ?? ""}`) || hasIPv4(port.address);
}

function moduleLooksNetworked(module: IoModule): boolean {
  const fields = [
    module.name,
    module.catalogNumber,
    module.description,
    module.productType,
    module.vendor,
    module.commPath,
  ].join(" ");
  return NETWORK_HINT.test(fields) || (module.ports ?? []).some(portLooksNetworked) || moduleHasIPv4(module);
}

function validateNetworkAddresses(
  project: PlcProject,
  controller: Controller,
  findings: IndustrialValidationFinding[],
): void {
  const networkTarget = targetControllerNetwork(project, controller);
  const config = controller.ethernetConfig;
  if (config) {
    const ipAttributes = config.internetProtocol?.attributes;
    const configType = attr(ipAttributes, "ConfigType")?.toLowerCase();
    const ipAddress = attr(ipAttributes, "IPAddress");
    if ((configType === "manual" || configType === "static") && !ipAddress) {
      addFinding(
        findings,
        "missing-network-address",
        "warning",
        `Controller "${controller.name}" has manual network configuration but no imported IP address.`,
        networkTarget,
        undefined,
        { configType },
      );
    }

    if (config.ports.length > 0 && !config.internetProtocol) {
      addFinding(
        findings,
        "missing-network-address",
        "suggestion",
        `Controller "${controller.name}" has imported Ethernet port metadata but no controller IP address object for ESCO to validate.`,
        networkTarget,
      );
    }

    for (const field of IP_FIELDS) {
      const value = attr(ipAttributes, field);
      if (value && !isIPv4(value)) {
        addFinding(
          findings,
          "invalid-network-address",
          "error",
          `Controller "${controller.name}" network field ${field} is not a valid IPv4 address.`,
          networkTarget,
          undefined,
          { field, value },
        );
      }
    }
  }

  for (const module of controller.ioConfiguration.modules) {
    if (moduleLooksNetworked(module) && !moduleHasIPv4(module)) {
      addFinding(
        findings,
        "missing-network-address",
        "warning",
        `I/O module "${module.name}" appears to be an Ethernet/network device but has no imported IP address for ESCO to validate.`,
        targetModule(project, controller, module),
      );
    }

    for (const port of module.ports ?? []) {
      const address = text(port.address);
      if (address && address.includes(".") && !isIPv4(address)) {
        addFinding(
          findings,
          "invalid-network-address",
          "error",
          `I/O module "${module.name}" port "${port.id ?? port.type ?? "unnamed"}" has invalid IPv4 address "${address}".`,
          targetModulePort(project, controller, module, port),
          undefined,
          { address },
        );
      }
    }
  }
}

function validateRpi(project: PlcProject, controller: Controller, findings: IndustrialValidationFinding[]): void {
  for (const module of controller.ioConfiguration.modules) {
    for (const [index, connection] of (module.connections ?? []).entries()) {
      const target = targetModuleConnection(project, controller, module, index, connection.name);
      if (connection.rpi == null) {
        addFinding(
          findings,
          "missing-rpi",
          "warning",
          `I/O module "${module.name}" connection "${connection.name ?? index + 1}" has no requested packet interval for ESCO review.`,
          target,
        );
      } else if (invalidPositiveInteger(connection.rpi)) {
        addFinding(
          findings,
          "invalid-rpi",
          "error",
          `I/O module "${module.name}" connection "${connection.name ?? index + 1}" has invalid RPI metadata (${connection.rpi} microseconds). ESCO requires a positive whole number.`,
          target,
          undefined,
          { rpiMicroseconds: connection.rpi },
        );
      }
    }
  }

  for (const scoped of allScopedTags(controller)) {
    const tag = scoped.tag;
    if (!tag.consumed && !tag.consumeInfo) continue;
    const rpi = tag.consumeInfo?.rpi;
    if (rpi == null) {
      addFinding(
        findings,
        "missing-rpi",
        "warning",
        `Consumed tag "${tag.name}" has no RPI metadata for ESCO review.`,
        targetTag(project, scoped),
      );
    } else if (invalidPositiveInteger(rpi)) {
      addFinding(
        findings,
        "invalid-rpi",
        "error",
        `Consumed tag "${tag.name}" has invalid RPI metadata (${rpi} ms). ESCO requires a positive whole number.`,
        targetTag(project, scoped),
        undefined,
        { rpiMs: rpi },
      );
    }
  }
}

function summarize(project: PlcProject, findings: IndustrialValidationFinding[]): IndustrialValidationSummary {
  const controllers = project.controllers;
  return {
    findingCount: findings.length,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    suggestionCount: findings.filter((finding) => finding.severity === "suggestion").length,
    controllerCount: controllers.length,
    tagCount: controllers.reduce(
      (sum, controller) =>
        sum +
        controller.controllerTags.length +
        controller.programs.reduce((programSum, program) => programSum + program.programTags.length, 0),
      0,
    ),
    taskCount: controllers.reduce((sum, controller) => sum + controller.tasks.length, 0),
    moduleCount: controllers.reduce((sum, controller) => sum + controller.ioConfiguration.modules.length, 0),
  };
}

export function validateIndustrialProject(project: PlcProject): IndustrialValidationReport {
  const findings: IndustrialValidationFinding[] = [];

  for (const controller of project.controllers) {
    validateDuplicateTags(project, controller, findings);
    validateAliases(project, controller, findings);
    validateTaskSchedule(project, controller, findings);
    validateModuleSlotsAndParents(project, controller, findings);
    validateNetworkAddresses(project, controller, findings);
    validateRpi(project, controller, findings);
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const suggestions = findings.filter((finding) => finding.severity === "suggestion");

  return {
    findings,
    errors,
    warnings,
    suggestions,
    summary: summarize(project, findings),
    modelLimits: MODEL_LIMITS,
  };
}

export function industrialValidationFindings(project: PlcProject): IndustrialValidationFinding[] {
  return validateIndustrialProject(project).findings;
}
