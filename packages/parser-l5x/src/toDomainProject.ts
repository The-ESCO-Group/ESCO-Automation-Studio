import {
  createContinuousTask,
  createController,
  createProject,
  type PlcProject,
  type ControllerSecurity,
  type CstInfo,
  type RedundancyInfo,
  type SafetyInfo,
  type Task,
  type TimeSyncInfo,
  type WallClockTimeInfo,
} from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { mapTaskType, resolveController } from "./extractController";
import { extractPrograms } from "./extractPrograms";
import { extractTags } from "./extractTags";
import {
  extractAddOnInstructions,
  extractCommPorts,
  extractDataTypes,
  extractEthernetConfig,
  extractModules,
  extractParameterConnections,
  extractQuickWatchLists,
  extractTrends,
} from "./extractStructure";

export interface ImportInterchangeEvidence {
  format: "L5X";
  rootElement: "RSLogix5000Content";
  offlineOnly: true;
  proprietaryBinarySupported: false;
  contentType?: string;
  targetName?: string;
  softwareRevision?: string;
  exportName?: string;
  exportDate?: string;
  containsContext?: string;
}

/** A human-/UI-readable summary of what an import produced. */
export interface ImportSummary {
  sourceFormat: "L5X";
  offlineOnly: true;
  proprietaryBinarySupported: false;
  evidence: ImportInterchangeEvidence;
  programs: number;
  routines: number;
  rungs: number;
  tags: number;
  unsupportedInstructions: string[];
  warnings: string[];
  /** Wall-clock import time in milliseconds (set by importL5X). */
  durationMs?: number;
}

export interface ImportResult {
  project: PlcProject;
  warnings: string[];
  summary: ImportSummary;
}

function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function interchangeEvidence(root: L5XNode): ImportInterchangeEvidence {
  const contentType = attr(root, "ContentType");
  const targetName = attr(root, "TargetName");
  const softwareRevision = attr(root, "SoftwareRevision");
  const exportName = attr(root, "ExportName");
  const exportDate = attr(root, "ExportDate");
  const containsContext = attr(root, "ContainsContext");

  return {
    format: "L5X",
    rootElement: "RSLogix5000Content",
    offlineOnly: true,
    proprietaryBinarySupported: false,
    ...(contentType ? { contentType } : {}),
    ...(targetName ? { targetName } : {}),
    ...(softwareRevision ? { softwareRevision } : {}),
    ...(exportName ? { exportName } : {}),
    ...(exportDate ? { exportDate } : {}),
    ...(containsContext ? { containsContext } : {}),
  };
}

function summarize(
  project: PlcProject,
  warnings: string[],
  registry: InstructionRegistry,
  root: L5XNode,
): ImportSummary {
  let routines = 0;
  let rungs = 0;
  let tags = 0;
  const unsupported = new Set<string>();

  for (const controller of project.controllers) {
    const aoiNames = new Set(controller.addOnInstructions.map((aoi) => aoi.name.toUpperCase()));
    tags += controller.controllerTags.length;
    for (const program of controller.programs) {
      tags += program.programTags.length;
      for (const routine of program.routines) {
        routines += 1;
        const ladder = asLadderRoutine(routine.ladder);
        if (!ladder) continue;
        rungs += ladder.rungs.length;
        for (const node of routineNodes(ladder)) {
          if (!registry.get(node.instructionType) && !aoiNames.has(node.instructionType.toUpperCase())) {
            unsupported.add(node.instructionType);
          }
        }
      }
    }
  }

  const programs = project.controllers.reduce((sum, c) => sum + c.programs.length, 0);
  return {
    sourceFormat: "L5X",
    offlineOnly: true,
    proprietaryBinarySupported: false,
    evidence: interchangeEvidence(root),
    programs,
    routines,
    rungs,
    tags,
    unsupportedInstructions: [...unsupported].sort(),
    warnings,
  };
}

function extractTasks(
  controllerNode: L5XNode,
  controllerId: string,
  programIdByName: Map<string, string>,
): Task[] {
  return toArray<L5XNode>(child(child(controllerNode, "Tasks"), "Task")).flatMap((taskNode) => {
    const name = attr(taskNode, "Name");
    if (!name) return [];
    const scheduled = toArray<L5XNode>(
      child(child(taskNode, "ScheduledPrograms"), "ScheduledProgram"),
    )
      .map((scheduledNode) => programIdByName.get(attr(scheduledNode, "Name") ?? ""))
      .filter((id): id is string => Boolean(id));

    const watchdog = Number(attr(taskNode, "Watchdog") ?? "");
    const priority = Number(attr(taskNode, "Priority") ?? "");
    const rate = Number(attr(taskNode, "Rate") ?? "");

    // Task <Description> is read-only display metadata; preserve it verbatim so
    // it round-trips on export (mirrors controller / program / routine / tag).
    const descriptionNode = child(taskNode, "Description");

    // EVENT tasks carry an <EventInfo> child describing what fires them. This is
    // display-only metadata (never used to schedule or talk to a controller);
    // preserve it verbatim so the trigger binding survives export -> import.
    const eventNode = child(taskNode, "EventInfo");
    let eventInfo: Task["eventInfo"];
    if (eventNode) {
      const eventTrigger = attr(eventNode, "EventTrigger");
      const eventTag = attr(eventNode, "Tag") ?? attr(eventNode, "EventTag");
      const enableTimeout = attr(eventNode, "EnableTimeout");
      const info: NonNullable<Task["eventInfo"]> = {};
      if (eventTrigger) info.eventTrigger = eventTrigger;
      if (eventTag) info.eventTag = eventTag;
      if (enableTimeout !== undefined) info.enableTimeout = enableTimeout === "true";
      if (Object.keys(info).length > 0) eventInfo = info;
    }

    return [
      {
        ...createContinuousTask(controllerId, name, scheduled),
        type: mapTaskType(attr(taskNode, "Type")),
        ...(descriptionNode ? { description: text(descriptionNode) } : {}),
        ...(Number.isFinite(watchdog) && watchdog > 0 ? { watchdogMs: watchdog } : {}),
        ...(Number.isFinite(priority) && priority > 0 ? { priority } : {}),
        ...(Number.isFinite(rate) && rate > 0 ? { periodMs: rate } : {}),
        ...(attr(taskNode, "InhibitTask") === "true" ? { inhibited: true } : {}),
        ...(attr(taskNode, "DisableUpdateOutputs") === "true" ? { disableUpdateOutputs: true } : {}),
        // Safety partition ("Safety" / "Standard") is preserved verbatim (read-only
        // metadata; never used to schedule a safety task) so it round-trips on
        // export (mirrors program / tag Class handling). Present on the dedicated
        // Safety Task of a GuardLogix project.
        ...(attr(taskNode, "Class") ? { safetyClass: attr(taskNode, "Class") } : {}),
        ...(eventInfo ? { eventInfo } : {}),
      },
    ];
  });
}

/** Read controller catalog/firmware/handler-program metadata (read-only; no controller communication). */
function applyControllerMetadata(controller: { firmwareRevision?: string; catalogNumber?: string; chassis?: string; slot?: number; faultRoutineName?: string; powerUpRoutineName?: string; timeSlice?: string; shareUnusedTimeSlice?: string; sfcExecutionControl?: string; sfcRestartPosition?: string; sfcLastScan?: string; currentProjectLanguage?: string; defaultProjectLanguage?: string; controllerLanguage?: string; passThroughConfiguration?: string; downloadProjectDocumentationAndExtendedProperties?: string; downloadProjectCustomProperties?: string; matchProjectToController?: string; projectSN?: string; inhibitAutomaticFirmwareUpdate?: string; canUseRPIFromProducer?: string; canUseRPIFromController?: string; projectCreationDate?: string; lastModifiedDate?: string; reportMinorOverflow?: string; commPath?: string; commDriver?: string; redundancyInfo?: RedundancyInfo; safetyInfo?: SafetyInfo; wallClockTime?: WallClockTimeInfo; timeSync?: TimeSyncInfo; cst?: CstInfo; security?: ControllerSecurity }, controllerNode: L5XNode): void {
  const major = attr(controllerNode, "MajorRev");
  const minor = attr(controllerNode, "MinorRev");
  if (major) controller.firmwareRevision = minor ? `${major}.${minor}` : major;
  const catalog = attr(controllerNode, "CatalogNumber") ?? attr(controllerNode, "ProcessorType");
  if (catalog) controller.catalogNumber = catalog;
  const slot = Number(attr(controllerNode, "Slot") ?? "");
  if (Number.isFinite(slot) && (attr(controllerNode, "Slot") ?? "") !== "") controller.slot = slot;
  const chassis = attr(controllerNode, "ChassisType") ?? attr(controllerNode, "Chassis");
  if (chassis) controller.chassis = chassis;
  const faultHandler = attr(controllerNode, "FaultHandler") ?? attr(controllerNode, "FaultRoutineName");
  if (faultHandler) controller.faultRoutineName = faultHandler;
  const powerUp = attr(controllerNode, "PowerLossHandler") ?? attr(controllerNode, "PowerUpHandler");
  if (powerUp) controller.powerUpRoutineName = powerUp;
  // System Overhead Time Slice scheduling metadata is preserved verbatim
  // (read-only; never used by the simulator) so it round-trips on export.
  const timeSlice = attr(controllerNode, "TimeSlice");
  if (timeSlice) controller.timeSlice = timeSlice;
  const shareUnused = attr(controllerNode, "ShareUnusedTimeSlice");
  if (shareUnused) controller.shareUnusedTimeSlice = shareUnused;
  // SFC execution-control scheduling metadata is preserved verbatim (read-only;
  // never used by the simulator) so it round-trips on export.
  const sfcExecution = attr(controllerNode, "SFCExecutionControl");
  if (sfcExecution) controller.sfcExecutionControl = sfcExecution;
  const sfcRestart = attr(controllerNode, "SFCRestartPosition");
  if (sfcRestart) controller.sfcRestartPosition = sfcRestart;
  const sfcLastScan = attr(controllerNode, "SFCLastScan");
  if (sfcLastScan) controller.sfcLastScan = sfcLastScan;
  // Project documentation language configuration is preserved verbatim
  // (read-only; never used by the simulator) so it round-trips on export.
  // Present whenever localized comments/descriptions are enabled.
  const currentLanguage = attr(controllerNode, "CurrentProjectLanguage");
  if (currentLanguage) controller.currentProjectLanguage = currentLanguage;
  const defaultLanguage = attr(controllerNode, "DefaultProjectLanguage");
  if (defaultLanguage) controller.defaultProjectLanguage = defaultLanguage;
  const controllerLanguage = attr(controllerNode, "ControllerLanguage");
  if (controllerLanguage) controller.controllerLanguage = controllerLanguage;
  // Project documentation download / pass-through configuration is preserved
  // verbatim (read-only; never used by the simulator) so it round-trips on
  // export. Present on nearly every Logix controller (mirrors the language
  // settings above).
  const passThrough = attr(controllerNode, "PassThroughConfiguration");
  if (passThrough) controller.passThroughConfiguration = passThrough;
  const downloadDocs = attr(controllerNode, "DownloadProjectDocumentationAndExtendedProperties");
  if (downloadDocs) controller.downloadProjectDocumentationAndExtendedProperties = downloadDocs;
  const downloadCustom = attr(controllerNode, "DownloadProjectCustomProperties");
  if (downloadCustom) controller.downloadProjectCustomProperties = downloadCustom;
  // Project/controller matching and firmware-update configuration is preserved
  // verbatim (read-only; never used to talk to a controller, match a serial
  // number, or update firmware) so it round-trips on export. Present on nearly
  // every Logix controller (mirrors the pass-through settings above).
  const matchProject = attr(controllerNode, "MatchProjectToController");
  if (matchProject) controller.matchProjectToController = matchProject;
  // The target controller serial number (paired with MatchProjectToController)
  // is preserved verbatim (read-only; never used to match a serial number or
  // talk to a controller) so it round-trips on export.
  const projectSN = attr(controllerNode, "ProjectSN");
  if (projectSN) controller.projectSN = projectSN;
  const inhibitFirmware = attr(controllerNode, "InhibitAutomaticFirmwareUpdate");
  if (inhibitFirmware) controller.inhibitAutomaticFirmwareUpdate = inhibitFirmware;
  // Whether a consumed tag may adopt the RPI requested by its producer is
  // preserved verbatim (read-only; never used to schedule a connection or talk
  // to a controller) so it round-trips on export. Logix has used both names in
  // controller exports/docs, so preserve either spelling if present.
  const canUseRPIFromProducer = attr(controllerNode, "CanUseRPIFromProducer");
  if (canUseRPIFromProducer) controller.canUseRPIFromProducer = canUseRPIFromProducer;
  const canUseRPIFromController = attr(controllerNode, "CanUseRPIFromController");
  if (canUseRPIFromController) controller.canUseRPIFromController = canUseRPIFromController;
  // Project documentation/audit timestamps are preserved verbatim (read-only;
  // never parsed as a date or used by the simulator) so they round-trip on
  // export. Present on nearly every Logix controller (mirrors the matching
  // settings above).
  const projectCreationDate = attr(controllerNode, "ProjectCreationDate");
  if (projectCreationDate) controller.projectCreationDate = projectCreationDate;
  const lastModifiedDate = attr(controllerNode, "LastModifiedDate");
  if (lastModifiedDate) controller.lastModifiedDate = lastModifiedDate;
  // Whether the controller reports a minor fault on arithmetic overflow is
  // preserved verbatim (read-only; never used by the simulator to decide
  // overflow handling) so it round-trips on export. Present on nearly every
  // Logix controller (mirrors the matching settings above).
  const reportMinorOverflow = attr(controllerNode, "ReportMinorOverflow");
  if (reportMinorOverflow) controller.reportMinorOverflow = reportMinorOverflow;
  // The last-used communication path/driver is preserved verbatim (read-only;
  // never used to connect to, go online with, or talk to a controller — this
  // tool is offline-only) so it round-trips on export. Present on many Logix
  // exports (mirrors the matching settings above).
  const commPath = attr(controllerNode, "CommPath");
  if (commPath) controller.commPath = commPath;
  const commDriver = attr(controllerNode, "CommDriver");
  if (commDriver) controller.commDriver = commDriver;

  // Redundancy configuration (<RedundancyInfo>) is preserved verbatim (read-only;
  // never used by the simulator or to talk to a controller) so it round-trips on
  // export. Present in nearly every ControlLogix export.
  const redundancyNode = child(controllerNode, "RedundancyInfo");
  if (redundancyNode) {
    const enabled = attr(redundancyNode, "Enabled");
    const keepTestEdits = attr(redundancyNode, "KeepTestEditsOnSwitchOver");
    const ioPad = attr(redundancyNode, "IOMemoryPadPercentage");
    const dataTablePad = attr(redundancyNode, "DataTablePadPercentage");
    const frontPortCrossloadEnabledPorts = attr(redundancyNode, "FrontPortCrossloadEnabledPorts");
    const frontPortCrossloadSecurityEnabled = attr(redundancyNode, "FrontPortCrossloadSecurityEnabled");
    const redundancyInfo: RedundancyInfo = {};
    if (enabled !== undefined) redundancyInfo.enabled = enabled === "true";
    if (keepTestEdits !== undefined) redundancyInfo.keepTestEditsOnSwitchOver = keepTestEdits === "true";
    if (ioPad) redundancyInfo.ioMemoryPadPercentage = ioPad;
    if (dataTablePad) redundancyInfo.dataTablePadPercentage = dataTablePad;
    if (frontPortCrossloadEnabledPorts !== undefined)
      redundancyInfo.frontPortCrossloadEnabledPorts = frontPortCrossloadEnabledPorts;
    if (frontPortCrossloadSecurityEnabled !== undefined)
      redundancyInfo.frontPortCrossloadSecurityEnabled = frontPortCrossloadSecurityEnabled;
    if (Object.keys(redundancyInfo).length > 0) controller.redundancyInfo = redundancyInfo;
  }

  // GuardLogix safety configuration (<SafetyInfo>) is preserved verbatim
  // (read-only; never used to verify a safety signature, enforce safety locking,
  // a safety integrity rating, or talk to a controller) so the safety settings
  // round-trip on export (mirrors <RedundancyInfo>). Present in nearly every
  // safety-controller export.
  const safetyNode = child(controllerNode, "SafetyInfo");
  if (safetyNode) {
    const safetyEnabled = attr(safetyNode, "SafetyEnabled");
    const safetyLocked = attr(safetyNode, "SafetyLocked");
    const signatureId = attr(safetyNode, "SafetySignatureID");
    const signatureTimestamp = attr(safetyNode, "SafetySignatureTimestamp");
    const signatureRunModeProtect = attr(safetyNode, "SignatureRunModeProtect");
    const configureSafetyIOAlways = attr(safetyNode, "ConfigureSafetyIOAlways");
    const safetyLevel = attr(safetyNode, "SafetyLevel");
    const safetyInfo: SafetyInfo = {};
    if (safetyEnabled !== undefined) safetyInfo.safetyEnabled = safetyEnabled;
    if (safetyLocked !== undefined) safetyInfo.safetyLocked = safetyLocked === "true";
    if (signatureId) safetyInfo.safetySignatureId = signatureId;
    if (signatureTimestamp) safetyInfo.safetySignatureTimestamp = signatureTimestamp;
    if (signatureRunModeProtect !== undefined)
      safetyInfo.signatureRunModeProtect = signatureRunModeProtect === "true";
    if (configureSafetyIOAlways !== undefined)
      safetyInfo.configureSafetyIOAlways = configureSafetyIOAlways === "true";
    if (safetyLevel) safetyInfo.safetyLevel = safetyLevel;
    // The standard<->safety tag mapping lives in a <SafetyTagMap> child element
    // (not an attribute). Preserve its text verbatim so the mapping round-trips
    // on export; never resolved or used to move data between scopes here.
    const safetyTagMap = text(child(safetyNode, "SafetyTagMap"));
    if (safetyTagMap) safetyInfo.safetyTagMap = safetyTagMap;
    if (Object.keys(safetyInfo).length > 0) controller.safetyInfo = safetyInfo;
  }

  // Wall-clock time configuration (<WallClockTime>) is preserved verbatim
  // (read-only; never used to set or read a controller's clock or talk to a
  // controller) so it round-trips on export (mirrors <RedundancyInfo>). Present
  // in nearly every Logix export.
  const wallClockNode = child(controllerNode, "WallClockTime");
  if (wallClockNode) {
    const localTimeAdjustment = attr(wallClockNode, "LocalTimeAdjustment");
    const timeZone = attr(wallClockNode, "TimeZone");
    const wallClockTime: WallClockTimeInfo = {};
    if (localTimeAdjustment !== undefined) wallClockTime.localTimeAdjustment = localTimeAdjustment;
    if (timeZone !== undefined) wallClockTime.timeZone = timeZone;
    if (Object.keys(wallClockTime).length > 0) controller.wallClockTime = wallClockTime;
  }

  // CIP Sync / IEEE 1588 time-synchronization configuration (<TimeSynchronize>)
  // is preserved verbatim (read-only; never used to synchronize a clock, elect a
  // grandmaster, or talk to a controller) so it round-trips on export (mirrors
  // <WallClockTime>). Present in nearly every Logix export.
  const timeSyncNode = child(controllerNode, "TimeSynchronize");
  if (timeSyncNode) {
    const ptpEnable = attr(timeSyncNode, "PTPEnable");
    const priority1 = attr(timeSyncNode, "Priority1");
    const priority2 = attr(timeSyncNode, "Priority2");
    const timeSync: TimeSyncInfo = {};
    if (ptpEnable !== undefined) timeSync.ptpEnable = ptpEnable === "true";
    if (priority1 !== undefined) timeSync.priority1 = priority1;
    if (priority2 !== undefined) timeSync.priority2 = priority2;
    if (Object.keys(timeSync).length > 0) controller.timeSync = timeSync;
  }

  // Coordinated System Time configuration (<CST>) is preserved verbatim
  // (read-only; never used to coordinate a system clock, elect a CST master, or
  // talk to a controller) so it round-trips on export (mirrors <TimeSynchronize>).
  // Present in nearly every ControlLogix export.
  const cstNode = child(controllerNode, "CST");
  if (cstNode) {
    const masterId = attr(cstNode, "MasterID");
    const cst: CstInfo = {};
    if (masterId !== undefined) cst.masterId = masterId;
    if (Object.keys(cst).length > 0) controller.cst = cst;
  }

  // Source-protection / change-detection configuration (<Security>) is preserved
  // verbatim (read-only; never used to enforce permissions, authenticate against
  // a security authority, or talk to a controller) so it round-trips on export
  // (mirrors <RedundancyInfo>). Present on nearly every Logix export.
  const securityNode = child(controllerNode, "Security");
  if (securityNode) {
    const code = attr(securityNode, "Code");
    const changesToDetect = attr(securityNode, "ChangesToDetect");
    const securityAuthorityId = attr(securityNode, "SecurityAuthorityID");
    const securityAuthorityName = attr(securityNode, "SecurityAuthorityName");
    const security: ControllerSecurity = {};
    if (code !== undefined) security.code = code;
    if (changesToDetect !== undefined) security.changesToDetect = changesToDetect;
    if (securityAuthorityId !== undefined) security.securityAuthorityId = securityAuthorityId;
    if (securityAuthorityName !== undefined) security.securityAuthorityName = securityAuthorityName;
    if (Object.keys(security).length > 0) controller.security = security;
  }
}

/**
 * Convert a parsed L5X root into the internal domain {@link PlcProject},
 * collecting human-readable warnings for anything imported with caveats.
 */
export function toDomainProject(root: L5XNode, registry: InstructionRegistry): ImportResult {
  const warnings: string[] = [];
  const { node: controllerNode, name: controllerName } = resolveController(root);

  const project = createProject(controllerName, "Imported from an L5X file.");
  const controller = createController(project.id, controllerName);
  controller.processorType = attr(controllerNode, "ProcessorType");
  // Controller <Description> is read-only display metadata; preserve it verbatim
  // so it round-trips on export (mirrors program / routine / tag descriptions).
  const controllerDescription = child(controllerNode, "Description");
  if (controllerDescription) controller.description = text(controllerDescription);
  // The Studio 5000 software version that produced the export lives on the root
  // <RSLogix5000Content SoftwareRevision="..."> element, not the <Controller>.
  // Preserve it verbatim (read-only provenance; never used by the simulator) so
  // it round-trips on export instead of being replaced by this tool's identity.
  const softwareRevision = attr(root, "SoftwareRevision");
  if (softwareRevision) controller.softwareRevision = softwareRevision;
  // The export owner (user / organization) likewise lives on the root element.
  // Preserve it verbatim (read-only provenance) so it round-trips on export.
  const exportOwner = attr(root, "Owner");
  if (exportOwner) controller.exportOwner = exportOwner;
  // The export-scope options (the space-separated list of data classes the file
  // contains) likewise live on the root element. Preserve them verbatim
  // (read-only provenance; never parsed or acted on) so they round-trip on
  // export (mirrors the export owner above).
  const exportOptions = attr(root, "ExportOptions");
  if (exportOptions) controller.exportOptions = exportOptions;
  // The export timestamp likewise lives on the root element. Preserve it verbatim
  // (read-only provenance; never parsed as a date or acted on) so it round-trips
  // on export instead of being overwritten with this tool's own export time
  // (mirrors the export options above).
  const exportDate = attr(root, "ExportDate");
  if (exportDate) controller.exportDate = exportDate;
  // Whether the file embeds surrounding project context likewise lives on the
  // root element. Preserve it verbatim (read-only provenance; never parsed or
  // acted on) so it round-trips on export (mirrors the export date above).
  const containsContext = attr(root, "ContainsContext");
  if (containsContext) controller.containsContext = containsContext;
  applyControllerMetadata(controller, controllerNode);

  const controllerTags = extractTags(child(controllerNode, "Tags"), controller.id, "controller");
  controller.controllerTags.push(...controllerTags.tags);
  warnings.push(...controllerTags.warnings);

  // Structural metadata (read-only): UDTs, AOI definitions, and the I/O tree.
  controller.dataTypes.push(...extractDataTypes(controllerNode));
  const extractedAois = extractAddOnInstructions(controllerNode, registry);
  controller.addOnInstructions.push(...extractedAois.aois);
  warnings.push(...extractedAois.warnings);
  controller.ioConfiguration.modules.push(...extractModules(controllerNode));
  controller.trends = extractTrends(controllerNode);
  controller.quickWatchLists = extractQuickWatchLists(controllerNode);
  const ethernetConfig = extractEthernetConfig(controllerNode);
  if (ethernetConfig) controller.ethernetConfig = ethernetConfig;
  const commPorts = extractCommPorts(controllerNode);
  if (commPorts) controller.commPorts = commPorts;
  controller.parameterConnections = extractParameterConnections(controllerNode);
  const knownInstructionTypes = new Set(extractedAois.aois.map((aoi) => aoi.name.toUpperCase()));

  const { programs, warnings: programWarnings } = extractPrograms(
    controllerNode,
    controller.id,
    registry,
    knownInstructionTypes,
  );
  controller.programs.push(...programs);
  warnings.push(...programWarnings);

  const programIdByName = new Map(programs.map((program) => [program.name, program.id]));
  const tasks = extractTasks(controllerNode, controller.id, programIdByName);
  controller.tasks.push(
    ...(tasks.length > 0
      ? tasks
      : [createContinuousTask(controller.id, "MainTask", programs.map((p) => p.id))]),
  );

  project.controllers.push(controller);
  return { project, warnings, summary: summarize(project, warnings, registry, root) };
}
