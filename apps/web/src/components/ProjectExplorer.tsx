import { Fragment, useEffect, useState, type MouseEvent } from "react";
import type { ControllerCommandKind, ControllerMode } from "@esco/controller-comm";
import { Panel } from "@esco/ui";
import { type PlcProject } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import type { Selection } from "../selection";
import {
  escoControllerCommandDisplayLabel,
  escoControllerCommandUnavailableTitle,
} from "../escoCapabilityMap";
import { escoBrandText } from "../branding";

const DATA_TYPE_GROUPS = ["User-Defined", "Strings", "Add-On-Defined", "Predefined", "Module-Defined"] as const;
type DataTypeGroup = (typeof DATA_TYPE_GROUPS)[number];
const ORGANIZER_LIST_LIMIT = 80;

interface Props {
  project: PlcProject;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onControllerProperties?: (controllerId: string) => void;
  onTaskProperties?: (taskId: string) => void;
  onNewTask?: (controllerId: string) => void;
  onImportTask?: (controllerId: string) => void;
  onDeleteTask?: (taskId: string) => void;
  onExportTask?: (taskId: string) => void;
  onMonitorTasks?: () => void;
  onToggleTaskInhibit?: (taskId: string) => void;
  onAddExistingProgram?: (taskId: string) => void;
  onVerifyController?: () => void;
  onImportController?: (controllerId: string) => void;
  onExportController?: (controllerId: string) => void;
  onProgramProperties?: (programId: string) => void;
  onNewProgram?: (controllerId: string, taskId?: string) => void;
  onImportProgram?: (controllerId: string) => void;
  onDeleteProgram?: (programId: string) => void;
  onExportProgram?: (programId: string) => void;
  onVerifyProgram?: (programId: string) => void;
  onNewRoutine?: (programId?: string) => void;
  onImportRoutine?: (programId: string) => void;
  onRoutineProperties?: (routineId: string) => void;
  onVerifyRoutine?: (routineId: string) => void;
  onCrossReferenceRoutine?: (routineId: string) => void;
  onDeleteRoutine?: (routineId: string) => void;
  onExportRoutine?: (routineId: string) => void;
  onNewTag?: (scope?: "controller" | "program", programId?: string) => void;
  /** Open the Generate Device Tags dialog (vendor-neutral device → controller tags). */
  onGenerateDeviceTags?: () => void;
  /** Open the Device Connections panel (which logic uses a device's tags). */
  onViewDeviceConnections?: () => void;
  onMonitorTags?: (scope?: "controller" | "program", programId?: string) => void;
  onImportTags?: () => void;
  onImportTagComponent?: (controllerId: string, scope: "controller" | "program", programId?: string) => void;
  onExportTags?: () => void;
  onNewAddOnInstruction?: (controllerId: string) => void;
  onImportAddOnInstruction?: (controllerId: string) => void;
  onExportAddOnInstructions?: (controllerId: string) => void;
  onExportCustomInstruction?: (aoiId: string) => void;
  onNewDataType?: (controllerId: string, group?: DataTypeGroup) => void;
  onImportDataType?: (controllerId: string, group?: DataTypeGroup) => void;
  onExportDataTypes?: (controllerId: string, group?: DataTypeGroup) => void;
  onExportDataType?: (udtId: string) => void;
  onDeleteAoi?: (controllerId: string, aoiId: string) => void;
  onDeleteUdt?: (controllerId: string, udtId: string) => void;
  onNewTrend?: (controllerId: string) => void;
  onImportTrend?: (controllerId: string) => void;
  onExportTrends?: (controllerId: string) => void;
  onTrendProperties?: (controllerId: string, trendId: string) => void;
  onExportTrend?: (controllerId: string, trendId: string) => void;
  onDeleteTrend?: (controllerId: string, trendId: string) => void;
  onNewIoModule?: (controllerId: string, initialQuery?: string) => void;
  onIoModuleProperties?: (controllerId: string, moduleId: string) => void;
  onIoModuleDiagnostics?: (controllerId: string, moduleId: string) => void;
  onChangeIoModule?: (controllerId: string, moduleId: string) => void;
  onToggleIoModuleInhibit?: (controllerId: string, moduleId: string) => void;
  onDeleteIoModule?: (controllerId: string, moduleId: string) => void;
  onImportIoProfilePack?: (controllerId: string) => void;
  onExportIoProfilePack?: (controllerId: string) => void;
  onExportDeviceTree?: (controllerId: string) => void;
  onExportDeviceDefinition?: (controllerId: string, moduleId: string) => void;
  onControllerAction?: (action: ControllerCommandKind) => void;
  onVirtualSelectPath?: () => void;
  onVirtualGoOnline?: () => void;
  onVirtualMonitor?: () => void;
  onVirtualDownload?: () => void;
  onVirtualUpload?: () => void;
  onVirtualGoOffline?: () => void;
  onVirtualSetMode?: (mode: ControllerMode) => void;
  onVirtualClearFaults?: () => void;
  onSoftControllerDownloadRuntime?: () => void;
  onOpenSoftControllerUpload?: () => void;
  empty?: boolean;
}

type ControllerModel = PlcProject["controllers"][number];
type TaskModel = ControllerModel["tasks"][number];
type ProgramModel = ControllerModel["programs"][number];
type IoModuleModel = ControllerModel["ioConfiguration"]["modules"][number];
type AoiModel = ControllerModel["addOnInstructions"][number];
type UdtModel = ControllerModel["dataTypes"][number];
type TrendModel = NonNullable<ControllerModel["trends"]>[number];
type ExplorerContextMenu =
  | { kind: "controller"; x: number; y: number; controller: ControllerModel }
  | { kind: "tags"; x: number; y: number; controller: ControllerModel }
  | { kind: "program-tags"; x: number; y: number; controller: ControllerModel; program: ProgramModel }
  | { kind: "tasks-root"; x: number; y: number; controller: ControllerModel }
  | { kind: "task"; x: number; y: number; task: TaskModel }
  | { kind: "program"; x: number; y: number; program: ProgramModel }
  | { kind: "routine"; x: number; y: number; routine: ProgramModel["routines"][number] }
  | { kind: "aoi-root"; x: number; y: number; controller: ControllerModel }
  | { kind: "aoi"; x: number; y: number; controller: ControllerModel; aoi: AoiModel }
  | { kind: "data-types-root"; x: number; y: number; controller: ControllerModel }
  | { kind: "data-type-group"; x: number; y: number; controller: ControllerModel; group: DataTypeGroup }
  | { kind: "udt"; x: number; y: number; controller: ControllerModel; udt: UdtModel }
  | { kind: "trends-root"; x: number; y: number; controller: ControllerModel }
  | { kind: "trend"; x: number; y: number; controller: ControllerModel; trend: TrendModel }
  | { kind: "io-root"; x: number; y: number; controller: ControllerModel }
  | { kind: "io-module"; x: number; y: number; controller: ControllerModel; module: IoModuleModel };

function programsForTask(controller: ControllerModel, task: TaskModel): ProgramModel[] {
  const scheduled = task.scheduledProgramIds
    .map((id) => controller.programs.find((program) => program.id === id))
    .filter((program): program is ProgramModel => Boolean(program));
  if (scheduled.length) return scheduled;
  return controller.tasks.length === 1 ? controller.programs : [];
}

function unscheduledProgramsForController(controller: ControllerModel): ProgramModel[] {
  const scheduledIds = new Set(controller.tasks.flatMap((task) => task.scheduledProgramIds));
  if (!controller.tasks.length) return controller.programs;
  if (!scheduledIds.size) return [];
  return controller.programs.filter((program) => !scheduledIds.has(program.id));
}

function sortedModules(controller: ControllerModel): IoModuleModel[] {
  return controller.ioConfiguration.modules
    .filter((module) => !isBuiltInBackplaneModule(module, controller) && !isProcessorModule(module, controller))
    .sort((left, right) => (left.slot ?? 9999) - (right.slot ?? 9999));
}

function isBackplaneModule(module: IoModuleModel): boolean {
  return /1756-A|backplane|chassis/i.test(`${module.name} ${module.catalogNumber ?? ""} ${module.productType ?? ""}`);
}

function isBuiltInBackplaneModule(module: IoModuleModel, controller: ControllerModel): boolean {
  return module.id === `${controller.id}-chassis` || module.name === "1756 Backplane";
}

function isProcessorModule(module: IoModuleModel, controller: ControllerModel): boolean {
  const catalog = module.catalogNumber ?? "";
  const text = escoBrandText(`${module.name} ${catalog} ${module.productType ?? ""}`);
  return module.slot === (controller.slot ?? 0) && /processor|controller|557|558|L7|L8/i.test(text);
}

function backplaneLabel(controller: ControllerModel): string {
  const chassis = controller.ioConfiguration.modules.find((module) => isBackplaneModule(module));
  return chassis?.catalogNumber
    ? `1756 Backplane, ${chassis.catalogNumber}`
    : `1756 Backplane${controller.chassis ? `, ${controller.chassis}` : ""}`;
}

function moduleSlotLabel(module: IoModuleModel, controller: ControllerModel): string {
  const slot = module.slot != null ? `Slot ${module.slot}` : "Slot --";
  const catalog = escoBrandText(module.catalogNumber ?? module.productType ?? "Generic Module");
  const name = module.name.trim();
  const nameSuffix = name && name.toLowerCase() !== catalog.toLowerCase() ? ` - ${name}` : "";
  return `${slot}: ${catalog}${nameSuffix}${isProcessorModule(module, controller) ? " Processor" : ""}`;
}

function fallbackProcessorSlotLabel(controller: ControllerModel): string {
  const slot = controller.slot ?? 0;
  const processor = escoBrandText(controller.catalogNumber ?? controller.processorType ?? "ESCO5571");
  return `Slot ${slot}: ${processor}${/processor/i.test(processor) ? "" : " Processor"}`;
}

export function ProjectExplorer({
  project,
  selection,
  onSelect,
  onControllerProperties,
  onTaskProperties,
  onNewTask,
  onImportTask,
  onDeleteTask,
  onExportTask,
  onMonitorTasks,
  onToggleTaskInhibit,
  onAddExistingProgram,
  onVerifyController,
  onImportController,
  onExportController,
  onProgramProperties,
  onNewProgram,
  onImportProgram,
  onDeleteProgram,
  onExportProgram,
  onVerifyProgram,
  onNewRoutine,
  onImportRoutine,
  onRoutineProperties,
  onVerifyRoutine,
  onCrossReferenceRoutine,
  onDeleteRoutine,
  onExportRoutine,
  onNewTag,
  onGenerateDeviceTags,
  onViewDeviceConnections,
  onMonitorTags,
  onImportTags,
  onImportTagComponent,
  onExportTags,
  onNewAddOnInstruction,
  onImportAddOnInstruction,
  onExportAddOnInstructions,
  onExportCustomInstruction,
  onNewDataType,
  onImportDataType,
  onExportDataTypes,
  onExportDataType,
  onDeleteAoi,
  onDeleteUdt,
  onNewTrend,
  onImportTrend,
  onExportTrends,
  onTrendProperties,
  onExportTrend,
  onDeleteTrend,
  onNewIoModule,
  onIoModuleProperties,
  onIoModuleDiagnostics,
  onChangeIoModule,
  onToggleIoModuleInhibit,
  onDeleteIoModule,
  onImportIoProfilePack,
  onExportIoProfilePack,
  onExportDeviceTree,
  onExportDeviceDefinition,
  onControllerAction,
  onVirtualSelectPath,
  onVirtualGoOnline,
  onVirtualMonitor,
  onVirtualDownload,
  onVirtualUpload,
  onVirtualGoOffline,
  onVirtualSetMode,
  onVirtualClearFaults,
  onSoftControllerDownloadRuntime,
  onOpenSoftControllerUpload,
  empty = false,
}: Props) {
  const [tab, setTab] = useState<"controllers" | "hmi" | "assets" | "library">("controllers");
  const [filter, setFilter] = useState("");
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [panelPinned, setPanelPinned] = useState(true);
  const [panelHidden, setPanelHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenu | null>(null);
  const filterText = filter.trim().toLowerCase();
  const matchesFilter = (value: string) => !filterText || value.toLowerCase().includes(filterText);
  const isSelected = (kind: string, id: string) =>
    !!selection && selection.kind === kind && "id" in selection && selection.id === id;
  const controller = project.controllers[0];
  const hmi = getHmiProject(project);
  const projectNavCounts = {
    programs: project.controllers.reduce((sum, candidate) => sum + candidate.programs.length, 0),
    routines: project.controllers.reduce(
      (sum, candidate) => sum + candidate.programs.reduce((programSum, program) => programSum + program.routines.length, 0),
      0,
    ),
    modules: project.controllers.reduce((sum, candidate) => sum + candidate.ioConfiguration.modules.length, 0),
  };
  const largeOrganizer =
    projectNavCounts.programs >= 100 || projectNavCounts.routines >= 500 || projectNavCounts.modules >= 50;
  const modulesByController = new Map(
    project.controllers.map((candidate) => [candidate.id, sortedModules(candidate)]),
  );
  const capped = <T,>(items: T[]) => {
    const limit = filterText ? ORGANIZER_LIST_LIMIT * 2 : ORGANIZER_LIST_LIMIT;
    return {
      rows: items.slice(0, limit),
      hiddenCount: Math.max(0, items.length - limit),
      total: items.length,
    };
  };
  const hiddenRow = (hiddenCount: number, label: string) =>
    hiddenCount ? (
      <li>
        <span className="esco-tree__leaf esco-tree__leaf--muted">
          Showing first {filterText ? ORGANIZER_LIST_LIMIT * 2 : ORGANIZER_LIST_LIMIT} of {hiddenCount + (filterText ? ORGANIZER_LIST_LIMIT * 2 : ORGANIZER_LIST_LIMIT)} {label}
        </span>
      </li>
    ) : null;
  const programMatches = (program: ProgramModel) =>
    matchesFilter(program.name) ||
    program.routines.some((routine) => matchesFilter(routine.name)) ||
    program.programTags.some((tag) => matchesFilter(tag.name));
  const openContextMenu = (event: MouseEvent<HTMLElement>, menu: ExplorerContextMenu) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(menu);
  };
  const closeContextMenu = () => setContextMenu(null);
  const switchOrganizerTab = (next: typeof tab) => {
    setTab(next);
    setPanelHidden(false);
    setPanelMenuOpen(false);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!panelMenuOpen) return;
    const close = () => setPanelMenuOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [panelMenuOpen]);

  const runContextCommand = (action: () => void) => {
    action();
    closeContextMenu();
  };

  const runPanelMenuCommand = (action: () => void) => {
    action();
    setPanelMenuOpen(false);
  };

  const resetOrganizerView = () => {
    setTab("controllers");
    setPanelPinned(true);
    setPanelHidden(false);
  };

  const renderProgramNode = (controller: ControllerModel, program: ProgramModel) => {
    const routines = capped(program.routines.filter((routine) => matchesFilter(routine.name)));
    return (
      <li key={program.id}>
        <button
          type="button"
          className={`esco-tree__node${isSelected("program", program.id) ? " is-selected" : ""}`}
          onClick={() => onSelect({ kind: "program", id: program.id })}
          onContextMenu={(event) => {
            onSelect({ kind: "program", id: program.id });
            openContextMenu(event, { kind: "program", x: event.clientX, y: event.clientY, program });
          }}
        >
          <span className="esco-tree__twisty" aria-hidden="true">▾</span>
          <span className="esco-tree__icon esco-tree__icon--program" aria-hidden="true" />
          {program.name}
          {program.testEdits ? (
            <span className="esco-tree__edit-marker" title="Pending test edits" aria-label="Pending test edits">e</span>
          ) : null}
        </button>
        <ul className="esco-tree esco-tree--nested">
          <li>
            <button
              type="button"
              className="esco-tree__group esco-tree__group--button"
              onClick={() => onSelect({ kind: "tag", id: program.programTags[0]?.id ?? `${program.id}:program-tags` })}
              onContextMenu={(event) => {
                onSelect({ kind: "tag", id: program.programTags[0]?.id ?? `${program.id}:program-tags` });
                openContextMenu(event, { kind: "program-tags", x: event.clientX, y: event.clientY, controller, program });
              }}
            >
              <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
              Parameters and Local Tags
            </button>
          </li>
          {routines.rows.map((routine) => (
            <li key={routine.id}>
              <button
                type="button"
                className={`esco-tree__node esco-tree__node--routine${
                  isSelected("routine", routine.id) ? " is-selected" : ""
                }`}
                onClick={() => onSelect({ kind: "routine", id: routine.id })}
                onContextMenu={(event) => {
                  onSelect({ kind: "routine", id: routine.id });
                  openContextMenu(event, { kind: "routine", x: event.clientX, y: event.clientY, routine });
                }}
              >
                <span className="esco-tree__icon esco-tree__icon--routine" aria-hidden="true" />
                {routine.name}
              </button>
            </li>
          ))}
          {hiddenRow(routines.hiddenCount, "routines")}
        </ul>
      </li>
    );
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;

    const item = (label: string, action?: () => void, shortcut?: string, title?: string) => (
      <button
        key={label}
        type="button"
        className="esco-context-menu__item"
        role="menuitem"
        title={title ?? label}
        disabled={!action}
        onClick={action ? () => runContextCommand(action) : undefined}
      >
        <span className="esco-context-menu__icon" aria-hidden="true" />
        {label}
        {shortcut ? <span className="esco-context-menu__shortcut" aria-hidden="true">{shortcut}</span> : null}
      </button>
    );
    const hardwareItem = (kind: ControllerCommandKind, label: string) =>
      item(
        escoControllerCommandDisplayLabel(kind, label),
        onControllerAction ? () => onControllerAction(kind) : undefined,
        undefined,
        escoControllerCommandUnavailableTitle(kind),
      );
    const separator = (key: string) => <div key={key} className="esco-context-menu__sep" role="separator" />;

    const title =
      contextMenu.kind === "controller"
        ? contextMenu.controller.name
        : contextMenu.kind === "tags"
          ? "Controller Tags"
          : contextMenu.kind === "program-tags"
            ? `${contextMenu.program.name} Tags`
            : contextMenu.kind === "tasks-root"
              ? "Tasks"
              : contextMenu.kind === "task"
                ? contextMenu.task.name
                : contextMenu.kind === "program"
                  ? contextMenu.program.name
                  : contextMenu.kind === "routine"
                    ? contextMenu.routine.name
                    : contextMenu.kind === "aoi-root"
                      ? "Add-On Instructions"
                      : contextMenu.kind === "aoi"
                        ? contextMenu.aoi.name
                        : contextMenu.kind === "data-types-root"
                          ? "Data Types"
                          : contextMenu.kind === "data-type-group"
                            ? contextMenu.group
                            : contextMenu.kind === "udt"
                              ? contextMenu.udt.name
                              : contextMenu.kind === "trends-root"
                                ? "Trends"
                                : contextMenu.kind === "trend"
                                  ? contextMenu.trend.name
                                  : contextMenu.kind === "io-root"
                                    ? "I/O Configuration"
                                    : moduleSlotLabel(contextMenu.module, contextMenu.controller);

    const commands =
      contextMenu.kind === "controller"
        ? [
            item("Controller Properties...", () => {
              if (onControllerProperties) onControllerProperties(contextMenu.controller.id);
              else onSelect({ kind: "controller", id: contextMenu.controller.id });
            }),
            item("Controller Tags", () => onSelect({ kind: "tag", id: contextMenu.controller.controllerTags[0]?.id ?? `${contextMenu.controller.id}:controller-tags` })),
            separator("controller-a"),
            item("New Tag...", () => onNewTag?.("controller")),
            item("Generate Device Tags...", () => onGenerateDeviceTags?.()),
            item("Device Connections...", () => onViewDeviceConnections?.()),
            item("New Task...", () => onNewTask?.(contextMenu.controller.id)),
            item("New Program...", () => onNewProgram?.(contextMenu.controller.id)),
            item("Import Program...", () => onImportProgram?.(contextMenu.controller.id)),
            item("New Routine...", () => onNewRoutine?.(contextMenu.controller.programs[0]?.id)),
            separator("controller-b"),
            item("Verify Controller", () => onVerifyController?.()),
            item("Task Monitor", () => onMonitorTasks?.()),
            item("Import Controller...", () => onImportController?.(contextMenu.controller.id)),
            item("Export Controller...", () => onExportController?.(contextMenu.controller.id)),
            separator("controller-c"),
            hardwareItem("go-online", "Go Online"),
            hardwareItem("upload", "Upload..."),
            hardwareItem("download", "Download..."),
            hardwareItem("select-recent-path", "Set Path..."),
            hardwareItem("network-browser", "Controller Route Browser..."),
            separator("controller-d"),
            item("Select Virtual Path...", onVirtualSelectPath),
            item("Go Online (Virtual)", onVirtualGoOnline),
            item("Monitor (Virtual)", onVirtualMonitor),
            item("Download to ESCO Virtual Controller", onVirtualDownload),
            item("Upload from ESCO Virtual Controller", onVirtualUpload),
            item("Program Mode (Virtual)", () => onVirtualSetMode?.("program")),
            item("Run Mode (Virtual)", () => onVirtualSetMode?.("run")),
            item("Clear Faults (Virtual)", onVirtualClearFaults),
            item("Go Offline (Virtual)", onVirtualGoOffline),
            separator("controller-e"),
            item("Download Runtime to ESCO SoftController", onSoftControllerDownloadRuntime),
            item("Open ESCO SoftController Upload...", onOpenSoftControllerUpload),
          ]
        : contextMenu.kind === "tags"
          ? [
              item("Open", () => onSelect({ kind: "tag", id: contextMenu.controller.controllerTags[0]?.id ?? `${contextMenu.controller.id}:controller-tags` })),
              item("New Tag...", () => onNewTag?.("controller")),
              item("Generate Device Tags...", () => onGenerateDeviceTags?.()),
              item("Device Connections...", () => onViewDeviceConnections?.()),
              item("Edit Tags", () => onSelect({ kind: "tag", id: contextMenu.controller.controllerTags[0]?.id ?? `${contextMenu.controller.id}:controller-tags` })),
              item("Monitor Tags", () => onMonitorTags?.("controller")),
              separator("tags-a"),
              item("Import Tags...", () => onImportTags?.()),
              item("Import Tag Component...", () => onImportTagComponent?.(contextMenu.controller.id, "controller")),
              item("Export Tags...", () => onExportTags?.()),
            ]
          : contextMenu.kind === "program-tags"
            ? [
                item("Open", () => onSelect({ kind: "tag", id: contextMenu.program.programTags[0]?.id ?? `${contextMenu.program.id}:program-tags` })),
                item("New Tag...", () => onNewTag?.("program", contextMenu.program.id)),
                item("Edit Tags", () => onSelect({ kind: "tag", id: contextMenu.program.programTags[0]?.id ?? `${contextMenu.program.id}:program-tags` })),
                item("Monitor Tags", () => onMonitorTags?.("program", contextMenu.program.id)),
                separator("program-tags-a"),
                item("Import Tag Component...", () => onImportTagComponent?.(contextMenu.controller.id, "program", contextMenu.program.id)),
              ]
            : contextMenu.kind === "tasks-root"
            ? [
                item("New Task...", () => onNewTask?.(contextMenu.controller.id)),
                separator("tasks-a"),
                item("Import Task...", () => onImportTask?.(contextMenu.controller.id)),
                item("Monitor Tasks", () => onMonitorTasks?.()),
              ]
            : contextMenu.kind === "task"
              ? [
                item("Rename...", () => onTaskProperties?.(contextMenu.task.id)),
                item("Properties...", () => onTaskProperties?.(contextMenu.task.id)),
                item("Add > New Program...", () => onNewProgram?.(contextMenu.task.controllerId, contextMenu.task.id)),
                item("Add > Existing Program...", () => onAddExistingProgram?.(contextMenu.task.id)),
                separator("task-a"),
                item("Monitor Task", () => onMonitorTasks?.()),
                item("Export Task...", () => onExportTask?.(contextMenu.task.id)),
                separator("task-b"),
                item(contextMenu.task.inhibited ? "Uninhibit Task" : "Inhibit Task", () => onToggleTaskInhibit?.(contextMenu.task.id)),
                item("Delete", () => onDeleteTask?.(contextMenu.task.id), "Del"),
              ]
            : contextMenu.kind === "program"
              ? [
                  item("Rename...", () => onProgramProperties?.(contextMenu.program.id)),
                  item("Properties...", () => onProgramProperties?.(contextMenu.program.id)),
                  item("New Tag / Parameters and Local Tags...", () => onNewTag?.("program", contextMenu.program.id)),
                  item("Add > New Routine...", () => onNewRoutine?.(contextMenu.program.id)),
                  item("Import Routine...", () => onImportRoutine?.(contextMenu.program.id)),
                  separator("program-a"),
                  item("Verify Program", () => onVerifyProgram?.(contextMenu.program.id)),
                  item("Export Program...", () => onExportProgram?.(contextMenu.program.id)),
                  separator("program-b"),
                  item("Delete", () => onDeleteProgram?.(contextMenu.program.id), "Del"),
                ]
              : contextMenu.kind === "routine"
                ? [
                    item("Open", () => onSelect({ kind: "routine", id: contextMenu.routine.id }), "Enter"),
                    separator("routine-a"),
                    item("Rename...", () => onRoutineProperties?.(contextMenu.routine.id)),
                    item("Routine Properties...", () => onRoutineProperties?.(contextMenu.routine.id)),
                    item("Verify Routine", () => onVerifyRoutine?.(contextMenu.routine.id)),
                    item("Cross Reference", () => onCrossReferenceRoutine?.(contextMenu.routine.id)),
                    separator("routine-b"),
                    item("Export Routine...", () => onExportRoutine?.(contextMenu.routine.id)),
                    separator("routine-c"),
                    item("Delete", () => onDeleteRoutine?.(contextMenu.routine.id), "Del"),
                  ]
                : contextMenu.kind === "aoi-root"
                  ? [
                      item("New Add-On Instruction...", () => onNewAddOnInstruction?.(contextMenu.controller.id)),
                      separator("aoi-root-a"),
                      item("Import Add-On Instruction...", () => onImportAddOnInstruction?.(contextMenu.controller.id)),
                      item("Export Add-On Instructions...", () => onExportAddOnInstructions?.(contextMenu.controller.id)),
                    ]
                : contextMenu.kind === "aoi"
                  ? [
                      item("Open Definition", () => onSelect({ kind: "aoi", id: contextMenu.aoi.id }), "Enter"),
                      item("Properties...", () => onSelect({ kind: "aoi", id: contextMenu.aoi.id })),
                      item("Signature / Source Protection...", () => onSelect({ kind: "aoi", id: contextMenu.aoi.id })),
                      item("Review Calls", () => onSelect({ kind: "aoi", id: contextMenu.aoi.id })),
                      separator("aoi-a"),
                      item("Export Custom Instruction...", () => onExportCustomInstruction?.(contextMenu.aoi.id)),
                      separator("aoi-b"),
                      item("Delete", () => onDeleteAoi?.(contextMenu.controller.id, contextMenu.aoi.id), "Del"),
                    ]
                  : contextMenu.kind === "data-types-root"
                    ? [
                        item("New Data Type...", () => onNewDataType?.(contextMenu.controller.id)),
                        separator("data-types-a"),
                        item("Import Data Type...", () => onImportDataType?.(contextMenu.controller.id)),
                        item("Export Data Types...", () => onExportDataTypes?.(contextMenu.controller.id)),
                      ]
                  : contextMenu.kind === "data-type-group"
                    ? [
                        item(`New ${contextMenu.group} Data Type...`, () => onNewDataType?.(contextMenu.controller.id, contextMenu.group)),
                        separator("data-type-group-a"),
                        item(`Import ${contextMenu.group} Data Type...`, () => onImportDataType?.(contextMenu.controller.id, contextMenu.group)),
                        item(`Export ${contextMenu.group} Data Types...`, () => onExportDataTypes?.(contextMenu.controller.id, contextMenu.group)),
                      ]
                  : contextMenu.kind === "udt"
                    ? [
                        item("Open Definition", () => onSelect({ kind: "udt", id: contextMenu.udt.id }), "Enter"),
                        item("Properties...", () => onSelect({ kind: "udt", id: contextMenu.udt.id })),
                        item("Review Tags Using Type", () => onSelect({ kind: "udt", id: contextMenu.udt.id })),
                        separator("udt-a"),
                        item("Export Data Type...", () => onExportDataType?.(contextMenu.udt.id)),
                        separator("udt-b"),
                        item("Delete", () => onDeleteUdt?.(contextMenu.controller.id, contextMenu.udt.id), "Del"),
                      ]
                    : contextMenu.kind === "trends-root"
                      ? [
                          item("New Trend...", () => onNewTrend?.(contextMenu.controller.id)),
                          separator("trends-a"),
                          item("Import Trend...", () => onImportTrend?.(contextMenu.controller.id)),
                          item("Export Trends...", () => onExportTrends?.(contextMenu.controller.id)),
                        ]
                    : contextMenu.kind === "trend"
                      ? [
                          item("Open", () => onSelect({ kind: "trend", id: contextMenu.trend.id }), "Enter"),
                          item("Trend Properties...", () => onTrendProperties?.(contextMenu.controller.id, contextMenu.trend.id)),
                          separator("trend-a"),
                          item("Export Trend...", () => onExportTrend?.(contextMenu.controller.id, contextMenu.trend.id)),
                          separator("trend-b"),
                          item("Delete", () => onDeleteTrend?.(contextMenu.controller.id, contextMenu.trend.id), "Del"),
                        ]
                    : contextMenu.kind === "io-root"
                      ? [
                          item("Open", () => onSelect({ kind: "io", controllerId: contextMenu.controller.id })),
                          item("New Module...", () => onNewIoModule?.(contextMenu.controller.id)),
                          item("Properties...", () => onSelect({ kind: "io", controllerId: contextMenu.controller.id })),
                          item("Add 1756 Backplane...", () => onNewIoModule?.(contextMenu.controller.id, "Chassis")),
                          separator("io-a"),
                          item("Import I/O Profile Pack...", () => onImportIoProfilePack?.(contextMenu.controller.id)),
                          item("Export I/O Profile Pack...", () => onExportIoProfilePack?.(contextMenu.controller.id)),
                          item("Export Device Tree...", () => onExportDeviceTree?.(contextMenu.controller.id)),
                          separator("io-b"),
                          hardwareItem("network-browser", "Controller Route Browser..."),
                          item("Select Virtual Path...", onVirtualSelectPath),
                        ]
                        : [
                          item("Properties...", () => onIoModuleProperties?.(contextMenu.controller.id, contextMenu.module.id)),
                          item("Configure Module...", () => onIoModuleProperties?.(contextMenu.controller.id, contextMenu.module.id)),
                          item("Diagnostics / Fault Info", () => onIoModuleDiagnostics?.(contextMenu.controller.id, contextMenu.module.id)),
                          item("Change Module...", () => onChangeIoModule?.(contextMenu.controller.id, contextMenu.module.id)),
                          separator("module-a"),
                          item("Export Device Definition...", () =>
                            onExportDeviceDefinition?.(contextMenu.controller.id, contextMenu.module.id),
                          ),
                          separator("module-b"),
                          item(contextMenu.module.inhibited ? "Uninhibit Module" : "Inhibit Module", () =>
                            onToggleIoModuleInhibit?.(contextMenu.controller.id, contextMenu.module.id),
                          ),
                          item("Delete", () => onDeleteIoModule?.(contextMenu.controller.id, contextMenu.module.id), "Del"),
                        ];

    return (
      <div
        className="esco-context-menu esco-context-menu--organizer"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        role="menu"
        aria-label={`${title} context menu`}
        onClick={(event) => event.stopPropagation()}
      >
        {commands}
      </div>
    );
  };

  return (
    <Panel
      title="Controller Organizer"
      className={`esco-controller-organizer${panelPinned ? " is-pinned" : " is-unpinned"}`}
      actions={
        <>
          <button
            type="button"
            className="esco-panel__drop-btn"
            title="Controller Organizer menu"
            aria-label="Controller Organizer menu"
            aria-expanded={panelMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setPanelMenuOpen((open) => !open);
            }}
          />
          <button
            type="button"
            title={panelPinned ? "Unpin Controller Organizer" : "Pin Controller Organizer"}
            aria-label="Pin Controller Organizer"
            aria-pressed={panelPinned}
            onClick={(event) => {
              event.stopPropagation();
              setPanelPinned((pinned) => !pinned);
            }}
          >
            <span className="esco-panel__pin-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="esco-panel__close-btn"
            title="Close Controller Organizer"
            aria-label="Close Controller Organizer"
            onClick={(event) => {
              event.stopPropagation();
              setPanelHidden(true);
              setPanelMenuOpen(false);
            }}
          />
        </>
      }
    >
      {!panelHidden && !empty ? (
        <div className="esco-organizer-filter">
          <input
            className="esco-organizer-filter__input"
            type="search"
            aria-label="Filter Controller Organizer"
            value={filter}
            placeholder="Filter organizer"
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="esco-organizer-filter__meta">
            {projectNavCounts.programs} programs · {projectNavCounts.routines} routines · {projectNavCounts.modules} modules
          </span>
        </div>
      ) : null}
      {!panelHidden && !empty && largeOrganizer ? (
        <div className="esco-organizer-filter__note">
          Large project: organizer branches are capped before filtering.
        </div>
      ) : null}
      {panelMenuOpen && !panelHidden ? (
        <div
          className="esco-context-menu esco-context-menu--organizer esco-context-menu--inline"
          role="menu"
          aria-label="Controller Organizer menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="esco-context-menu__item" role="menuitem" onClick={() => switchOrganizerTab("controllers")}>
            <span className="esco-context-menu__icon" aria-hidden="true" />
            Controller Tree
          </button>
          <button type="button" className="esco-context-menu__item" role="menuitem" onClick={() => switchOrganizerTab("hmi")}>
            <span className="esco-context-menu__icon" aria-hidden="true" />
            HMI Project
          </button>
          <button type="button" className="esco-context-menu__item" role="menuitem" onClick={() => switchOrganizerTab("assets")}>
            <span className="esco-context-menu__icon" aria-hidden="true" />
            Assets
          </button>
          <button type="button" className="esco-context-menu__item" role="menuitem" onClick={() => switchOrganizerTab("library")}>
            <span className="esco-context-menu__icon" aria-hidden="true" />
            Instruction Library
          </button>
          <div className="esco-context-menu__sep" role="separator" />
          <button
            type="button"
            className="esco-context-menu__item"
            role="menuitemcheckbox"
            aria-checked={panelPinned}
            onClick={() => runPanelMenuCommand(() => setPanelPinned((pinned) => !pinned))}
          >
            <span className="esco-context-menu__icon" aria-hidden="true">{panelPinned ? "✓" : ""}</span>
            Pin Organizer
          </button>
          <button
            type="button"
            className="esco-context-menu__item"
            role="menuitem"
            onClick={() => runPanelMenuCommand(() => setPanelHidden(true))}
          >
            <span className="esco-context-menu__icon" aria-hidden="true" />
            Hide Organizer
          </button>
          <button
            type="button"
            className="esco-context-menu__item"
            role="menuitem"
            onClick={() => runPanelMenuCommand(resetOrganizerView)}
          >
            <span className="esco-context-menu__icon" aria-hidden="true" />
            Reset Organizer View
          </button>
        </div>
      ) : null}
      {panelHidden ? (
        <div className="esco-tree esco-tree--empty">
          <p className="esco-empty">Controller Organizer is hidden.</p>
          <button type="button" className="esco-btn" onClick={() => runPanelMenuCommand(() => setPanelHidden(false))}>
            Show Controller Organizer
          </button>
        </div>
      ) : empty ? (
        <ul className="esco-tree esco-tree--empty">
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Controllers</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No controllers added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Programs</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No programs added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Tasks</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>No tasks added</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>I/O</span>
            <ul className="esco-tree esco-tree--nested">
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>Local</span></li>
              <li><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>Remote</span></li>
              <li><span className="esco-tree__leaf esco-tree__leaf--muted">No I/O configured</span></li>
            </ul>
          </li>
          <li>
            <span className="esco-tree__group"><span className="esco-tree__icon">▾</span>Assets</span>
            <ul className="esco-tree esco-tree--nested">
              {["Libraries", "Data Types", "User-Defined", "Trends"].map((label) => (
                <li key={label}><span className="esco-tree__leaf"><span className="esco-tree__icon">□</span>{label}</span></li>
              ))}
              <li><span className="esco-tree__leaf esco-tree__leaf--muted">No assets added</span></li>
            </ul>
          </li>
        </ul>
      ) : (
      <>
      {tab === "controllers" ? (
        <ul className="esco-tree">
          {project.controllers.map((controller) => (
            <Fragment key={controller.id}>
            <li>
              <button
                type="button"
                className={`esco-tree__root esco-tree__root--button esco-tree__node--controller${
                  isSelected("controller", controller.id) ? " is-selected" : ""
                }`}
                onClick={() => onSelect({ kind: "controller", id: controller.id })}
                onContextMenu={(event) => {
                  onSelect({ kind: "controller", id: controller.id });
                  openContextMenu(event, { kind: "controller", x: event.clientX, y: event.clientY, controller });
                }}
              >
                <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                <span className="esco-tree__icon esco-tree__icon--controller" aria-hidden="true" />
                {controller.name}
              </button>
              <ul className="esco-tree esco-tree--nested">
                <li>
                  <button
                    type="button"
                    className="esco-tree__group esco-tree__group--button"
                    onClick={() => onSelect({ kind: "tag", id: controller.controllerTags[0]?.id ?? `${controller.id}:controller-tags` })}
                    onContextMenu={(event) => {
                      onSelect({ kind: "tag", id: controller.controllerTags[0]?.id ?? `${controller.id}:controller-tags` });
                      openContextMenu(event, { kind: "tags", x: event.clientX, y: event.clientY, controller });
                    }}
                  >
                    <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                    Controller Tags
                  </button>
                </li>
                <li>
                  <span className="esco-tree__group esco-tree__group--fault">
                    <span className="esco-tree__icon esco-tree__icon--fault" aria-hidden="true" />
                    Controller Fault Handler
                  </span>
                </li>
                <li>
                  <span className="esco-tree__group esco-tree__group--warning">
                    <span className="esco-tree__icon esco-tree__icon--warning" aria-hidden="true" />
                    Power-Up Handler
                  </span>
                </li>
              </ul>
            </li>
            <li>
              <button
                type="button"
                className="esco-tree__group esco-tree__group--button"
                onClick={() => onSelect({ kind: "controller", id: controller.id })}
                onContextMenu={(event) => {
                  onSelect({ kind: "controller", id: controller.id });
                  openContextMenu(event, { kind: "tasks-root", x: event.clientX, y: event.clientY, controller });
                }}
              >
                <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                Tasks
              </button>
                  <ul className="esco-tree esco-tree--nested">
                    {controller.tasks.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          className={`esco-tree__node esco-tree__node--task${
                            isSelected("task", task.id) ? " is-selected" : ""
                          }`}
                          onClick={() => onSelect({ kind: "task", id: task.id })}
                          onContextMenu={(event) => {
                            onSelect({ kind: "task", id: task.id });
                            openContextMenu(event, { kind: "task", x: event.clientX, y: event.clientY, task });
                          }}
                        >
                          <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                          <span className="esco-tree__icon esco-tree__icon--task" aria-hidden="true" />
                          {task.name}
                        </button>
                        <ul className="esco-tree esco-tree--nested">
                          {(() => {
                            const programs = capped(programsForTask(controller, task).filter(programMatches));
                            return (
                              <>
                                {programs.rows.map((program) => renderProgramNode(controller, program))}
                                {hiddenRow(programs.hiddenCount, "programs")}
                              </>
                            );
                          })()}
                        </ul>
                      </li>
                    ))}
                    <li>
                      <span className="esco-tree__group">
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                        Unscheduled
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {(() => {
                          const programs = capped(unscheduledProgramsForController(controller).filter(programMatches));
                          return (
                            <>
                              {programs.rows.map((program) => renderProgramNode(controller, program))}
                              {hiddenRow(programs.hiddenCount, "programs")}
                            </>
                          );
                        })()}
                      </ul>
                    </li>
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                    <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                    Motion Groups
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <span className="esco-tree__group">
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                        Ungrouped Axes
                      </span>
                    </li>
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                    <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                    Assets
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <span
                        className="esco-tree__group"
                        onContextMenu={(event) => {
                          openContextMenu(event, { kind: "aoi-root", x: event.clientX, y: event.clientY, controller });
                        }}
                      >
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                        Add-On Instructions
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {(() => {
                          const aois = capped(controller.addOnInstructions.filter((aoi) => matchesFilter(aoi.name)));
                          return (
                            <>
                              {aois.rows.map((aoi) => (
                                <li key={aoi.id}>
                                  <button
                                    type="button"
                                    className={`esco-tree__node esco-tree__node--aoi${isSelected("aoi", aoi.id) ? " is-selected" : ""}`}
                                    onClick={() => onSelect({ kind: "aoi", id: aoi.id })}
                                    onContextMenu={(event) => {
                                      onSelect({ kind: "aoi", id: aoi.id });
                                      openContextMenu(event, { kind: "aoi", x: event.clientX, y: event.clientY, controller, aoi });
                                    }}
                                  >
                                    <span className="esco-tree__icon esco-tree__icon--routine" aria-hidden="true" />
                                    {aoi.name}
                                    {aoi.protected ? <span className="esco-tree__meta">protected</span> : null}
                                  </button>
                                </li>
                              ))}
                              {hiddenRow(aois.hiddenCount, "AOIs")}
                            </>
                          );
                        })()}
                      </ul>
                    </li>
                    <li>
                      <span
                        className="esco-tree__group"
                        onContextMenu={(event) => {
                          openContextMenu(event, { kind: "data-types-root", x: event.clientX, y: event.clientY, controller });
                        }}
                      >
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                        Data Types
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {DATA_TYPE_GROUPS.map((group) => (
                          <li key={group}>
                            <span
                              className="esco-tree__group"
                              onContextMenu={group === "User-Defined" ? (event) => {
                                openContextMenu(event, {
                                  kind: "data-type-group",
                                  x: event.clientX,
                                  y: event.clientY,
                                  controller,
                                  group,
                                });
                              } : undefined}
                            >
                              <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                              <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                              {group}
                            </span>
                            {group === "User-Defined" ? (
                              <ul className="esco-tree esco-tree--nested">
                                {(() => {
                                  const udts = capped(controller.dataTypes.filter((udt) => matchesFilter(udt.name)));
                                  return (
                                    <>
                                      {udts.rows.map((udt) => (
                                        <li key={udt.id}>
                                          <button
                                            type="button"
                                            className={`esco-tree__node esco-tree__node--udt${isSelected("udt", udt.id) ? " is-selected" : ""}`}
                                            onClick={() => onSelect({ kind: "udt", id: udt.id })}
                                            onContextMenu={(event) => {
                                              onSelect({ kind: "udt", id: udt.id });
                                              openContextMenu(event, { kind: "udt", x: event.clientX, y: event.clientY, controller, udt });
                                            }}
                                          >
                                            <span className="esco-tree__icon esco-tree__icon--tag" aria-hidden="true" />
                                            {udt.name}
                                          </button>
                                        </li>
                                      ))}
                                      {hiddenRow(udts.hiddenCount, "UDTs")}
                                    </>
                                  );
                                })()}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </li>
                    <li>
                      <span
                        className="esco-tree__group"
                        onContextMenu={(event) => {
                          openContextMenu(event, { kind: "trends-root", x: event.clientX, y: event.clientY, controller });
                        }}
                      >
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                        Trends
                      </span>
                      <ul className="esco-tree esco-tree--nested">
                        {(() => {
                          const trends = capped((controller.trends ?? []).filter((trend) => matchesFilter(trend.name)));
                          return (
                            <>
                              {trends.rows.map((trend) => (
                                <li key={trend.id}>
                                  <button
                                    type="button"
                                    className={`esco-tree__node esco-tree__node--trend${isSelected("trend", trend.id) ? " is-selected" : ""}`}
                                    onClick={() => onSelect({ kind: "trend", id: trend.id })}
                                    onContextMenu={(event) => {
                                      onSelect({ kind: "trend", id: trend.id });
                                      openContextMenu(event, {
                                        kind: "trend",
                                        x: event.clientX,
                                        y: event.clientY,
                                        controller,
                                        trend,
                                      });
                                    }}
                                  >
                                    <span className="esco-tree__icon esco-tree__icon--tag" aria-hidden="true" />
                                    {trend.name}
                                    <span className="esco-tree__meta">{trend.pens.length} pen{trend.pens.length === 1 ? "" : "s"}</span>
                                  </button>
                                </li>
                              ))}
                              {hiddenRow(trends.hiddenCount, "trends")}
                            </>
                          );
                        })()}
                      </ul>
                    </li>
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                    <span className="esco-tree__icon esco-tree__icon--folder" aria-hidden="true" />
                    Logical Model
                  </span>
                </li>
                <li>
                  <button
                    type="button"
                    className="esco-tree__group esco-tree__group--button"
                    title="Open the I/O configuration"
                    onClick={() => onSelect({ kind: "io", controllerId: controller.id })}
                    onContextMenu={(event) => {
                      onSelect({ kind: "io", controllerId: controller.id });
                      openContextMenu(event, { kind: "io-root", x: event.clientX, y: event.clientY, controller });
                    }}
                  >
                    <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                    <span className="esco-tree__icon esco-tree__icon--io" aria-hidden="true" />
                    I/O Configuration
                  </button>
                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <button
                        type="button"
                        className="esco-tree__group esco-tree__group--button esco-tree__group--backplane"
                        title="Right-click to add a new module to this backplane"
                        onClick={() => onSelect({ kind: "io", controllerId: controller.id })}
                        onContextMenu={(event) => {
                          onSelect({ kind: "io", controllerId: controller.id });
                          openContextMenu(event, { kind: "io-root", x: event.clientX, y: event.clientY, controller });
                        }}
                      >
                        <span className="esco-tree__twisty" aria-hidden="true">▾</span>
                        <span className="esco-tree__icon esco-tree__icon--backplane" aria-hidden="true" />
                        {backplaneLabel(controller)}
                      </button>
                      <ul className="esco-tree esco-tree--nested">
                        {(() => {
                          const modules = capped((modulesByController.get(controller.id) ?? []).filter((module) =>
                            matchesFilter(module.name) ||
                            matchesFilter(module.catalogNumber ?? "") ||
                            matchesFilter(module.productType ?? "") ||
                            matchesFilter(moduleSlotLabel(module, controller)),
                          ));
                          const rows = modules.rows.map((module) => (
                            <li key={module.id}>
                              <button
                                type="button"
                                className={`esco-tree__node esco-tree__node--module${
                                  !!selection && selection.kind === "io" && selection.moduleId === module.id
                                    ? " is-selected"
                                    : ""
                                }`}
                                onClick={() => onSelect({ kind: "io", controllerId: controller.id, moduleId: module.id })}
                                onContextMenu={(event) => {
                                  onSelect({ kind: "io", controllerId: controller.id, moduleId: module.id });
                                  openContextMenu(event, {
                                    kind: "io-module",
                                    x: event.clientX,
                                    y: event.clientY,
                                    controller,
                                    module,
                                  });
                                }}
                              >
                                <span className="esco-tree__icon esco-tree__icon--module" aria-hidden="true" />
                                {moduleSlotLabel(module, controller)}
                              </button>
                            </li>
                          ));
                          if (!modules.rows.some((module) => isProcessorModule(module, controller)) && matchesFilter(fallbackProcessorSlotLabel(controller))) {
                            rows.unshift(
                              <li key={`${controller.id}-processor-fallback`}>
                                <span className="esco-tree__leaf esco-tree__leaf--module">
                                  <span className="esco-tree__icon esco-tree__icon--module" aria-hidden="true" />
                                  {fallbackProcessorSlotLabel(controller)}
                                </span>
                              </li>,
                            );
                          }
                          return (
                            <>
                              {rows}
                              {hiddenRow(modules.hiddenCount, "modules")}
                            </>
                          );
                        })()}
                      </ul>
                    </li>
                  </ul>
                </li>
            </Fragment>
          ))}
        </ul>
      ) : tab === "hmi" ? (
        <ul className="esco-tree">
          <li>
            <button
              type="button"
              className={`esco-tree__root esco-tree__root--button${
                isSelected("hmi", hmi?.id ?? project.id) ? " is-selected" : ""
              }`}
              onClick={() => onSelect({ kind: "hmi", id: hmi?.id ?? project.id })}
            >
              <span className="esco-tree__icon" aria-hidden="true">▾</span>
              HMI Project
              <span className="esco-tree__meta">{hmi?.name ?? "not configured"}</span>
            </button>
            {hmi ? (
              <ul className="esco-tree esco-tree--nested">
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__icon" aria-hidden="true">▾</span>
                    HMI Device
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    <li>
                      <span className="esco-tree__leaf">
                        {hmi.targetDevice.name}
                        <span className="esco-tree__meta">{hmi.targetDevice.width}x{hmi.targetDevice.height}</span>
                      </span>
                    </li>
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">
                    <span className="esco-tree__icon" aria-hidden="true">▾</span>
                    Screens ({hmi.screens.length})
                  </span>
                  <ul className="esco-tree esco-tree--nested">
                    {hmi.screens.length ? (
                      hmi.screens.map((screen) => (
                        <li key={screen.id}>
                          <button
                            type="button"
                            className={`esco-tree__node esco-tree__node--routine${
                              isSelected("hmi-screen", screen.id) ? " is-selected" : ""
                            }`}
                            onClick={() => onSelect({ kind: "hmi-screen", id: screen.id })}
                          >
                            <span className="esco-tree__icon" aria-hidden="true">HMI</span>
                            {screen.name}
                            {hmi.homeScreenId === screen.id ? <span className="esco-tree__meta">home</span> : null}
                          </button>
                        </li>
                      ))
                    ) : (
                      <li><span className="esco-tree__leaf">No screens created</span></li>
                    )}
                  </ul>
                </li>
                <li>
                  <span className="esco-tree__group">Popups ({hmi.popups.length})</span>
                  <ul className="esco-tree esco-tree--nested">
                    {hmi.popups.length ? (
                      hmi.popups.map((popup) => (
                        <li key={popup.id}>
                          <button
                            type="button"
                            className={`esco-tree__node${isSelected("hmi-popup", popup.id) ? " is-selected" : ""}`}
                            onClick={() => onSelect({ kind: "hmi-popup", id: popup.id })}
                          >
                            {popup.name}
                            <span className="esco-tree__meta">{popup.width}x{popup.height}</span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li><span className="esco-tree__leaf">No popups created</span></li>
                    )}
                  </ul>
                </li>
                <li>
                  <button
                    type="button"
                    className={`esco-tree__group esco-tree__group--button${
                      isSelected("hmi-banner", hmi.systemBanner.id) ? " is-selected" : ""
                    }`}
                    onClick={() => onSelect({ kind: "hmi-banner", id: hmi.systemBanner.id })}
                  >
                    System Banner
                  </button>
                </li>
                <li><span className="esco-tree__group">Alarm Views ({hmi.alarmViews.length})</span></li>
                <li><span className="esco-tree__group">Diagnostics Views ({hmi.diagnosticsViews.length})</span></li>
                <li><span className="esco-tree__group">Trends ({hmi.trends.length})</span></li>
                <li><span className="esco-tree__group">Data Logs ({hmi.dataLogs.length})</span></li>
                <li><span className="esco-tree__group">Recipes ({hmi.recipes?.length ?? 0})</span></li>
                <li><span className="esco-tree__group">Security ({hmi.security.roles.length} roles)</span></li>
                <li><span className="esco-tree__group">Language Packs ({hmi.languagePacks.length})</span></li>
                <li><span className="esco-tree__group">Images / PDFs ({hmi.assets.length})</span></li>
                <li><span className="esco-tree__group">Unsupported Preserved Content ({hmi.unsupportedContent.length})</span></li>
              </ul>
            ) : (
              <ul className="esco-tree esco-tree--nested">
                <li><span className="esco-tree__leaf">Open the HMI Designer to create the project model.</span></li>
              </ul>
            )}
          </li>
        </ul>
      ) : tab === "assets" ? (
        <ul className="esco-tree">
          <li><span className="esco-tree__group">Controller Tags ({controller?.controllerTags.length ?? 0})</span></li>
          <li><span className="esco-tree__group">Program Tags ({controller?.programs.flatMap((program) => program.programTags).length ?? 0})</span></li>
          <li><span className="esco-tree__group">Data Types ({controller?.dataTypes.length ?? 0})</span></li>
          <li><span className="esco-tree__group">AOIs / Add-On Instructions ({controller?.addOnInstructions.length ?? 0})</span></li>
          <li><span className="esco-tree__group">I/O Configuration / I/O Modules ({controller?.ioConfiguration.modules.length ?? 0})</span></li>
        </ul>
      ) : (
        <ul className="esco-tree">
          {["Bit", "Timer / Counter", "Move / Math", "Compare", "Program Control"].map((group) => (
            <li key={group}><span className="esco-tree__group">{group}</span></li>
          ))}
        </ul>
      )}
      </>
      )}
      {!panelHidden ? renderContextMenu() : null}
    </Panel>
  );
}
