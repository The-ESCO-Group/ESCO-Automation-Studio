import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ControllerMode } from "@esco/controller-comm";
import type {
  AddOnInstruction,
  Controller,
  ExternalAccess,
  IoModule,
  PlcProject,
  Routine,
  Tag,
  TagComment,
  TagEngineeringUnit,
  UserDefinedType,
} from "@esco/core";
import {
  addInstruction,
  addInstructionToBranch,
  addBranchLeg,
  addParallelBranch,
  addRung,
  addHmiElement,
  addHmiEventCommand,
  addAoiLocalTag,
  addAoiParameter,
  addIoModule,
  addUdtMember,
  createRoutine as createRoutineAction,
  createProgram as createProgramAction,
  createTask as createTaskAction,
  createTag,
  createHmiPopup as createHmiPopupAction,
  createHmiScreen as createHmiScreenAction,
  createHmiAlarmDefinition,
  updateHmiAlarmDefinition,
  deleteHmiAlarmDefinition,
  createControllerTrend,
  deleteControllerTrend,
  createHmiTrendDefinition,
  updateHmiTrendDefinition,
  deleteHmiTrendDefinition,
  addHmiTrendPen,
  removeHmiTrendPen,
  createHmiDataLogDefinition,
  updateHmiDataLogDefinition,
  deleteHmiDataLogDefinition,
  createHmiRecipe,
  addHmiRecipeItem,
  removeHmiRecipeItem,
  deleteHmiRecipe,
  createHmiLanguagePack,
  deleteHmiLanguagePack,
  setHmiLanguageString,
  removeHmiLanguageString,
  setHmiDefaultLanguage,
  importHmiLanguagePack,
  createHmiSecurityRole,
  deleteHmiSecurityRole,
  createHmiSecurityUser,
  deleteHmiSecurityUser,
  deleteAoi,
  deleteHmiElement,
  deleteHmiPopup,
  deleteHmiScreen,
  deleteProgram,
  deleteRung,
  deleteRoutine,
  deleteTag,
  deleteTask,
  deleteUdt,
  duplicateRung,
  ensureHmiProject,
  removeHmiElementBinding,
  removeHmiEventCommand,
  renameHmiSurface,
  setHmiElementBinding,
  setHmiHomeScreen,
  setHmiSurfaceSecurityRoles,
  updateHmiElement,
  updateHmiElementGeometry,
  exportProjectJson,
  exportProjectL5X,
  exportTagsCsv,
  findRoutine,
  getLadder,
  detectUnsupportedProjectFormat,
  recordImportProvenance,
  exportEscoRuntime,
  importEscoRuntime,
  exportEscoSnapshot,
  importProjectFromEscoSnapshot,
  exportEscoExchange,
  importProjectFromEscoExchange,
  exportEscoPackage,
  exportEscoLibrary,
  importProjectFromEscoPackage,
  EASX_EXTENSION,
  EASPKG_EXTENSION,
  EASRT_EXTENSION,
  EASSNAPSHOT_EXTENSION,
  ESCO_ARTIFACT_EXTENSIONS,
  validateEscoNativeArtifact,
  importL5XFile,
  importProjectFile,
  insertInstruction,
  insertRung,
  pasteRung,
  verifyRung,
  crossReferenceRung,
  previewTagCsvImport,
  applyTagCsvImport,
  removeAoiLocalTag,
  removeAoiParameter,
  removeBranchLeg,
  removeIoModule,
  removeInstruction,
  removeUdtMember,
  renameTag,
  setControllerProperties,
  setProgramProperties,
  setProjectProperties,
  setRoutineProperties,
  setRungComment,
  setStructuredTextSource,
  setTagAlias,
  setTagComments,
  setTagDataType,
  setTagDescription,
  setTagDimensions,
  setTagEngineeringUnits,
  setTagMetadata,
  setTaskProperties,
  resolveValidationFindingTarget,
  updateAoiLocalTag,
  updateAoiParameter,
  updateIoModule,
  updateInstructionOperand,
  updateUdtMember,
  exportControllerComponent,
  exportCustomInstructionComponent,
  exportDataTypeComponent,
  exportDeviceDefinitionComponent,
  exportDeviceTreeComponent,
  exportIoProfilePack,
  exportProgramComponent,
  verifyProjectReport,
  findBuildStep,
  buildSummaryLine,
  exportRoutineComponent,
  exportTagComponent,
  exportTaskComponent,
  importComponents,
  importControllerComponent,
  importIoProfilePack,
  importProgramComponent,
  importRoutineComponent,
  importTagComponent,
  importTaskComponent,
  previewComponentImport,
  previewControllerComponentImport,
  previewIoProfilePackImport,
  previewProgramComponentImport,
  previewRoutineComponentImport,
  previewTagComponentImport,
  previewTaskComponentImport,
  createOfflineTaskSchedulerState,
  type ComponentImportAssetKind,
  type ComponentImportPlan,
  type ComponentImportResolutionMap,
  controllerTaskStatusReport,
  recordOfflineScan,
  resetTaskScanStats,
  type ComponentExportData,
  type TagComponentImportTarget,
  type OfflineTaskSchedulerState,
  type ProjectActionResult,
  type TagCsvImportPreview,
  type TaskScanStats,
} from "@esco/project-actions";
import { EASPROJ_EXTENSION } from "@esco/project-store";
import {
  buildHmiRuntimePackage,
  exportHmiLanguagePackCsv,
  getHmiProject,
  serializeHmiRuntimePackageArtifact,
  type HmiGraphicElement,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import { rungNodes, type LadderBranch } from "@esco/ladder";
import { createDefaultRegistry, inferOperandTagType } from "@esco/instructions";
import type { ImportSummary } from "@esco/parser-l5x";
import { applyPlan, type ApplyResult, type AssistantPlan } from "@esco/ai-assistant";
import { createDefaultEngine, type ValidationFinding } from "@esco/validator";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { EditorArea } from "./components/EditorArea";
import {
  BottomPanel,
  type ArtifactValidationPreview,
  type DockTab,
  type PackageBuildPreview,
  type RuntimeBuildPreview,
} from "./components/BottomPanel";
import { WelcomeDashboard } from "./components/WelcomeDashboard";
import { TagsView } from "./components/TagsView";
import { CompareView } from "./components/CompareView";
import { SimulationLab } from "./components/simlab/SimulationLab";
import { FloatingAssistant } from "./components/FloatingAssistant";
import { LiveBridge } from "./components/LiveBridge";
import { ProjectHistoryView } from "./components/ProjectHistoryView";
import { StructureView, type StructureEditing } from "./components/StructureView";
import { openGitTerminal } from "./git-terminal";
import { Toasts } from "./components/Toasts";
import { AppShell } from "./components/AppShell";
import { TopAppBar } from "./components/TopAppBar";
import { RibbonToolbar } from "./components/RibbonToolbar";
import { RightCopilotPanel, type CopilotTab } from "./components/RightCopilotPanel";
import { StatusBar } from "./components/StatusBar";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { AboutDialog, type AboutDialogMode } from "./components/AboutDialog";
import { FilePolicyDialog, type FilePolicyInfo } from "./components/FilePolicyDialog";
import { TagCsvPreviewDialog } from "./components/TagCsvPreviewDialog";
import { ImportComponentDialog } from "./components/ImportComponentDialog";
import { DesktopStartup } from "./components/DesktopStartup";
import { DIALOG_HELP_EVENT, showDialogHelp, type DialogHelpEventDetail } from "./components/dialogValidation";
import { ProjectPropertiesDialog } from "./components/ProjectPropertiesDialog";
import { ControllerPropertiesDialog, type ControllerPropertiesInput } from "./components/ControllerPropertiesDialog";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { NewRoutineDialog, type NewRoutineInput } from "./components/NewRoutineDialog";
import { RoutinePropertiesDialog, type RoutinePropertiesInput } from "./components/RoutinePropertiesDialog";
import { ProgramPropertiesDialog, type ProgramPropertiesInput } from "./components/ProgramPropertiesDialog";
import { NewTaskDialog, type NewTaskInput } from "./components/NewTaskDialog";
import { TaskPropertiesDialog, type TaskPropertiesInput } from "./components/TaskPropertiesDialog";
import { IoModulePropertiesDialog, type IoModulePropertiesInput } from "./components/IoModulePropertiesDialog";
import { NewIoModuleDialog } from "./components/NewIoModuleDialog";
import { NewProgramDialog, type NewProgramInput } from "./components/NewProgramDialog";
import { AddExistingProgramDialog, type AddExistingProgramInput } from "./components/AddExistingProgramDialog";
import { NewTagDialog, type NewTagInput } from "./components/NewTagDialog";
import { InstructionPicker } from "./components/InstructionPicker";
import { HmiDesigner, type BindingDraft, type ElementPatch, type EventCommandDraft } from "./components/hmi/HmiDesigner";
import type { Selection } from "./selection";
import { createBlankRoutineProject, createInitialProject, findMainRoutine, type BlankRoutineProjectOptions } from "./project-edit";
import { applyProjectTextReplace, previewProjectTextReplace, searchProject, type SearchHit } from "./search";
import { resolveWorkbenchShortcut } from "./shortcuts";
import {
  downloadTextFile,
  openDesktopProjectFile,
  readDesktopProjectFile,
  readFileAsText,
  saveDesktopProjectFile,
  slugify,
  type DesktopSavedFile,
  type DesktopTextFile,
} from "./file-io";
import {
  createTrendSample,
  scheduledScanOnce,
  watchRows,
  zeroValues,
  type Forces,
  type TagValues,
  type TrendSample,
} from "./simulation";
import { useToasts } from "./toasts";
import { useControllerSession, type ControllerCommunicationAction } from "./controller-session";
import { useVirtualController, virtualCommPathDisplayLabel } from "./virtual-controller-session";
import { useHistoryState } from "./history";
import { clearAutosave, loadAutosave, saveAutosave, type AutosaveEntry } from "./autosave";
import { aiApplyActivityMessage, recordActivity, type ActivityEntry, type ActivityKind } from "./activity";
import { aiProfileModelLabel, loadAiProfile, profileInitials, saveAiProfile, type AiProfile } from "./ai-profile";
import {
  loadRecentProjects,
  markRecentProjectMissing,
  rememberRecentProject,
  type RecentProjectInput,
  type RecentProjectEntry,
} from "./recent-projects";
import { isDesktopStartupRequested, promoteDesktopWindowToIde } from "./desktop-runtime";
import {
  isFirstRunComplete,
  recordDesktopStartupAction,
  type DesktopStartupAction,
} from "./app-settings";
import { CONFIRMATION_EVENT, requestConfirmation, type ConfirmationRequestDetail } from "./confirmation";
import { escoBrandText } from "./branding";
import { escoCapabilityCounts } from "./escoCapabilityMap";
import { loadWorkbenchLayout, saveWorkbenchLayout } from "./workbench-layout";

const SCAN_INTERVAL_MS = 250;
const TREND_BUFFER_LIMIT = 120;
type OfflineEditLifecycleState = "none" | "test" | "assembled" | "finalized" | "canceled";
type OfflineEditLifecycleAction = Extract<
  ControllerCommunicationAction,
  "test-edits" | "assemble-edits" | "finalize-edits" | "cancel-edits"
>;

function isOfflineEditLifecycleAction(action: ControllerCommunicationAction): action is OfflineEditLifecycleAction {
  return action === "test-edits" || action === "assemble-edits" || action === "finalize-edits" || action === "cancel-edits";
}
// Shared instruction registry for editor-side metadata (operand type inference).
const instructionRegistry = createDefaultRegistry();
type CenterView = "welcome" | "routine" | "tags" | "compare" | "history" | "structure" | "hmi" | "simulation";

function createClientId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${random}`;
}

function nextAssetName(existing: readonly string[], base: string): string {
  const used = new Set(existing.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

function isControllerProcessorModule(module: IoModule, controller: Controller): boolean {
  const text = escoBrandText(`${module.name} ${module.catalogNumber ?? ""} ${module.productType ?? ""}`);
  const looksLikeProcessor = /processor|controller|esco|557|558|L7|L8/i.test(text);
  if (module.slot === controller.slot && looksLikeProcessor) return true;
  return module.name.toLowerCase() === controller.name.toLowerCase() && looksLikeProcessor;
}

function controllerProcessorProductType(controller: Controller): string {
  return `${escoBrandText(controller.processorType?.trim() || "ESCO5571")} Processor`;
}

function ioModuleToPropertiesInput(
  controllerId: string,
  module: IoModule,
  patch: Partial<IoModulePropertiesInput> = {},
): IoModulePropertiesInput {
  const connection = module.connections?.[0];
  return {
    controllerId,
    moduleId: module.id,
    name: module.name,
    catalogNumber: module.catalogNumber ?? "",
    slot: module.slot,
    description: module.description ?? "",
    parentModule: module.parentModule ?? "",
    parentPortId: module.parentPortId ?? "",
    commPath: module.commPath ?? "",
    vendor: module.vendor ?? "",
    productType: module.productType ?? "",
    productCode: module.productCode ?? "",
    majorRevision: module.majorRevision ?? "",
    minorRevision: module.minorRevision ?? "",
    electronicKeying: module.electronicKeying ?? "",
    inhibited: module.inhibited === true,
    connection: {
      name: connection?.name ?? "",
      type: connection?.type ?? "",
      rpi: connection?.rpi,
      priority: connection?.priority ?? "",
      unicast: connection?.unicast === true,
      inputConnectionType: connection?.inputConnectionType ?? "",
      inputProductionTrigger: connection?.inputProductionTrigger ?? "",
      outputRedundantOwner: connection?.outputRedundantOwner === true,
    },
    ...patch,
  };
}

function routineWindowIdsForProject(project: PlcProject): string[] {
  return project.controllers.flatMap((controller) =>
    controller.programs.flatMap((program) => program.routines.map((routine) => routine.id)),
  );
}

export function App() {
  const [initialProject] = useState(createInitialProject);
  const history = useHistoryState(initialProject);
  const project = history.present;
  const setProject = history.set;
  // The project reference last saved (exported) or loaded; identity equality with
  // the current project tells us whether there are unsaved changes. Because history
  // keeps references, undoing back to a saved state also returns to "clean".
  const [savedProject, setSavedProject] = useState(initialProject);
  const dirty = project !== savedProject;
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<AutosaveEntry | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [forces, setForces] = useState<Forces>({});
  const [trendSamples, setTrendSamples] = useState<TrendSample[]>([]);
  const [running, setRunning] = useState(false);
  // Offline task scan statistics (per-task scan count / last scan time / modelled
  // scan ms). Accumulated by handleScanOnce and the offline scan loop; never a
  // hardware read. The seq ref is the monotonic cycle counter.
  const [taskScanStats, setTaskScanStats] = useState<TaskScanStats>({});
  const taskScanSeqRef = useRef(0);
  const taskSchedulerStateRef = useRef<OfflineTaskSchedulerState>(createOfflineTaskSchedulerState());
  const [projectOpen, setProjectOpen] = useState(false);
  const [view, setView] = useState<CenterView>("welcome");
  const [openRoutineId, setOpenRoutineId] = useState<string | undefined>(undefined);
  const [openRoutineWindowIds, setOpenRoutineWindowIds] = useState<string[]>([]);
  // Restore how the workbench was last parked (active dock/inspector tabs, panel state).
  const [initialLayout] = useState(loadWorkbenchLayout);
  const [dockTab, setDockTab] = useState<DockTab>(initialLayout.dockTab);
  const [dockOpenKey, setDockOpenKey] = useState(0);
  const [runtimeBuildPreview, setRuntimeBuildPreview] = useState<RuntimeBuildPreview | null>(null);
  const [packageBuildPreview, setPackageBuildPreview] = useState<PackageBuildPreview | null>(null);
  const [artifactValidationPreview, setArtifactValidationPreview] = useState<ArtifactValidationPreview | null>(null);
  const [copilotTab, setCopilotTab] = useState<CopilotTab>(initialLayout.copilotTab);
  const [rightPanelOpen, setRightPanelOpen] = useState(initialLayout.rightPanelOpen);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [aiProfile, setAiProfile] = useState<AiProfile | null>(() => loadAiProfile());
  const [setupOpen, setSetupOpen] = useState(false);
  const [aboutDialog, setAboutDialog] = useState<{ open: boolean; mode: AboutDialogMode }>({
    open: false,
    mode: "about",
  });
  const [dialogHelp, setDialogHelp] = useState<DialogHelpEventDetail | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequestDetail | null>(null);
  // Unsupported-format modal (open while non-null) plus the sticky "last blocked
  // import this session" surfaced in the About dialog.
  const [filePolicyInfo, setFilePolicyInfo] = useState<FilePolicyInfo | null>(null);
  const [lastBlockedImport, setLastBlockedImport] = useState<FilePolicyInfo | null>(null);
  const [desktopSignInPrompted, setDesktopSignInPrompted] = useState(false);
  const [firstRunComplete, setFirstRunComplete] = useState(() => isFirstRunComplete());
  const [desktopStartupOpen, setDesktopStartupOpen] = useState(() => isDesktopStartupRequested());
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const [projectFile, setProjectFile] = useState<DesktopSavedFile | null>(null);
  const [projectPropertiesOpen, setProjectPropertiesOpen] = useState(false);
  const [controllerPropertiesOpen, setControllerPropertiesOpen] = useState(false);
  const [controllerPropertiesControllerId, setControllerPropertiesControllerId] = useState<string | undefined>(undefined);
  const [newRoutineProgramId, setNewRoutineProgramId] = useState<string | undefined>(undefined);
  const [routinePropertiesRoutineId, setRoutinePropertiesRoutineId] = useState<string | undefined>(undefined);
  const [newProgramTarget, setNewProgramTarget] = useState<{
    controllerId: string;
    taskId?: string;
  } | undefined>(undefined);
  // When set, the Add Ladder Element picker inserts the chosen instruction at
  // a specific ladder edit target instead of appending it to the selected rung.
  const [instructionInsertTarget, setInstructionInsertTarget] = useState<
    | {
        kind: "rung";
        routineId: string;
        rungId: string;
      }
    | {
        kind: "relative";
        routineId: string;
        rungId: string;
        nodeId: string;
        position: "before" | "after";
      }
    | {
        kind: "branch";
        routineId: string;
        rungId: string;
        branchId: string;
      }
    | null
  >(null);
  const [newTagDialogOpen, setNewTagDialogOpen] = useState(false);
  const [newTagDefaults, setNewTagDefaults] = useState<{
    scope: "controller" | "program";
    programId?: string;
    name?: string;
    dataType?: string;
  }>({ scope: "controller" });
  const [instructionPickerOpen, setInstructionPickerOpen] = useState(false);
  const [programPropertiesProgramId, setProgramPropertiesProgramId] = useState<string | undefined>(undefined);
  const [newTaskControllerId, setNewTaskControllerId] = useState<string | undefined>(undefined);
  const [taskPropertiesTaskId, setTaskPropertiesTaskId] = useState<string | undefined>(undefined);
  const [addExistingProgramTaskId, setAddExistingProgramTaskId] = useState<string | undefined>(undefined);
  const [ioModulePropertiesTarget, setIoModulePropertiesTarget] = useState<{
    controllerId: string;
    moduleId: string;
  } | undefined>(undefined);
  const [newIoModuleControllerId, setNewIoModuleControllerId] = useState<string | undefined>(undefined);
  const [newIoModuleInitialQuery, setNewIoModuleInitialQuery] = useState<string | undefined>(undefined);
  const [newIoModuleInitialSlot, setNewIoModuleInitialSlot] = useState<number | undefined>(undefined);
  const [changeIoModuleTarget, setChangeIoModuleTarget] = useState<{
    controllerId: string;
    moduleId: string;
  } | undefined>(undefined);
  const [tagCsvPreview, setTagCsvPreview] = useState<{
    fileName: string;
    csv: string;
    preview: TagCsvImportPreview;
  } | null>(null);
  const [componentImport, setComponentImport] = useState<
    | {
        targetKind: "controller";
        fileName: string;
        controllerId: string;
        family: ComponentImportAssetKind;
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "controller-component";
        fileName: string;
        controllerId?: string;
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "program";
        fileName: string;
        programId: string;
        family: "routine";
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "controller-program";
        fileName: string;
        controllerId: string;
        family: "program";
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "controller-task";
        fileName: string;
        controllerId: string;
        family: "task";
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "tag";
        fileName: string;
        controllerId: string;
        scope: "controller" | "program";
        programId?: string;
        family: "tag";
        text: string;
        plan: ComponentImportPlan;
      }
    | {
        targetKind: "io-profile-pack";
        fileName: string;
        controllerId: string;
        text: string;
        plan: ComponentImportPlan;
      }
    | null
  >(null);

  const openDockTab = (tab: DockTab) => {
    setDockTab(tab);
    setDockOpenKey((key) => key + 1);
  };
  const openCopilotPanel = (tab: CopilotTab = "chat") => {
    setCopilotTab(tab);
    setRightPanelOpen(true);
  };
  const logActivity = (kind: ActivityKind, message: string) =>
    setActivity((log) => recordActivity(log, kind, message));
  const rememberProject = (entry: RecentProjectInput) =>
    setRecentProjects((current) => rememberRecentProject(current, entry));
  const [lastImport, setLastImport] = useState<{ name: string; summary: ImportSummary } | null>(null);
  const [comparison, setComparison] = useState<{ name: string; project: PlcProject } | null>(null);
  const [clipboardRung, setClipboardRung] = useState<{ root: LadderBranch; comment?: string } | null>(null);
  const [offlineEditLifecycle, setOfflineEditLifecycle] = useState<Record<string, OfflineEditLifecycleState>>({});
  const { toasts, push, dismiss } = useToasts();
  const controllerSession = useControllerSession();
  const handleControllerAction = (action: ControllerCommunicationAction) => {
    if (isOfflineEditLifecycleAction(action) && openRoutineProgram && openRoutineImportedTestEdits) {
      const current = offlineEditLifecycle[openRoutineProgram.id] ?? "test";
      if ((action === "assemble-edits" || action === "finalize-edits") && current !== "test" && current !== "assembled") {
        openDockTab("build");
        push("warning", `No tested edits are pending for ${openRoutineProgram.name}.`);
        return;
      }

      const next: OfflineEditLifecycleState =
        action === "assemble-edits"
          ? "assembled"
          : action === "finalize-edits"
            ? "finalized"
            : action === "cancel-edits"
              ? "canceled"
              : "test";
      setOfflineEditLifecycle((states) => ({ ...states, [openRoutineProgram.id]: next }));
      openDockTab("build");
      const label =
        action === "test-edits"
          ? "Test Edits"
          : action === "assemble-edits"
            ? "Assemble Edits"
            : action === "finalize-edits"
              ? "Finalize All Edits"
              : "Cancel Edits";
      const message =
        next === "finalized" || next === "canceled"
          ? `${label} recorded for ${openRoutineProgram.name} in offline review. Source TestEdits metadata is preserved; no controller was modified.`
          : `${label} recorded for ${openRoutineProgram.name} in offline review. No controller was modified.`;
      push(next === "canceled" ? "warning" : "success", message);
      logActivity("info", message);
      return;
    }

    openDockTab("controller");
    void controllerSession
      .runCommunicationAction(action)
      .then((result) => push(result.kind, result.message))
      .catch((error) => push("error", error instanceof Error ? error.message : "Controller communication action failed."));
  };
  // ESCO Virtual Controller — offline/virtual session (virtual path, virtual
  // Go Online/Download/Upload, mode, faults). Separate from the hardware safety gate above.
  const hmiProject = getHmiProject(project);
  const virtualController = useVirtualController(project, projectOpen, hmiProject);
  const controllerEditLocked = projectOpen && virtualController.snapshot.editsLocked;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const l5xInputRef = useRef<HTMLInputElement>(null);
  const runtimeInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const exchangeInputRef = useRef<HTMLInputElement>(null);
  const packageInputRef = useRef<HTMLInputElement>(null);
  const escoArtifactInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const tagCsvInputRef = useRef<HTMLInputElement>(null);
  const componentImportInputRef = useRef<HTMLInputElement>(null);
  const componentImportTargetRef = useRef<
    | { targetKind: "controller"; controllerId: string; family: ComponentImportAssetKind }
    | { targetKind: "controller-component"; controllerId?: string }
    | { targetKind: "program"; programId: string; family: "routine" }
    | { targetKind: "controller-program"; controllerId: string; family: "program" }
    | { targetKind: "controller-task"; controllerId: string; family: "task" }
    | { targetKind: "tag"; controllerId: string; scope: "controller" | "program"; programId?: string; family: "tag" }
    | { targetKind: "io-profile-pack"; controllerId: string }
    | null
  >(null);
  const openProjectAlreadyConfirmedRef = useRef(false);

  const findings = useMemo(() => createDefaultEngine().run(project), [project]);
  const rows = useMemo(() => watchRows(project, values), [project, values]);
  const allTags = useMemo(
    () =>
      project.controllers.flatMap((controller) => [
        ...controller.controllerTags,
        ...controller.programs.flatMap((program) => program.programTags),
      ]),
    [project],
  );
  const programNamesById = useMemo(
    () =>
      new Map(
        project.controllers.flatMap((controller) =>
          controller.programs.map((program) => [program.id, program.name] as const),
        ),
      ),
    [project],
  );
  const tagValuePath = (tag: Tag): string => {
    const programName = tag.programId ? programNamesById.get(tag.programId) : undefined;
    return programName ? `Program:${programName}.${tag.name}` : tag.name;
  };
  const hmiKnownTagPaths = useMemo(
    () =>
      project.controllers.flatMap((controller) => [
        ...controller.controllerTags.map((tag) => tag.name),
        ...controller.programs.flatMap((program) => program.programTags.map((tag) => tag.name)),
      ]),
    [project],
  );
  const openRoutine = openRoutineId ? findRoutine(project, openRoutineId) : undefined;
  const openLadder = getLadder(openRoutine);
  const openRoutineProgram = useMemo(() => {
    if (!openRoutineId) return undefined;
    return project.controllers
      .flatMap((controller) => controller.programs)
      .find((program) => program.routines.some((routine) => routine.id === openRoutineId));
  }, [openRoutineId, project]);
  const openRoutineImportedTestEdits = openRoutineProgram?.testEdits === true;
  const openRoutineEditState: OfflineEditLifecycleState =
    openRoutineProgram ? offlineEditLifecycle[openRoutineProgram.id] ?? (openRoutineImportedTestEdits ? "test" : "none") : "none";
  const routineById = useMemo(
    () =>
      new Map(
        project.controllers.flatMap((controller) =>
          controller.programs.flatMap((program) => program.routines.map((routine) => [routine.id, routine] as const)),
        ),
      ),
    [project],
  );
  const activeContext = useMemo(() => {
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        const routine = program.routines.find((candidate) => candidate.id === openRoutineId);
        if (routine) return { controller, program, routine, routines: program.routines };
      }
    }
    const controller = project.controllers[0];
    const program = controller?.programs[0];
    return { controller, program, routine: undefined, routines: program?.routines ?? [] };
  }, [project, openRoutineId]);
  const resolveTagReference = (reference: string): { tag: Tag; path: string } | undefined => {
    const trimmed = reference.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.toLowerCase();
    const activeProgramId = activeContext.program?.id;
    const candidates = activeProgramId
      ? [
          ...allTags.filter((tag) => tag.programId === activeProgramId),
          ...allTags.filter((tag) => tag.programId !== activeProgramId),
        ]
      : allTags;
    for (const tag of candidates) {
      const name = tag.name.toLowerCase();
      const path = tagValuePath(tag);
      const normalizedPath = path.toLowerCase();
      if (name === normalized || normalizedPath === normalized) return { tag, path };
      if (normalized.startsWith(`${name}.`) || normalized.startsWith(`${name}[`)) {
        return { tag, path: `${path}${trimmed.slice(tag.name.length)}` };
      }
      if (normalized.startsWith(`${normalizedPath}.`) || normalized.startsWith(`${normalizedPath}[`)) {
        return { tag, path: `${path}${trimmed.slice(path.length)}` };
      }
    }
    return undefined;
  };
  const openRoutineTabs = useMemo(() => {
    const tabs = openRoutineWindowIds
      .map((routineId) => routineById.get(routineId))
      .filter((routine): routine is Routine => Boolean(routine));
    if (openRoutine && !tabs.some((routine) => routine.id === openRoutine.id)) tabs.push(openRoutine);
    return tabs;
  }, [openRoutine, openRoutineWindowIds, routineById]);
  const openRoutineWindow = (routineId: string) => {
    setOpenRoutineWindowIds((current) => (current.includes(routineId) ? current : [...current, routineId]));
    setOpenRoutineId(routineId);
    setSelection({ kind: "routine", id: routineId });
    setView("routine");
  };
  const controllerPropertiesController = useMemo(
    () =>
      controllerPropertiesControllerId
        ? project.controllers.find((controller) => controller.id === controllerPropertiesControllerId)
        : undefined,
    [controllerPropertiesControllerId, project],
  );
  const newRoutineProgram = useMemo(
    () =>
      project.controllers
        .flatMap((controller) => controller.programs)
        .find((program) => program.id === newRoutineProgramId),
    [newRoutineProgramId, project],
  );
  const routinePropertiesRoutine = routinePropertiesRoutineId ? findRoutine(project, routinePropertiesRoutineId) : undefined;
  const routinePropertiesProgram = useMemo(
    () =>
      routinePropertiesRoutine
        ? project.controllers
            .flatMap((controller) => controller.programs)
            .find((program) => program.id === routinePropertiesRoutine.programId)
        : undefined,
    [project, routinePropertiesRoutine],
  );
  const newProgramContext = useMemo(() => {
    if (!newProgramTarget) return undefined;
    const controller = project.controllers.find((candidate) => candidate.id === newProgramTarget.controllerId);
    return controller ? { controller, taskId: newProgramTarget.taskId } : undefined;
  }, [newProgramTarget, project]);
  const programPropertiesContext = useMemo(() => {
    if (!programPropertiesProgramId) return undefined;
    for (const controller of project.controllers) {
      const program = controller.programs.find((candidate) => candidate.id === programPropertiesProgramId);
      if (program) return { controller, program };
    }
    return undefined;
  }, [programPropertiesProgramId, project]);
  const newTaskController = useMemo(
    () => project.controllers.find((controller) => controller.id === newTaskControllerId),
    [newTaskControllerId, project],
  );
  const taskPropertiesContext = useMemo(() => {
    if (!taskPropertiesTaskId) return undefined;
    for (const controller of project.controllers) {
      const task = controller.tasks.find((candidate) => candidate.id === taskPropertiesTaskId);
      if (task) return { controller, task };
    }
    return undefined;
  }, [project, taskPropertiesTaskId]);
  const addExistingProgramContext = useMemo(() => {
    if (!addExistingProgramTaskId) return undefined;
    for (const controller of project.controllers) {
      const task = controller.tasks.find((candidate) => candidate.id === addExistingProgramTaskId);
      if (task) return { controller, task };
    }
    return undefined;
  }, [addExistingProgramTaskId, project]);
  const ioModulePropertiesContext = useMemo(() => {
    if (!ioModulePropertiesTarget) return undefined;
    const controller = project.controllers.find((candidate) => candidate.id === ioModulePropertiesTarget.controllerId);
    const module = controller?.ioConfiguration.modules.find((candidate) => candidate.id === ioModulePropertiesTarget.moduleId);
    return controller && module ? { controller, module } : undefined;
  }, [ioModulePropertiesTarget, project]);
  const newIoModuleController = useMemo(
    () => project.controllers.find((controller) => controller.id === newIoModuleControllerId),
    [newIoModuleControllerId, project],
  );
  const changeIoModuleContext = useMemo(() => {
    if (!changeIoModuleTarget) return undefined;
    const controller = project.controllers.find((candidate) => candidate.id === changeIoModuleTarget.controllerId);
    const module = controller?.ioConfiguration.modules.find((candidate) => candidate.id === changeIoModuleTarget.moduleId);
    return controller && module ? { controller, module } : undefined;
  }, [changeIoModuleTarget, project]);

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warning").length;

  // ---- Selection / navigation ----
  const handleSelect = (sel: Selection) => {
    if (sel?.kind === "routine") {
      openRoutineWindow(sel.id);
      return;
    }
    setSelection(sel);
    if (sel?.kind === "io") {
      if (sel.moduleId) setIoModulePropertiesTarget({ controllerId: sel.controllerId, moduleId: sel.moduleId });
      setView("structure");
    } else if (sel?.kind === "aoi" || sel?.kind === "udt" || sel?.kind === "trend") {
      setView("structure");
      setCopilotTab("history");
    } else if (
      sel?.kind === "hmi" ||
      sel?.kind === "hmi-screen" ||
      sel?.kind === "hmi-popup" ||
      sel?.kind === "hmi-banner"
    ) {
      setView("hmi");
      setCopilotTab("history");
    } else if (sel?.kind === "tag") {
      setView("tags");
      setCopilotTab("history");
    } else if (sel) {
      setCopilotTab("history");
    }
  };

  // ---- Ladder edits via the controlled action layer (target the open routine) ----
  const targetRoutineId = (p: PlcProject, requestedRoutineId?: string) =>
    requestedRoutineId !== undefined
      ? findRoutine(p, requestedRoutineId)
        ? requestedRoutineId
        : ""
      : openRoutineId && findRoutine(p, openRoutineId)
        ? openRoutineId
        : findMainRoutine(p)?.id ?? "";
  const blockControllerLockedEdit = (action = "Edit"): boolean => {
    if (!controllerEditLocked) return false;
    const message = `${action} is blocked while the ESCO Virtual Controller is scanning in ${virtualController.snapshot.modeLabel} mode. Switch to Program mode or go Offline before editing logic.`;
    openDockTab("controller");
    push("warning", message);
    logActivity("info", message);
    return true;
  };
  const applyAction = (run: (p: PlcProject) => ProjectActionResult, action = "Edit") => {
    if (blockControllerLockedEdit(action)) return;
    setProject((current) => {
      const result = run(current);
      if (!result.ok) {
        const message = result.error ?? `${action} failed.`;
        queueMicrotask(() => push("error", message));
        return current;
      }
      return result.project;
    });
  };

  const commitLadderStructureEdit = (nextProject: PlcProject) => {
    setProject(nextProject);
    setValues(zeroValues(nextProject));
    setTrendSamples([]);
  };

  const selectRungNearDeleted = (
    beforeProject: PlcProject,
    afterProject: PlcProject,
    routineId: string,
    deletedRungId: string,
  ): Selection => {
    const beforeRungs = getLadder(findRoutine(beforeProject, routineId))?.rungs ?? [];
    const deletedIndex = beforeRungs.findIndex((rung) => rung.id === deletedRungId);
    const afterRungs = getLadder(findRoutine(afterProject, routineId))?.rungs ?? [];
    const nextIndex = Math.min(Math.max(deletedIndex, 0), afterRungs.length - 1);
    const nextRung = nextIndex >= 0 ? afterRungs[nextIndex] : undefined;
    return nextRung ? { kind: "rung", routineId, rungId: nextRung.id } : { kind: "routine", id: routineId };
  };

  const selectInstructionNearDeleted = (
    beforeProject: PlcProject,
    afterProject: PlcProject,
    routineId: string,
    rungId: string,
    deletedNodeId: string,
  ): Selection => {
    const beforeRung = getLadder(findRoutine(beforeProject, routineId))?.rungs.find((rung) => rung.id === rungId);
    const afterRung = getLadder(findRoutine(afterProject, routineId))?.rungs.find((rung) => rung.id === rungId);
    if (!afterRung) return { kind: "routine", id: routineId };
    const beforeIndex = beforeRung ? rungNodes(beforeRung).findIndex((node) => node.id === deletedNodeId) : -1;
    const afterNodes = rungNodes(afterRung);
    const nextIndex = Math.min(Math.max(beforeIndex, 0), afterNodes.length - 1);
    const nextNode = nextIndex >= 0 ? afterNodes[nextIndex] : undefined;
    return nextNode
      ? { kind: "instruction", routineId, rungId, nodeId: nextNode.id }
      : { kind: "rung", routineId, rungId };
  };

  const repairLadderSelectionForProject = (nextProject: PlcProject, current: Selection): Selection => {
    if (current?.kind !== "rung" && current?.kind !== "instruction") return current;
    const routine = findRoutine(nextProject, current.routineId);
    const ladder = getLadder(routine);
    if (!routine || !ladder) return null;
    const rung = ladder.rungs.find((candidate) => candidate.id === current.rungId);
    if (!rung) {
      return ladder.rungs[0]
        ? { kind: "rung", routineId: current.routineId, rungId: ladder.rungs[0].id }
        : { kind: "routine", id: current.routineId };
    }
    if (current.kind === "rung") return current;
    return rungNodes(rung).some((node) => node.id === current.nodeId)
      ? current
      : { kind: "rung", routineId: current.routineId, rungId: rung.id };
  };

  const firstRoutineSelectionForProject = (nextProject: PlcProject): Selection => {
    const main = findMainRoutine(nextProject);
    return main ? { kind: "routine", id: main.id } : null;
  };

  const repairRoutineWorkspaceForProject = (nextProject: PlcProject) => {
    const routineIds = routineWindowIdsForProject(nextProject);
    setOpenRoutineWindowIds((current) => current.filter((routineId) => routineIds.includes(routineId)));
    setOpenRoutineId((current) => (current && routineIds.includes(current) ? current : findMainRoutine(nextProject)?.id));
    setSelection((current) => {
      if (current?.kind === "routine" && !routineIds.includes(current.id)) return firstRoutineSelectionForProject(nextProject);
      const repaired = repairLadderSelectionForProject(nextProject, current);
      return repaired ?? firstRoutineSelectionForProject(nextProject);
    });
  };

  const restoreRoutineWindowState = (nextProject: PlcProject, options: { preserveView?: boolean } = {}) => {
    const routineIds = routineWindowIdsForProject(nextProject);
    const fallbackRoutine = findMainRoutine(nextProject);
    setOpenRoutineWindowIds(routineIds);
    setOpenRoutineId(fallbackRoutine?.id);
    setSelection(fallbackRoutine ? { kind: "routine", id: fallbackRoutine.id } : null);
    if (options.preserveView) return;
    setView(fallbackRoutine ? "routine" : "structure");
  };

  const handleAddRung = () => {
    if (blockControllerLockedEdit("Add rung")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = addRung(project, { routineId: rid });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    }
  };
  const handleDeleteRung = (rungId: string) => {
    if (blockControllerLockedEdit("Delete rung")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = deleteRung(project, { routineId: rid, rungId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      setSelection(selectRungNearDeleted(project, result.project, rid, rungId));
    } else {
      push("error", result.error ?? "Could not delete rung.");
    }
  };
  const handleCopyRung = (rungId: string) => {
    const rung = openLadder?.rungs.find((r) => r.id === rungId);
    if (rung) {
      setClipboardRung({ root: rung.root, comment: rung.comment });
      push("info", `Copied rung ${rung.number}.`);
    }
  };
  const handleDuplicateRung = (rungId: string) => {
    if (blockControllerLockedEdit("Duplicate rung")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = duplicateRung(project, { routineId: rid, rungId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data?.rungId) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    } else {
      push("error", result.error ?? "Could not duplicate rung.");
    }
  };
  const handleSetRungComment = (rungId: string, comment: string, routineId?: string) =>
    applyAction((p) => setRungComment(p, { routineId: targetRoutineId(p, routineId), rungId, comment }), "Edit rung comment");
  const handleCutRung = (rungId: string) => {
    if (blockControllerLockedEdit("Cut rung")) return;
    handleCopyRung(rungId);
    handleDeleteRung(rungId);
  };
  const handlePasteRung = () => {
    if (blockControllerLockedEdit("Paste rung")) return;
    if (!clipboardRung) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = pasteRung(project, {
      routineId: rid,
      root: clipboardRung.root,
      comment: clipboardRung.comment,
    });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    }
  };
  const handleInsertRung = (rungId: string, position: "above" | "below") => {
    if (blockControllerLockedEdit("Insert rung")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = insertRung(project, { routineId: rid, rungId, position });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    } else {
      push("error", result.error ?? "Could not insert rung.");
    }
  };
  const handlePasteRungRelative = (rungId: string, position: "above" | "below") => {
    if (blockControllerLockedEdit("Paste rung")) return;
    if (!clipboardRung) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = pasteRung(project, {
      routineId: rid,
      root: clipboardRung.root,
      comment: clipboardRung.comment,
      rungId,
      position,
    });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    } else {
      push("error", result.error ?? "Could not paste rung.");
    }
  };
  const handleVerifyRung = (rungId: string) => {
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = verifyRung(project, { routineId: rid, rungId });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not verify rung.");
      return;
    }
    openDockTab("build");
    const { rungNumber, errorCount, warningCount } = result.data;
    const summary = buildSummaryLine(errorCount, warningCount);
    if (errorCount) push("error", `Rung ${rungNumber}: ${summary}.`);
    else if (warningCount) push("warning", `Rung ${rungNumber}: ${summary}.`);
    else push("success", `Rung ${rungNumber}: ${summary} — verification passed in Offline Simulation.`);
    logActivity("info", `Verified rung ${rungNumber} of "${result.data.routineName}": ${summary}.`);
  };
  const handleCrossReferenceRung = (rungId: string) => {
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = crossReferenceRung(project, { routineId: rid, rungId });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not cross reference rung.");
      return;
    }
    const { tags, rungNumber } = result.data;
    if (tags.length === 0) {
      openDockTab("references");
      push("info", `Rung ${rungNumber} has no tag references to cross reference.`);
      return;
    }
    // Open the references dock focused on the first tag used on the rung; the
    // dock shows every place that tag (and the rung's others) are referenced.
    openTagDock(tags[0]!, "references", `Cross Reference for rung ${rungNumber}`);
  };
  const handleSelectRung = (rungId: string) => {
    setSelection({ kind: "rung", routineId: openRoutineId ?? "", rungId });
    setCopilotTab("history");
  };
  const handleSelectNode = (rungId: string, nodeId: string) => {
    setSelection({ kind: "instruction", routineId: openRoutineId ?? "", rungId, nodeId });
    setCopilotTab("history");
  };
  const handleAddInstruction = (rungId: string, type: string) => {
    if (blockControllerLockedEdit("Add instruction")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = addInstruction(project, { routineId: rid, rungId, instructionType: type });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data?.nodeId) setSelection({ kind: "instruction", routineId: rid, rungId, nodeId: result.data.nodeId });
      for (const warning of result.warnings?.slice(0, 1) ?? []) push("warning", warning);
    } else {
      push("error", result.error ?? "Could not add instruction.");
    }
  };
  const handleEditOperand = (rungId: string, nodeId: string, index: number, value: string, routineId?: string) =>
    applyAction((p) => updateInstructionOperand(p, { routineId: targetRoutineId(p, routineId), rungId, nodeId, index, value }), "Edit operand");
  const handleRemoveInstruction = (rungId: string, nodeId: string) => {
    if (blockControllerLockedEdit("Delete instruction")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = removeInstruction(project, { routineId: rid, rungId, nodeId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      setSelection(selectInstructionNearDeleted(project, result.project, rid, rungId, nodeId));
    } else {
      push("error", result.error ?? "Could not delete instruction.");
    }
  };
  const handleCreateTag = (name: string, dataType: string) =>
    applyAction((p) => createTag(p, { name, dataType }), "Create tag");
  /**
   * "Insert Instruction Before/After": select the anchor rung, remember the
   * insertion target, and open the Add Ladder Element picker. When the picker
   * confirms, the chosen instruction is inserted relative to the anchor node via
   * the insertInstruction action instead of being appended to the rung.
   */
  const handleInsertInstructionElement = (rungId: string, nodeId: string, position: "before" | "after") => {
    if (blockControllerLockedEdit("Insert instruction")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    handleSelectRung(rungId);
    setInstructionInsertTarget({ kind: "relative", routineId: rid, rungId, nodeId, position });
    setInstructionPickerOpen(true);
  };
  const handlePickInstructionForBranch = (rungId: string, branchId: string) => {
    if (blockControllerLockedEdit("Add instruction")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    handleSelectRung(rungId);
    setInstructionInsertTarget({ kind: "branch", routineId: rid, rungId, branchId });
    setInstructionPickerOpen(true);
  };
  const handleInsertInstructionType = (type: string) => {
    if (blockControllerLockedEdit("Insert instruction")) return true;
    const target = instructionInsertTarget;
    if (!target) return false;
    const rid = targetRoutineId(project, target.routineId);
    if (!rid) return true;
    const result =
      target.kind === "branch"
        ? addInstructionToBranch(project, {
            routineId: rid,
            rungId: target.rungId,
            branchId: target.branchId,
            instructionType: type,
          })
        : target.kind === "rung"
          ? addInstruction(project, {
              routineId: rid,
              rungId: target.rungId,
              instructionType: type,
            })
        : insertInstruction(project, {
            routineId: rid,
            rungId: target.rungId,
            nodeId: target.nodeId,
            instructionType: type,
            position: target.position,
          });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      if (result.data?.nodeId) {
        setSelection({ kind: "instruction", routineId: rid, rungId: target.rungId, nodeId: result.data.nodeId });
      }
      for (const warning of result.warnings?.slice(0, 1) ?? []) push("warning", warning);
    } else {
      push("error", result.error ?? "Could not insert instruction.");
    }
    setInstructionInsertTarget(null);
    return true;
  };
  const handleUnforceTag = (tagName: string) => {
    const resolved = resolveTagReference(tagName);
    if (!resolved) {
      push("warning", `Tag ${tagName} is not defined in this project.`);
      return;
    }
    const { tag, path } = resolved;
    if (!(path in forces)) {
      push("info", `${path} is not forced.`);
      return;
    }
    setSelection({ kind: "tag", id: tag.id });
    setForces((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    openDockTab("forces");
    push("success", `Removed force on ${path}.`);
  };
  /**
   * "Create Tag" quick fix from a missing operand. Prefills the New Tag dialog
   * with the operand's base name and the data type inferred from the
   * instruction (BOOL for bit instructions, TIMER for TON/TOF/RTO, COUNTER for
   * CTU/CTD, …), defaulting scope to the routine's owning program so the new tag
   * lands where the logic lives. The dialog still lets the user switch to
   * controller scope or change the type before creating.
   */
  const handleCreateTagFromOperand = (instructionType: string, baseName: string, operandIndex = 0) => {
    if (blockControllerLockedEdit("Create tag")) return;
    const programId = openRoutine?.programId;
    setNewTagDefaults({
      scope: programId ? "program" : "controller",
      programId,
      name: baseName,
      dataType: inferOperandTagType(instructionType, operandIndex, instructionRegistry),
    });
    setNewTagDialogOpen(true);
  };

  const handleAddParallelBranch = (rungId: string, branchId?: string) => {
    if (blockControllerLockedEdit("Add branch")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = addParallelBranch(project, { routineId: rid, rungId, branchId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      setSelection({ kind: "rung", routineId: rid, rungId });
    } else {
      push("error", result.error ?? "Could not add branch.");
    }
  };
  const handleAddBranchLeg = (rungId: string, branchId?: string) => {
    if (blockControllerLockedEdit("Add branch leg")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = addBranchLeg(project, { routineId: rid, rungId, branchId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      setSelection({ kind: "rung", routineId: rid, rungId });
    } else {
      push("error", result.error ?? "Could not add branch leg.");
    }
  };
  const handleRemoveBranchLeg = (rungId: string, branchId: string) => {
    if (blockControllerLockedEdit("Remove branch leg")) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = removeBranchLeg(project, { routineId: rid, rungId, branchId });
    if (result.ok) {
      commitLadderStructureEdit(result.project);
      setSelection({ kind: "rung", routineId: rid, rungId });
    } else {
      push("error", result.error ?? "Could not remove branch leg.");
    }
  };
  const handleSetStructuredTextSource = (routineId: string, source: string) => {
    if (blockControllerLockedEdit("Edit Structured Text")) return;
    const result = setStructuredTextSource(project, { routineId, source });
    if (!result.ok) {
      push("error", result.error ?? "Failed to update Structured Text.");
      return;
    }
    setProject(result.project);
    for (const warning of result.warnings?.slice(0, 1) ?? []) push("warning", warning);
    push("success", "Structured Text source updated.");
  };

  // ---- Tag table editor (toast on failure; reset values when the tag set changes) ----
  const runTagAction = (result: ProjectActionResult, successMsg?: string, resyncValues = true) => {
    if (blockControllerLockedEdit("Edit tags")) return;
    if (result.ok) {
      setProject(result.project);
      if (resyncValues) {
        setValues(zeroValues(result.project));
        setTrendSamples([]);
      }
      if (successMsg) push("success", successMsg);
    } else {
      push("error", result.error ?? "Tag action failed.");
    }
  };
  const tagTarget = (tag: Tag) => ({
    name: tag.name,
    scope: tag.scope,
    programId: tag.programId,
  });
  const handleAddTag = (
    name: string,
    dataType: string,
    description: string,
    dimensions: number[] = [],
    scope: "controller" | "program" = "controller",
    programId?: string,
  ) =>
    runTagAction(
      createTag(project, {
        name,
        dataType,
        scope,
        ...(programId ? { programId } : {}),
        description: description || undefined,
        ...(dimensions.length ? { dimensions } : {}),
      }),
      `Created tag ${name}.`,
    );
  const handleCreateTagFromDialog = (input: NewTagInput) => {
    if (blockControllerLockedEdit("Create tag")) return;
    const result = createTag(project, {
      name: input.name,
      dataType: input.dataType,
      scope: input.scope,
      ...(input.programId ? { programId: input.programId } : {}),
      description: input.description,
      ...(input.dimensions?.length ? { dimensions: input.dimensions } : {}),
      ...(input.externalAccess ? { externalAccess: input.externalAccess } : {}),
      ...(input.constant ? { constant: true } : {}),
    });
    if (!result.ok) {
      push("error", result.error ?? "Could not create tag.");
      return;
    }
    let nextProject = result.project;
    if (input.radix) {
      const metadataResult = setTagMetadata(nextProject, {
        name: input.name,
        scope: input.scope,
        ...(input.programId ? { programId: input.programId } : {}),
        radix: input.radix,
      });
      if (metadataResult.ok) {
        nextProject = metadataResult.project;
      } else {
        push("warning", metadataResult.error ?? "Tag style was not applied.");
      }
    }
    if (input.aliasFor?.trim()) {
      const aliasResult = setTagAlias(nextProject, {
        name: input.name,
        scope: input.scope,
        ...(input.programId ? { programId: input.programId } : {}),
        aliasFor: input.aliasFor.trim(),
      });
      if (aliasResult.ok) {
        nextProject = aliasResult.project;
      } else {
        push("warning", aliasResult.error ?? "Tag alias was not applied.");
      }
    }
    setProject(nextProject);
    setValues(zeroValues(nextProject));
    setTrendSamples([]);
    setNewTagDialogOpen(false);
    if (input.openConfiguration) setView("tags");
    if (result.data?.tagId) setSelection({ kind: "tag", id: result.data.tagId });
    push("success", `Created tag ${input.name}.`);
  };
  const handleOpenNewTagDialog = (scope: "controller" | "program" = "controller", programId?: string) => {
    setNewTagDefaults({ scope, programId });
    setNewTagDialogOpen(true);
  };
  const handleMonitorTags = (scope: "controller" | "program" = "controller", programId?: string) => {
    if (scope === "program" && programId) {
      setSelection({ kind: "tag", id: `${programId}:program-tags` });
    } else {
      const controller = project.controllers[0];
      setSelection({ kind: "tag", id: controller?.controllerTags[0]?.id ?? `${controller?.id ?? project.id}:controller-tags` });
    }
    openDockTab("watch");
    push("info", scope === "program" ? "Program tag monitor opened." : "Controller tag monitor opened.");
  };
  const handleRenameTag = (tag: Tag, to: string) =>
    runTagAction(renameTag(project, { from: tag.name, to, scope: tag.scope, programId: tag.programId }), `Renamed ${tag.name} → ${to}.`);
  const handleDeleteTag = (tag: Tag) =>
    runTagAction(deleteTag(project, tagTarget(tag)), `Deleted tag ${tag.name}.`);
  const handleEditDescription = (tag: Tag, description: string) =>
    runTagAction(setTagDescription(project, { ...tagTarget(tag), description }), undefined, false);
  const handleSetTagDataType = (tag: Tag, dataType: string) =>
    runTagAction(setTagDataType(project, { ...tagTarget(tag), dataType }), undefined, true);
  const handleSetTagDimensions = (tag: Tag, dimensions: number[]) =>
    runTagAction(
      setTagDimensions(project, { ...tagTarget(tag), dimensions }),
      undefined,
      true,
    );
  const handleSetTagMetadata = (tag: Tag, patch: { externalAccess?: ExternalAccess | ""; constant?: boolean; radix?: string }) =>
    runTagAction(setTagMetadata(project, { ...tagTarget(tag), ...patch }), undefined, false);
  const handleSetTagAlias = (tag: Tag, aliasFor: string) =>
    runTagAction(
      setTagAlias(project, { ...tagTarget(tag), aliasFor: aliasFor.trim() || undefined }),
      aliasFor.trim() ? `${tag.name} now aliases ${aliasFor.trim()}.` : `Cleared alias on ${tag.name}.`,
      false,
    );
  const handleSetTagComments = (tag: Tag, comments: TagComment[]) =>
    runTagAction(
      setTagComments(project, { ...tagTarget(tag), comments }),
      `Updated comments for ${tag.name}.`,
      false,
    );
  const handleSetTagEngineeringUnits = (tag: Tag, engineeringUnits: TagEngineeringUnit[]) =>
    runTagAction(
      setTagEngineeringUnits(project, { ...tagTarget(tag), engineeringUnits }),
      `Updated engineering units for ${tag.name}.`,
      false,
    );

  // ---- Undo / redo (reverts project edits; simulation values resync) ----
  const handleUndo = () => {
    if (!history.canUndo) return;
    if (history.undoTarget) {
      setValues(zeroValues(history.undoTarget));
      repairRoutineWorkspaceForProject(history.undoTarget);
    }
    setTrendSamples([]);
    history.undo();
  };
  const handleRedo = () => {
    if (!history.canRedo) return;
    if (history.redoTarget) {
      setValues(zeroValues(history.redoTarget));
      repairRoutineWorkspaceForProject(history.redoTarget);
    }
    setTrendSamples([]);
    history.redo();
  };

  // ---- Simulation ----
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleSetNumber = (name: string, value: number) =>
    setValues((current) => ({ ...current, [name]: value }));
  const handleSetString = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));
  const handleSetMonitorValue = (name: string, value: TagValues[string]) => {
    setValues((current) => ({ ...current, [name]: value }));
    setForces((current) => (name in current ? { ...current, [name]: value } : current));
  };
  const captureTrend = (nextProject: PlcProject, nextValues: TagValues) => {
    const sample = createTrendSample(watchRows(nextProject, nextValues));
    setTrendSamples((samples) => [...samples, sample].slice(-TREND_BUFFER_LIMIT));
  };
  /** Record one offline task scan cycle into the per-task statistics. */
  const recordTaskScanCycle = (forProject: PlcProject, scannedTaskKeys?: readonly string[]) => {
    const report = controllerTaskStatusReport(forProject);
    const seq = (taskScanSeqRef.current += 1);
    setTaskScanStats((stats) =>
      recordOfflineScan(stats, report, { at: new Date().toISOString(), seq, scannedKeys: scannedTaskKeys }).stats,
    );
  };
  const handleScanOnce = () => {
    const scan = scheduledScanOnce(project, values, taskSchedulerStateRef.current, forces, SCAN_INTERVAL_MS);
    taskSchedulerStateRef.current = scan.schedulerState;
    const nextValues = scan.values;
    setValues(nextValues);
    captureTrend(project, nextValues);
    recordTaskScanCycle(project, scan.scannedTaskKeys);
  };
  const handleTriggerEventTaskScan = (taskKey: string) => {
    const scan = scheduledScanOnce(project, values, taskSchedulerStateRef.current, forces, SCAN_INTERVAL_MS, [taskKey]);
    taskSchedulerStateRef.current = scan.schedulerState;
    const nextValues = scan.values;
    setValues(nextValues);
    captureTrend(project, nextValues);
    recordTaskScanCycle(project, scan.scannedTaskKeys);
  };
  const handleReset = () => {
    setValues(zeroValues(project));
    setTrendSamples([]);
    taskSchedulerStateRef.current = createOfflineTaskSchedulerState();
  };
  const handleResetTaskStats = () => {
    taskScanSeqRef.current = 0;
    taskSchedulerStateRef.current = createOfflineTaskSchedulerState();
    setTaskScanStats(resetTaskScanStats());
  };

  // ---- Force table (offline simulation override) ----
  const handleToggleForce = (name: string) =>
    setForces((current) => {
      const next = { ...current };
      if (name in next) delete next[name];
      else next[name] = values[name] ?? false; // pin the current value
      return next;
    });
  const handleClearForces = () => setForces({});

  // ---- AI assistant: apply a previewed plan through the action layer ----
  const handleApplyPlan = (plan: AssistantPlan): ApplyResult => {
    const result = applyPlan(project, plan);
    if (result.ok) {
      setProject(result.project);
      setValues(zeroValues(result.project));
      setTrendSamples([]);
    }
    // Audit trail: record both applied plans (with the reviewed action labels) and
    // applies the action layer blocked.
    logActivity(
      "ai",
      aiApplyActivityMessage(plan.title, {
        ok: result.ok,
        appliedCount: result.applied.length,
        actionLabels: plan.actions.map((action) => action.label),
        error: result.error,
      }),
    );
    return result;
  };
  const selectedTag = selection?.kind === "tag"
    ? allTags.find((tag) => tag.id === selection.id)
    : undefined;
  const selectedTagPath = selectedTag ? tagValuePath(selectedTag) : undefined;
  const selectedTagName = selectedTagPath;
  const selectedRoutineForCrossReference =
    selection?.kind === "routine"
      ? selection.id
      : selection?.kind === "rung" || selection?.kind === "instruction"
        ? selection.routineId
        : undefined;
  const selectedRoutineNameForCrossReference = selectedRoutineForCrossReference
    ? findRoutine(project, selectedRoutineForCrossReference)?.name
    : undefined;
  const openTagDock = (tagName: string, tab: DockTab, actionLabel: string) => {
    const resolved = resolveTagReference(tagName);
    if (!resolved) {
      push("warning", `Tag ${tagName} is not defined in this project.`);
      return undefined;
    }
    const { tag, path } = resolved;
    setSelection({ kind: "tag", id: tag.id });
    openDockTab(tab);
    push("info", `${actionLabel}: ${path}.`);
    return resolved;
  };
  const handleEditTagProperties = (tagName: string) => {
    const resolved = resolveTagReference(tagName);
    if (!resolved) {
      push("warning", `Tag ${tagName} is not defined in this project.`);
      return;
    }
    setSelection({ kind: "tag", id: resolved.tag.id });
    setView("tags");
    setCopilotTab("history");
    push("info", `Tag properties opened: ${resolved.path}.`);
  };
  const handleWatchTag = (tagName: string) => openTagDock(tagName, "watch", "Watch opened");
  const handleCrossReferenceTag = (tagName: string) => openTagDock(tagName, "references", "Cross Reference opened");
  const handleForceTag = (tagName: string) => {
    const resolved = openTagDock(tagName, "forces", "Force armed");
    if (!resolved) return;
    const { path } = resolved;
    setForces((current) => (path in current ? current : { ...current, [path]: values[path] ?? false }));
  };
  const handleToggleBit = (tagName: string) => {
    const resolved = resolveTagReference(tagName);
    if (!resolved) {
      push("warning", `Tag ${tagName} is not defined in this project.`);
      return;
    }
    const { tag, path } = resolved;
    const currentValue = values[path];
    const forcedValue = forces[path];
    const forced = path in forces;
    const isBoolTag = tag.dataType.toUpperCase() === "BOOL";
    const isArrayTag = Boolean(tag.dimension && tag.dimension > 0) || Boolean(tag.dimensions?.length);
    const canToggle = (isBoolTag && !isArrayTag) || typeof currentValue === "boolean";
    if (!canToggle) {
      push("warning", `${path} is ${tag.dataType}; Toggle Bit only supports BOOL values.`);
      return;
    }
    if (forced && typeof forcedValue !== "boolean") {
      push("warning", `${path} is forced to a non-BOOL value; clear the force before toggling.`);
      return;
    }
    const nextValue = !(typeof forcedValue === "boolean" ? forcedValue : currentValue === true);
    setSelection({ kind: "tag", id: tag.id });
    setValues((current) => ({ ...current, [path]: nextValue }));
    setForces((current) => (path in current ? { ...current, [path]: nextValue } : current));
    push("success", `${path} toggled ${nextValue ? "true" : "false"}.`);
  };
  const handleTrendTag = (tagName: string) => openTagDock(tagName, "trend", "Trend opened");
  const handleInstructionHelp = (instructionType: string, operand: string) => {
    const type = instructionType.trim().toUpperCase();
    const definition = instructionRegistry.get(type);
    const operands = definition?.operands
      .map((item) => {
        const access = item.direction === "write" ? "write" : "read";
        const types = item.allowedTypes?.length ? ` (${item.allowedTypes.join("/")})` : "";
        return `${item.label}${types}, ${access}${item.required ? "" : ", optional"}`;
      })
      .join("; ");
    const selectedOperand = operand.trim();
    showDialogHelp(
      definition ? `${definition.displayName} (${definition.type})` : `${type || "Instruction"} Help`,
      [
        definition?.description ?? "This instruction is not registered in the offline instruction catalog.",
        operands ? `Operands: ${operands}.` : "No operand metadata is registered for this instruction.",
        definition?.modelOnly
          ? "Offline Simulation preserves this instruction but does not execute it."
          : definition
            ? "Offline Simulation executes this instruction when its operands validate."
            : "Unsupported instructions are preserved in the project model but are not simulated.",
        selectedOperand ? `Selected operand: ${selectedOperand}.` : "",
      ].filter(Boolean).join(" "),
    );
    push("info", `Instruction help opened: ${type || instructionType}.`);
  };
  const handleOpenRoutine = (routineId: string) => openRoutineWindow(routineId);
  const handleOpenDiagnosticTarget = (finding: ValidationFinding) => {
    const target = resolveValidationFindingTarget(project, finding);
    if (!target.openable) {
      push("warning", `No openable project item was found for ${finding.target ?? finding.ruleId}.`);
      return;
    }

    switch (target.kind) {
      case "project":
        setSelection({ kind: "project", id: project.id });
        setView("structure");
        break;
      case "controller":
        if (target.controllerId) setSelection({ kind: "controller", id: target.controllerId });
        setView("structure");
        break;
      case "program":
        if (target.programId) setSelection({ kind: "program", id: target.programId });
        setView("structure");
        break;
      case "routine":
        if (target.routineId) handleOpenRoutine(target.routineId);
        break;
      case "task":
        if (target.taskId) setSelection({ kind: "task", id: target.taskId });
        setView("structure");
        break;
      case "tag":
        if (target.tagId) setSelection({ kind: "tag", id: target.tagId });
        setView("tags");
        break;
      case "io-module":
        if (target.controllerId && target.moduleId) {
          handleIoModuleProperties(target.controllerId, target.moduleId);
        } else if (target.controllerId) {
          setSelection({ kind: "io", controllerId: target.controllerId });
          setView("structure");
        }
        break;
      case "aoi":
        if (target.aoiName) setSelection({ kind: "aoi", id: target.aoiName });
        setView("structure");
        break;
      case "udt":
        if (target.udtName) setSelection({ kind: "udt", id: target.udtName });
        setView("structure");
        break;
      default:
        push("warning", `No openable project item was found for ${finding.target ?? finding.ruleId}.`);
        return;
    }
    push("info", `Opened diagnostics target ${target.path}.`);
  };
  const handleCloseRoutineWindow = (routineId: string) => {
    const previousIds = openRoutineTabs.length
      ? openRoutineTabs.map((routine) => routine.id)
      : openRoutineWindowIds;
    const closingIndex = previousIds.indexOf(routineId);
    const nextIds = previousIds.filter((id) => id !== routineId);
    setOpenRoutineWindowIds(nextIds);
    if (openRoutineId !== routineId) return;

    const fallbackId =
      previousIds[closingIndex + 1] ??
      previousIds[closingIndex - 1] ??
      nextIds[0];
    if (fallbackId && findRoutine(project, fallbackId)) {
      setOpenRoutineId(fallbackId);
      setSelection({ kind: "routine", id: fallbackId });
      setView("routine");
      return;
    }

    setOpenRoutineId(undefined);
    setSelection(activeContext.controller ? { kind: "controller", id: activeContext.controller.id } : null);
    setView("welcome");
    setCopilotTab("history");
  };
  const handleProjectProperties = () => {
    setSelection({ kind: "project", id: project.id });
    setCopilotTab("history");
    setProjectPropertiesOpen(true);
  };
  const handleSaveProjectProperties = (input: { name: string; description?: string }, options: { close?: boolean } = { close: true }) => {
    const result = setProjectProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update project properties.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) setProjectPropertiesOpen(false);
    push("success", "Project properties updated.");
  };
  const handleControllerProperties = (controllerId?: string) => {
    const controller =
      (controllerId ? project.controllers.find((candidate) => candidate.id === controllerId) : undefined) ??
      activeContext.controller ??
      project.controllers[0];
    if (!controller) {
      push("info", "Create or import a project first.");
      return;
    }
    setControllerPropertiesControllerId(controller.id);
    setSelection({ kind: "controller", id: controller.id });
    setCopilotTab("history");
    setControllerPropertiesOpen(true);
  };
  const handleSaveControllerProperties = (input: ControllerPropertiesInput, options: { close?: boolean } = { close: true }) => {
    const result = setControllerProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update controller properties.");
      return;
    }

    const originalController = project.controllers.find((controller) => controller.id === input.controllerId);
    let nextProject = result.project;
    const updatedController = nextProject.controllers.find((controller) => controller.id === input.controllerId);
    const processorModule = originalController?.ioConfiguration.modules.find((module) =>
      isControllerProcessorModule(module, originalController),
    );

    if (processorModule && updatedController) {
      const moduleResult = updateIoModule(nextProject, {
        controllerId: updatedController.id,
        moduleId: processorModule.id,
        name: updatedController.name,
        catalogNumber: updatedController.catalogNumber ?? processorModule.catalogNumber,
        slot: updatedController.slot,
        description: processorModule.description,
        parentModule: processorModule.parentModule,
        parentPortId: processorModule.parentPortId,
        commPath: processorModule.commPath,
        vendor: processorModule.vendor,
        productType: controllerProcessorProductType(updatedController),
        productCode: processorModule.productCode,
        majorRevision: processorModule.majorRevision,
        minorRevision: processorModule.minorRevision,
        electronicKeying: processorModule.electronicKeying,
        inhibited: processorModule.inhibited,
      });
      if (!moduleResult.ok) {
        push("error", moduleResult.error ?? "Could not update the controller slot module.");
        return;
      }
      nextProject = moduleResult.project;
    }

    setProject(nextProject);
    if (options.close !== false) {
      setControllerPropertiesOpen(false);
      setControllerPropertiesControllerId(undefined);
    }
    push("success", "Controller properties updated.");
  };
  const handleNewRoutine = (programId?: string) => {
    const targetProgramId = programId ?? activeContext.program?.id ?? project.controllers[0]?.programs[0]?.id;
    if (!targetProgramId) {
      push("info", "Create or import a controller program first.");
      return;
    }
    setNewRoutineProgramId(targetProgramId);
  };
  const handleCreateRoutine = (input: NewRoutineInput) => {
    const created = createRoutineAction(project, {
      programId: input.programId,
      name: input.name,
      language: input.language,
    });
    if (!created.ok || !created.data?.routineId) {
      push("error", created.error ?? "Could not create routine.");
      return;
    }

    let nextProject = created.project;
    const routineId = created.data.routineId;
    if (input.language === "ladder") {
      const rungResult = addRung(nextProject, { routineId });
      if (!rungResult.ok) {
        push("error", rungResult.error ?? "Could not create the first ladder rung.");
        return;
      }
      nextProject = rungResult.project;
    }
    if (input.description) {
      const propsResult = setRoutineProperties(nextProject, {
        routineId,
        name: input.name,
        description: input.description,
      });
      if (!propsResult.ok) {
        push("error", propsResult.error ?? "Could not update routine properties.");
        return;
      }
      nextProject = propsResult.project;
    }

    setProject(nextProject);
    setNewRoutineProgramId(undefined);
    openRoutineWindow(routineId);
    setCopilotTab("history");
    push("success", `Routine "${input.name}" created.`);
  };
  const handleNewProgram = (controllerId: string, taskId?: string) => {
    setSelection({ kind: "controller", id: controllerId });
    setNewProgramTarget({ controllerId, taskId });
  };
  const handleCreateProgram = (input: NewProgramInput) => {
    const result = createProgramAction(project, input);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not create program.");
      return;
    }
    setProject(result.project);
    setNewProgramTarget(undefined);
    setSelection({ kind: "program", id: result.data.programId });
    push("success", `Program "${result.data.programName}" created.`);
  };
  const handleRoutineProperties = (routineId?: string) => {
    const targetRoutineId = routineId ?? openRoutineId ?? findMainRoutine(project)?.id;
    if (!targetRoutineId) {
      push("info", "Open or select a routine first.");
      return;
    }
    setSelection({ kind: "routine", id: targetRoutineId });
    setRoutinePropertiesRoutineId(targetRoutineId);
  };
  const handleSaveRoutineProperties = (input: RoutinePropertiesInput, options: { close?: boolean } = { close: true }) => {
    const result = setRoutineProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update routine properties.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) setRoutinePropertiesRoutineId(undefined);
    if (openRoutineId === input.routineId) setOpenRoutineId(input.routineId);
    setSelection({ kind: "routine", id: input.routineId });
    push("success", "Routine properties updated.");
  };
  const handleDeleteRoutine = async (routineId: string) => {
    const owner = project.controllers
      .flatMap((controller) => controller.programs.map((program) => ({ controller, program })))
      .find(({ program }) => program.routines.some((routine) => routine.id === routineId));
    const routine = owner?.program.routines.find((candidate) => candidate.id === routineId);
    if (!owner || !routine) {
      push("error", "Routine not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Routine",
        message: `Delete routine "${routine.name}" from "${owner.program.name}"?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteRoutine(project, { routineId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete routine.");
      return;
    }
    setProject(result.project);
    setOpenRoutineWindowIds((current) => current.filter((id) => id !== routineId && Boolean(findRoutine(result.project, id))));
    if (openRoutineId === routineId) setOpenRoutineId(undefined);
    setSelection({ kind: "program", id: owner.program.id });
    setView("structure");
    push("success", `Deleted routine ${result.data?.routineName ?? routine.name}.`);
  };
  const handleVerifyRoutine = (routineId: string) => {
    openRoutineWindow(routineId);
    openDockTab("build");
    // Scope the verify to just this routine's node in the build report so the
    // result reflects the routine the engineer asked about, not the whole project.
    const owner = project.controllers
      .flatMap((controller) => controller.programs.map((program) => ({ controller, program })))
      .find(({ program }) => program.routines.some((routine) => routine.id === routineId));
    const routine = owner?.program.routines.find((candidate) => candidate.id === routineId);
    if (!owner || !routine) {
      push("error", "Routine not found.");
      return;
    }
    const report = verifyProjectReport(project, findings);
    const step = findBuildStep(report, `${owner.controller.name}/${owner.program.name}/${routine.name}`);
    const routineErrors = step?.errorCount ?? 0;
    const routineWarnings = step?.warningCount ?? 0;
    const summary = buildSummaryLine(routineErrors, routineWarnings);
    if (routineErrors) {
      push("error", `Routine "${routine.name}": ${summary}.`);
    } else if (routineWarnings) {
      push("warning", `Routine "${routine.name}": ${summary}.`);
    } else {
      push("success", `Routine "${routine.name}": ${summary} — verification passed in Offline Simulation.`);
    }
    logActivity("info", `Verified routine "${routine.name}": ${summary}.`);
  };
  const handleCrossReferenceRoutine = (routineId: string) => {
    openRoutineWindow(routineId);
    openDockTab("references");
    push("info", "Cross Reference opened.");
  };
  const handleVerifyProgram = (programId: string) => {
    const owner = project.controllers
      .map((controller) => ({ controller, program: controller.programs.find((candidate) => candidate.id === programId) }))
      .find((entry) => entry.program);
    if (!owner?.program) {
      push("error", "Program not found.");
      return;
    }
    setSelection({ kind: "program", id: programId });
    setView("structure");
    openDockTab("build");
    const report = verifyProjectReport(project, findings);
    const step = findBuildStep(report, `${owner.controller.name}/${owner.program.name}`);
    const programErrors = step?.errorCount ?? 0;
    const programWarnings = step?.warningCount ?? 0;
    const summary = buildSummaryLine(programErrors, programWarnings);
    if (programErrors) {
      push("error", `Program "${owner.program.name}": ${summary}.`);
    } else if (programWarnings) {
      push("warning", `Program "${owner.program.name}": ${summary}.`);
    } else {
      push("success", `Program "${owner.program.name}": ${summary} — verification passed in Offline Simulation.`);
    }
    logActivity("info", `Verified program "${owner.program.name}": ${summary}.`);
  };
  const handleProgramProperties = (programId: string) => {
    setSelection({ kind: "program", id: programId });
    setProgramPropertiesProgramId(programId);
  };
  const handleSaveProgramProperties = (input: ProgramPropertiesInput, options: { close?: boolean } = { close: true }) => {
    const result = setProgramProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update program properties.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) setProgramPropertiesProgramId(undefined);
    setSelection({ kind: "program", id: input.programId });
    push("success", "Program properties updated.");
  };
  const handleDeleteProgram = async (programId: string) => {
    const owner = project.controllers
      .map((controller) => ({ controller, program: controller.programs.find((candidate) => candidate.id === programId) }))
      .find((entry) => entry.program);
    if (!owner?.program) {
      push("error", "Program not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Program",
        message: `Delete program "${owner.program.name}" and its routines/tags?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteProgram(project, { programId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete program.");
      return;
    }
    setProject(result.project);
    setValues(zeroValues(result.project));
    setForces({});
    setTrendSamples([]);
    const deletedRoutineIds = new Set(owner.program.routines.map((routine) => routine.id));
    setOpenRoutineWindowIds((current) =>
      current.filter((routineId) => !deletedRoutineIds.has(routineId) && Boolean(findRoutine(result.project, routineId))),
    );
    if (owner.program.routines.some((routine) => routine.id === openRoutineId)) setOpenRoutineId(undefined);
    setSelection({ kind: "controller", id: owner.controller.id });
    setView("structure");
    push("success", `Deleted program ${result.data?.programName ?? owner.program.name}.`);
  };
  const handleTaskProperties = (taskId: string) => {
    setSelection({ kind: "task", id: taskId });
    setTaskPropertiesTaskId(taskId);
  };
  const handleAddExistingProgram = (taskId: string) => {
    setSelection({ kind: "task", id: taskId });
    setAddExistingProgramTaskId(taskId);
  };
  const handleMonitorTasks = () => {
    openDockTab("tasks");
    push("info", "Task Monitor opened.");
  };
  const handleNewTask = (controllerId: string) => {
    setSelection({ kind: "controller", id: controllerId });
    setNewTaskControllerId(controllerId);
  };
  const handleCreateTask = (input: NewTaskInput) => {
    const result = createTaskAction(project, input);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not create task.");
      return;
    }
    setProject(result.project);
    setNewTaskControllerId(undefined);
    setSelection({ kind: "task", id: result.data.taskId });
    setView("structure");
    push("success", `Created task ${result.data.taskName}.`);
  };
  const handleSaveTaskProperties = (input: TaskPropertiesInput, options: { close?: boolean } = { close: true }) => {
    const result = setTaskProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update task properties.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) setTaskPropertiesTaskId(undefined);
    setSelection({ kind: "task", id: input.taskId });
    push("success", "Task properties updated.");
  };
  const handleScheduleExistingProgram = (input: AddExistingProgramInput) => {
    const owner = project.controllers
      .map((controller) => ({ controller, task: controller.tasks.find((candidate) => candidate.id === input.taskId) }))
      .find((entry) => entry.task);
    const task = owner?.task;
    const program = owner?.controller.programs.find((candidate) => candidate.id === input.programId);
    if (!owner?.controller || !task || !program) {
      push("error", "Task or program not found.");
      return;
    }
    if (task.scheduledProgramIds.includes(program.id)) {
      setAddExistingProgramTaskId(undefined);
      push("info", `${program.name} is already scheduled in ${task.name}.`);
      return;
    }
    const result = setTaskProperties(project, {
      taskId: task.id,
      name: task.name,
      type: task.type,
      periodMs: task.periodMs,
      priority: task.priority,
      watchdogMs: task.watchdogMs,
      inhibited: task.inhibited,
      disableUpdateOutputs: task.disableUpdateOutputs,
      scheduledProgramIds: [...task.scheduledProgramIds, program.id],
    });
    if (!result.ok) {
      push("error", result.error ?? "Could not schedule existing program.");
      return;
    }
    setProject(result.project);
    setAddExistingProgramTaskId(undefined);
    setSelection({ kind: "task", id: task.id });
    setView("structure");
    push("success", `Scheduled existing program ${program.name} in ${task.name}.`);
  };
  const handleToggleTaskInhibit = (taskId: string) => {
    const owner = project.controllers
      .map((controller) => ({ controller, task: controller.tasks.find((candidate) => candidate.id === taskId) }))
      .find((entry) => entry.task);
    if (!owner?.task) {
      push("error", "Task not found.");
      return;
    }
    const task = owner.task;
    const result = setTaskProperties(project, {
      taskId,
      name: task.name,
      type: task.type,
      periodMs: task.periodMs,
      priority: task.priority,
      watchdogMs: task.watchdogMs,
      inhibited: task.inhibited !== true,
      disableUpdateOutputs: task.disableUpdateOutputs,
      scheduledProgramIds: task.scheduledProgramIds,
    });
    if (!result.ok) {
      push("error", result.error ?? "Could not update task inhibit state.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "task", id: taskId });
    setView("structure");
    push("success", `${task.name} ${task.inhibited === true ? "uninhibited" : "inhibited"}.`);
  };
  const handleDeleteTask = async (taskId: string) => {
    const owner = project.controllers
      .map((controller) => ({ controller, task: controller.tasks.find((candidate) => candidate.id === taskId) }))
      .find((entry) => entry.task);
    if (!owner?.task) {
      push("error", "Task not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Task",
        message: `Delete task "${owner.task.name}"? Scheduled programs remain in the project.`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteTask(project, { taskId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete task.");
      return;
    }
    setProject(result.project);
    setValues(zeroValues(result.project));
    setForces({});
    setTrendSamples([]);
    setSelection({ kind: "controller", id: owner.controller.id });
    setView("structure");
    push("success", `Deleted task ${result.data?.taskName ?? owner.task.name}.`);
  };
  const handleIoModuleProperties = (controllerId: string, moduleId: string) => {
    setSelection({ kind: "io", controllerId, moduleId });
    setIoModulePropertiesTarget({ controllerId, moduleId });
    setView("structure");
  };
  const handleIoModuleDiagnostics = (controllerId: string, moduleId: string) => {
    const target = findIoModuleContext(controllerId, moduleId);
    if (!target) return;
    setSelection({ kind: "io", controllerId, moduleId });
    setView("structure");
    openDockTab("diagnostics");
    push("info", `Diagnostics opened for ${target.module.name}.`);
  };
  const handleSelectionProperties = () => {
    if (!selection) {
      handleProjectProperties();
      return;
    }

    switch (selection.kind) {
      case "project":
        handleProjectProperties();
        break;
      case "controller":
        handleControllerProperties();
        break;
      case "task":
        handleTaskProperties(selection.id);
        break;
      case "program":
        handleProgramProperties(selection.id);
        break;
      case "routine":
        handleRoutineProperties(selection.id);
        break;
      case "io":
        if (selection.moduleId) handleIoModuleProperties(selection.controllerId, selection.moduleId);
        else handleControllerProperties();
        break;
      case "tag":
        setView("tags");
        setCopilotTab("history");
        push("info", "Tag editor opened for the selected tag.");
        break;
      case "aoi":
      case "udt":
        setView("structure");
        setCopilotTab("history");
        push("info", "Structure detail opened for the selected definition.");
        break;
      case "hmi":
      case "hmi-screen":
      case "hmi-popup":
      case "hmi-banner":
        setView("hmi");
        setCopilotTab("history");
        push("info", "HMI designer opened for the selected HMI item.");
        break;
      case "rung":
      case "instruction":
        handleRoutineProperties(selection.routineId);
        break;
      default:
        push("info", "No editable property sheet is available for the current selection.");
    }
  };
  const handleSaveIoModuleProperties = (input: IoModulePropertiesInput, options: { close?: boolean } = { close: true }) => {
    const result = updateIoModule(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update module properties.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) setIoModulePropertiesTarget(undefined);
    setSelection({ kind: "io", controllerId: input.controllerId, moduleId: input.moduleId });
    push("success", "Module properties updated.");
  };
  const handleNewIoModule = (controllerId: string, initialQuery?: string, initialSlot?: number) => {
    setSelection({ kind: "io", controllerId });
    setChangeIoModuleTarget(undefined);
    setNewIoModuleInitialQuery(initialQuery);
    setNewIoModuleInitialSlot(initialSlot);
    setNewIoModuleControllerId(controllerId);
  };
  const handleOpenChangeIoModule = (controllerId: string, moduleId: string) => {
    const target = findIoModuleContext(controllerId, moduleId);
    if (!target) {
      push("error", "I/O module not found.");
      return;
    }
    setSelection({ kind: "io", controllerId, moduleId });
    setIoModulePropertiesTarget(undefined);
    setChangeIoModuleTarget({ controllerId, moduleId });
    setNewIoModuleInitialQuery(target.module.catalogNumber ?? target.module.productType);
    setNewIoModuleInitialSlot(target.module.slot);
    setNewIoModuleControllerId(controllerId);
  };
  const handleCreateIoModule = (input: Parameters<typeof addIoModule>[1], options: { close?: boolean } = {}) => {
    const result = addIoModule(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not add I/O module.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) {
      setNewIoModuleControllerId(undefined);
      setNewIoModuleInitialSlot(undefined);
    }
    if (result.data) {
      setSelection({ kind: "io", controllerId: result.data.controllerId, moduleId: result.data.moduleId });
    }
    push(
      "success",
      result.data?.setupTagNames.length
        ? `Added module ${input.name} with ${result.data.setupTagNames.length} setup tag(s).`
        : `Added module ${input.name}.`,
    );
  };
  const handleChangeIoModule = (input: Parameters<typeof updateIoModule>[1], options: { close?: boolean } = {}) => {
    const result = updateIoModule(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not change I/O module.");
      return;
    }
    setProject(result.project);
    if (options.close !== false) {
      setNewIoModuleControllerId(undefined);
      setNewIoModuleInitialSlot(undefined);
      setNewIoModuleInitialQuery(undefined);
      setChangeIoModuleTarget(undefined);
    }
    setIoModulePropertiesTarget(undefined);
    setSelection({ kind: "io", controllerId: input.controllerId, moduleId: input.moduleId });
    push("success", `Changed module ${input.name} to ${input.catalogNumber ?? input.productType ?? "selected profile"}.`);
  };
  const findIoModuleContext = (controllerId: string, moduleId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    const module = controller?.ioConfiguration.modules.find((candidate) => candidate.id === moduleId);
    if (!controller || !module) {
      push("error", "I/O module not found.");
      return null;
    }
    return { controller, module };
  };
  const handleToggleIoModuleInhibit = (controllerId: string, moduleId: string) => {
    const target = findIoModuleContext(controllerId, moduleId);
    if (!target) return;
    const { controller, module } = target;
    setSelection({ kind: "io", controllerId, moduleId });
    if (isControllerProcessorModule(module, controller)) {
      push("warning", "Controller processor modules cannot be inhibited from the organizer.");
      return;
    }
    const result = updateIoModule(project, ioModuleToPropertiesInput(controllerId, module, { inhibited: module.inhibited !== true }));
    if (!result.ok) {
      push("error", result.error ?? "Could not update module inhibit state.");
      return;
    }
    setProject(result.project);
    push("success", `${module.name} ${module.inhibited === true ? "uninhibited" : "inhibited"}.`);
  };
  const handleDeleteIoModule = async (controllerId: string, moduleId: string) => {
    const target = findIoModuleContext(controllerId, moduleId);
    if (!target) return;
    const { controller, module } = target;
    setSelection({ kind: "io", controllerId, moduleId });
    if (isControllerProcessorModule(module, controller)) {
      push("warning", "Controller processor modules cannot be deleted from the I/O Configuration.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Module",
        message: `Delete module "${module.name}" from the I/O Configuration?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = removeIoModule(project, { controllerId, moduleId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete I/O module.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "io", controllerId });
    push("success", `Deleted module ${result.data?.moduleName ?? module.name}.`);
  };
  const showHmiWarnings = (result: ProjectActionResult) => {
    for (const warning of result.warnings?.slice(0, 2) ?? []) {
      push("warning", warning);
    }
  };
  const handleEnableHmiProject = () => {
    const result = ensureHmiProject(project);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to enable the HMI project.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "hmi", id: result.data.hmiProjectId });
    setView("hmi");
    push("success", "Enabled an empty HMI project model.");
    showHmiWarnings(result);
  };
  const handleCreateHmiScreen = (name: string) => {
    const result = createHmiScreenAction(project, { name });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to create HMI screen.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "hmi-screen", id: result.data.screenId });
    setView("hmi");
    push("success", `Created HMI screen "${name.trim()}".`);
    showHmiWarnings(result);
  };
  const handleCreateHmiPopup = (name: string) => {
    const result = createHmiPopupAction(project, { name });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to create HMI popup.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "hmi-popup", id: result.data.popupId });
    setView("hmi");
    push("success", `Created HMI popup "${name.trim()}".`);
    showHmiWarnings(result);
  };
  const handleAddHmiElement = (surfaceKind: HmiSurfaceKind, surfaceId: string, typeId: string) => {
    const result = addHmiElement(project, { surfaceKind, surfaceId, typeId });
    if (!result.ok) {
      push("error", result.error ?? "Failed to add HMI element.");
      return;
    }
    setProject(result.project);
    push("success", `Added ${typeId.replace(/^[^.]+\./, "")} to the HMI surface.`);
    showHmiWarnings(result);
  };
  const applyHmiEdit = (result: ProjectActionResult, successMessage?: string): boolean => {
    if (!result.ok) {
      push("error", result.error ?? "HMI edit failed.");
      return false;
    }
    setProject(result.project);
    if (successMessage) push("success", successMessage);
    showHmiWarnings(result);
    return true;
  };
  // Stable-enough ids for UI-created bindings/commands (unique within an element).
  const hmiLocalId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  const handleUpdateHmiElement = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    patch: ElementPatch,
  ) => applyHmiEdit(updateHmiElement(project, { surfaceKind, surfaceId, elementId, ...patch }));
  const handleUpdateHmiElementGeometry = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    geometry: HmiGraphicElement["geometry"],
  ) => applyHmiEdit(updateHmiElementGeometry(project, { surfaceKind, surfaceId, elementId, geometry }));
  const handleDeleteHmiElement = (surfaceKind: HmiSurfaceKind, surfaceId: string, elementId: string) =>
    applyHmiEdit(deleteHmiElement(project, { surfaceKind, surfaceId, elementId }), "Removed HMI element.");
  const handleSetHmiBinding = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    binding: BindingDraft,
  ) =>
    applyHmiEdit(
      setHmiElementBinding(project, {
        surfaceKind,
        surfaceId,
        elementId,
        binding: { ...binding, id: binding.id ?? hmiLocalId("hmibind") },
      }),
      "Updated HMI binding.",
    );
  const handleRemoveHmiBinding = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    bindingId: string,
  ) =>
    applyHmiEdit(
      removeHmiElementBinding(project, { surfaceKind, surfaceId, elementId, bindingId }),
      "Removed HMI binding.",
    );
  const handleAddHmiEventCommand = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    eventType: "press" | "release",
    command: EventCommandDraft,
  ) => {
    const toast =
      command.type === "navigate"
        ? "Added navigation event."
        : command.type === "open-popup"
          ? "Added open-popup command."
          : command.type === "close-popup"
            ? "Added close-popup command."
            : command.type === "set-tag-value"
              ? "Added set-tag-value command."
              : command.type === "change-language"
                ? "Added language command."
                : command.type === "export-data-log"
                  ? "Added data-log export command."
                  : command.type === "clear-data-log"
                    ? "Added data-log clear command."
                    : command.type === "apply-recipe"
                      ? "Added recipe apply command."
                    : command.type === "login-user"
                      ? "Added login command."
                      : "Added logout command.";
    return applyHmiEdit(
      addHmiEventCommand(project, {
        surfaceKind,
        surfaceId,
        elementId,
        eventType,
        command: {
          id: hmiLocalId("hmicmd"),
          type: command.type,
          safety: "runtime-preview",
          args: command.args,
        },
      }),
      toast,
    );
  };
  const handleRemoveHmiEventCommand = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    eventId: string,
    commandId: string,
  ) =>
    applyHmiEdit(
      removeHmiEventCommand(project, { surfaceKind, surfaceId, elementId, eventId, commandId }),
      "Removed event command.",
    );
  // ---- HMI alarm / trend / language authoring ----
  const handleCreateHmiAlarm = (input: Parameters<typeof createHmiAlarmDefinition>[1]) =>
    applyHmiEdit(createHmiAlarmDefinition(project, input), `Created HMI alarm "${input.name.trim()}".`);
  const handleUpdateHmiAlarm = (input: Parameters<typeof updateHmiAlarmDefinition>[1]) =>
    applyHmiEdit(updateHmiAlarmDefinition(project, input), "Updated HMI alarm.");
  const handleDeleteHmiAlarm = (alarmId: string) =>
    applyHmiEdit(deleteHmiAlarmDefinition(project, { alarmId }), "Deleted HMI alarm.");
  const handleCreateHmiTrend = (input: Parameters<typeof createHmiTrendDefinition>[1]) =>
    applyHmiEdit(createHmiTrendDefinition(project, input), `Created HMI trend "${input.name.trim()}".`);
  const handleUpdateHmiTrend = (input: Parameters<typeof updateHmiTrendDefinition>[1]) =>
    applyHmiEdit(updateHmiTrendDefinition(project, input), "Updated HMI trend.");
  const handleDeleteHmiTrend = (trendId: string) =>
    applyHmiEdit(deleteHmiTrendDefinition(project, { trendId }), "Deleted HMI trend.");
  const handleAddHmiTrendPen = (input: Parameters<typeof addHmiTrendPen>[1]) =>
    applyHmiEdit(addHmiTrendPen(project, input), `Added trend pen "${input.label.trim()}".`);
  const handleRemoveHmiTrendPen = (trendId: string, traceId: string) =>
    applyHmiEdit(removeHmiTrendPen(project, { trendId, traceId }), "Removed trend pen.");
  const handleCreateHmiDataLog = (input: Parameters<typeof createHmiDataLogDefinition>[1]) =>
    applyHmiEdit(createHmiDataLogDefinition(project, input), `Created HMI data log "${input.name.trim()}".`);
  const handleUpdateHmiDataLog = (input: Parameters<typeof updateHmiDataLogDefinition>[1]) =>
    applyHmiEdit(updateHmiDataLogDefinition(project, input), "Updated HMI data log.");
  const handleDeleteHmiDataLog = (dataLogId: string) =>
    applyHmiEdit(deleteHmiDataLogDefinition(project, { dataLogId }), "Deleted HMI data log.");
  const handleCreateHmiRecipe = (input: Parameters<typeof createHmiRecipe>[1]) =>
    applyHmiEdit(createHmiRecipe(project, input), `Created HMI recipe "${input.name.trim()}".`);
  const handleAddHmiRecipeItem = (input: Parameters<typeof addHmiRecipeItem>[1]) =>
    applyHmiEdit(addHmiRecipeItem(project, input), "Added HMI recipe value.");
  const handleRemoveHmiRecipeItem = (recipeId: string, itemId: string) =>
    applyHmiEdit(removeHmiRecipeItem(project, { recipeId, itemId }), "Removed HMI recipe value.");
  const handleDeleteHmiRecipe = (recipeId: string) =>
    applyHmiEdit(deleteHmiRecipe(project, { recipeId }), "Deleted HMI recipe.");
  const handleCreateHmiLanguage = (input: Parameters<typeof createHmiLanguagePack>[1]) =>
    applyHmiEdit(createHmiLanguagePack(project, input), `Created language pack "${input.languageId.trim()}".`);
  const handleDeleteHmiLanguage = (languageId: string) =>
    applyHmiEdit(deleteHmiLanguagePack(project, { languageId }), "Deleted language pack.");
  const handleSetHmiLanguageString = (languageId: string, key: string, value: string) =>
    applyHmiEdit(setHmiLanguageString(project, { languageId, key, value }), "Saved localized string.");
  const handleRemoveHmiLanguageString = (languageId: string, key: string) =>
    applyHmiEdit(removeHmiLanguageString(project, { languageId, key }), "Removed localized string.");
  const handleSetHmiDefaultLanguage = (languageId: string) =>
    applyHmiEdit(setHmiDefaultLanguage(project, { languageId }), "Set default HMI language.");
  const handleExportHmiLanguage = (languageId: string) => {
    const pack = hmiProject?.languagePacks.find((candidate) => candidate.languageId === languageId);
    if (!pack) {
      push("error", "Language pack not found.");
      return;
    }
    const result = exportHmiLanguagePackCsv(pack);
    downloadTextFile(result.fileName, result.text, "text/csv;charset=utf-8");
    push("success", `Exported language CSV "${result.fileName}".`);
  };
  const handleImportHmiLanguage = (text: string, sourceFileName?: string) =>
    applyHmiEdit(importHmiLanguagePack(project, { text, sourceFileName }), "Imported language CSV.");
  const handleCreateHmiRole = (input: Parameters<typeof createHmiSecurityRole>[1]) =>
    applyHmiEdit(createHmiSecurityRole(project, input), `Created security role "${input.name.trim()}".`);
  const handleDeleteHmiRole = (roleId: string) =>
    applyHmiEdit(deleteHmiSecurityRole(project, { roleId }), "Deleted security role.");
  const handleCreateHmiUser = (input: Parameters<typeof createHmiSecurityUser>[1]) =>
    applyHmiEdit(createHmiSecurityUser(project, input), `Created security user "${input.username.trim()}".`);
  const handleDeleteHmiUser = (userId: string) =>
    applyHmiEdit(deleteHmiSecurityUser(project, { userId }), "Deleted security user.");

  const handleSetHmiHomeScreen = (screenId: string) =>
    applyHmiEdit(setHmiHomeScreen(project, { screenId }), "Set HMI home screen.");
  const handleRenameHmiSurface = (surfaceKind: "screen" | "popup", surfaceId: string, name: string) =>
    applyHmiEdit(renameHmiSurface(project, { surfaceKind, surfaceId, name }), "Renamed HMI surface.");
  const handleSetHmiSurfaceSecurityRoles = (
    surfaceKind: "screen" | "popup" | "system-banner",
    surfaceId: string,
    roleIds: string[],
  ) =>
    applyHmiEdit(
      setHmiSurfaceSecurityRoles(project, { surfaceKind, surfaceId, roleIds }),
      roleIds.length ? "Updated HMI surface security." : "Cleared HMI surface security.",
    );
  const handleDeleteHmiSurface = (surfaceKind: "screen" | "popup", surfaceId: string) => {
    const result =
      surfaceKind === "screen"
        ? deleteHmiScreen(project, { screenId: surfaceId })
        : deleteHmiPopup(project, { popupId: surfaceId });
    if (applyHmiEdit(result, `Deleted HMI ${surfaceKind}.`)) {
      setSelection({ kind: "hmi", id: hmiProject?.id ?? "hmi" });
    }
  };
  const handleBuildHmiRuntimePackage = () => {
    if (!hmiProject) {
      push("error", "Enable an HMI project before building a runtime package.");
      return;
    }
    const result = buildHmiRuntimePackage(hmiProject, {
      validationContext: { knownTagPaths: hmiKnownTagPaths },
    });
    if (!result.ok || !result.artifact) {
      push("error", result.blockedReason ?? "HMI runtime package build is blocked by verification errors.");
      return;
    }
    downloadTextFile(
      result.artifact.fileName,
      serializeHmiRuntimePackageArtifact(result.artifact),
      "application/json",
    );
    logActivity("export", `Built HMI runtime package "${result.artifact.fileName}".`);
    const summary = result.artifact.summary;
    push(
      "success",
      `Built offline HMI runtime package: ${summary.screenCount} screen(s), ${summary.elementCount} element(s), checksum ${result.artifact.contentChecksum}.`,
    );
    if (result.verification.warningCount) {
      push("warning", `${result.verification.warningCount} HMI package warning(s). Review artifact before deployment.`);
    }
  };

  // ---- Controller-database editing (UDT members, AOI parameters/local tags) ----
  const runStructureEdit = (result: ProjectActionResult, successMsg?: string) => {
    if (!result.ok) {
      push("error", result.error ?? "Structure edit failed.");
      return;
    }
    setProject(result.project);
    if (successMsg) push("success", successMsg);
  };
  const structureEditing: StructureEditing = {
    addUdtMember: (udtId, member) =>
      runStructureEdit(addUdtMember(project, { udtId, member }), `Added UDT member ${member.name}.`),
    updateUdtMember: (udtId, memberName, patch) =>
      runStructureEdit(updateUdtMember(project, { udtId, memberName, patch })),
    removeUdtMember: (udtId, memberName) =>
      runStructureEdit(removeUdtMember(project, { udtId, memberName }), `Removed UDT member ${memberName}.`),
    addAoiParameter: (aoiId, parameter) =>
      runStructureEdit(addAoiParameter(project, { aoiId, parameter }), `Added AOI parameter ${parameter.name}.`),
    updateAoiParameter: (aoiId, parameterName, patch) =>
      runStructureEdit(updateAoiParameter(project, { aoiId, parameterName, patch })),
    removeAoiParameter: (aoiId, parameterName) =>
      runStructureEdit(removeAoiParameter(project, { aoiId, parameterName }), `Removed AOI parameter ${parameterName}.`),
    addAoiLocalTag: (aoiId, localTag) =>
      runStructureEdit(addAoiLocalTag(project, { aoiId, localTag }), `Added AOI local tag ${localTag.name}.`),
    updateAoiLocalTag: (aoiId, localTagName, patch) =>
      runStructureEdit(updateAoiLocalTag(project, { aoiId, localTagName, patch })),
    removeAoiLocalTag: (aoiId, localTagName) =>
      runStructureEdit(removeAoiLocalTag(project, { aoiId, localTagName }), `Removed AOI local tag ${localTagName}.`),
    addIoModule: (input) => {
      const result = addIoModule(project, input);
      if (!result.ok) {
        push("error", result.error ?? "I/O module add failed.");
        return;
      }
      setProject(result.project);
      if (result.data) setSelection({ kind: "io", controllerId: result.data.controllerId, moduleId: result.data.moduleId });
      push(
        "success",
        result.data?.setupTagNames.length
          ? `Added I/O device ${input.name} with ${result.data.setupTagNames.length} setup tag(s).`
          : `Added I/O device ${input.name}.`,
      );
    },
    updateIoModule: (input) => {
      const result = updateIoModule(project, input);
      if (!result.ok) {
        push("error", result.error ?? "I/O module update failed.");
        return;
      }
      setProject(result.project);
      if (result.data) setSelection({ kind: "io", controllerId: result.data.controllerId, moduleId: result.data.moduleId });
      push("success", `Updated I/O module ${input.name}.`);
    },
    removeIoModule: (input) => {
      const result = removeIoModule(project, input);
      if (!result.ok) {
        push("error", result.error ?? "I/O module remove failed.");
        return;
      }
      setProject(result.project);
      if (result.data) setSelection({ kind: "io", controllerId: result.data.controllerId });
      push("success", `Removed I/O module ${result.data?.moduleName ?? input.moduleId}.`);
    },
  };
  const replaceController = (
    controllerId: string,
    update: (controller: Controller) => Controller,
  ): { before: Controller; after: Controller; project: PlcProject } | undefined => {
    const before = project.controllers.find((candidate) => candidate.id === controllerId);
    if (!before) {
      push("error", "Controller not found.");
      return undefined;
    }
    const after = update(before);
    const nextProject = {
      ...project,
      controllers: project.controllers.map((candidate) => (candidate.id === controllerId ? after : candidate)),
    };
    setProject(nextProject);
    return { before, after, project: nextProject };
  };
  const openStructureSelection = (nextSelection: Selection) => {
    setSelection(nextSelection);
    setView("structure");
    setCopilotTab("history");
  };
  const handleNewAddOnInstruction = (controllerId: string) => {
    let created: AddOnInstruction | undefined;
    const result = replaceController(controllerId, (controller) => {
      const name = nextAssetName(controller.addOnInstructions.map((aoi) => aoi.name), "AOI_1");
      const aoi: AddOnInstruction = {
        id: createClientId("aoi"),
        name,
        revision: "1.0",
        vendor: "ESCO Automation",
        parameters: [],
        localTags: [],
        routineNames: [],
      };
      created = aoi;
      return { ...controller, addOnInstructions: [...controller.addOnInstructions, aoi] };
    });
    if (!result || !created) return;
    openStructureSelection({ kind: "aoi", id: created.id });
    push("success", `Created Add-On Instruction ${created.name}.`);
  };
  const handleNewDataType = (controllerId: string, group?: string) => {
    if (group && group !== "User-Defined") {
      push("info", `${group} data types are imported/read-only in this offline project. Create a User-Defined data type instead.`);
      return;
    }
    let created: UserDefinedType | undefined;
    const result = replaceController(controllerId, (controller) => {
      const name = nextAssetName(controller.dataTypes.map((dataType) => dataType.name), "UDT_1");
      const dataType: UserDefinedType = {
        id: createClientId("udt"),
        name,
        family: "NoFamily",
        members: [],
      };
      created = dataType;
      return { ...controller, dataTypes: [...controller.dataTypes, dataType] };
    });
    if (!result || !created) return;
    openStructureSelection({ kind: "udt", id: created.id });
    push("success", `Created User-Defined Data Type ${created.name}.`);
  };
  const handleNewTrend = (controllerId: string) => {
    const result = createControllerTrend(project, { controllerId });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not create controller trend.");
      return;
    }
    setProject(result.project);
    openStructureSelection({ kind: "trend", id: result.data.trendId });
    push("success", `Created controller trend ${result.data.trendName}.`);
  };
  // Offline component import: read an ESCO component export (single-component
  // envelope or controller-assets bundle) and merge the contained definitions
  // into the target controller. Additive and immutable — name collisions are
  // auto-renamed, the existing project is never overwritten.
  const handleImportComponentClick = (controllerId: string, family: ComponentImportAssetKind) => {
    componentImportTargetRef.current = { targetKind: "controller", controllerId, family };
    componentImportInputRef.current?.click();
  };
  const handleImportControllerComponentClick = (controllerId?: string) => {
    componentImportTargetRef.current = { targetKind: "controller-component", controllerId };
    componentImportInputRef.current?.click();
  };
  const handleImportRoutineClick = (programId: string) => {
    componentImportTargetRef.current = { targetKind: "program", programId, family: "routine" };
    componentImportInputRef.current?.click();
  };
  const handleImportProgramClick = (controllerId: string) => {
    componentImportTargetRef.current = { targetKind: "controller-program", controllerId, family: "program" };
    componentImportInputRef.current?.click();
  };
  const handleImportTaskClick = (controllerId: string) => {
    componentImportTargetRef.current = { targetKind: "controller-task", controllerId, family: "task" };
    componentImportInputRef.current?.click();
  };
  const handleImportTagComponentClick = (controllerId: string, scope: "controller" | "program", programId?: string) => {
    componentImportTargetRef.current = { targetKind: "tag", controllerId, scope, programId, family: "tag" };
    componentImportInputRef.current?.click();
  };
  const handleImportIoProfilePackClick = (controllerId: string) => {
    componentImportTargetRef.current = { targetKind: "io-profile-pack", controllerId };
    componentImportInputRef.current?.click();
  };
  const tagComponentTarget = (
    controllerId: string,
    scope: "controller" | "program",
    programId?: string,
  ): TagComponentImportTarget =>
    scope === "program"
      ? { scope: "program", controllerId, programId: programId ?? "" }
      : { scope: "controller", controllerId };
  const handleComponentImportSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const target = componentImportTargetRef.current;
    componentImportTargetRef.current = null;
    if (!file || !target) return;
    try {
      const text = await readFileAsText(file);
      // Inspect the file first so the engineer can resolve any name collisions
      // (overwrite / rename / skip) before anything is merged.
      const plan =
        target.targetKind === "program"
          ? previewRoutineComponentImport(project, target.programId, text)
          : target.targetKind === "controller-component"
            ? previewControllerComponentImport(project, text)
          : target.targetKind === "controller-program"
            ? previewProgramComponentImport(project, target.controllerId, text)
          : target.targetKind === "controller-task"
            ? previewTaskComponentImport(project, target.controllerId, text)
            : target.targetKind === "tag"
              ? previewTagComponentImport(project, tagComponentTarget(target.controllerId, target.scope, target.programId), text)
              : target.targetKind === "io-profile-pack"
                ? previewIoProfilePackImport(project, target.controllerId, text)
              : previewComponentImport(project, target.controllerId, target.family, text);
      if (!plan.ok) {
        push("error", plan.error ?? "Failed to read the component file.");
        return;
      }
      setComponentImport({ ...target, fileName: file.name, text, plan });
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the component file.");
    }
  };
  // Re-run the offline preview as the engineer changes per-row resolutions. Pure
  // and side-effect free — the dialog calls it on every change.
  const recomputeComponentImport = useCallback(
    (resolutions: ComponentImportResolutionMap): ComponentImportPlan => {
      if (!componentImport) {
        return previewComponentImport(project, "", "aoi", "{}");
      }
      if (componentImport.targetKind === "program") {
        return previewRoutineComponentImport(project, componentImport.programId, componentImport.text, resolutions);
      }
      if (componentImport.targetKind === "controller-component") {
        return previewControllerComponentImport(project, componentImport.text, resolutions);
      }
      if (componentImport.targetKind === "controller-program") {
        return previewProgramComponentImport(project, componentImport.controllerId, componentImport.text, resolutions);
      }
      if (componentImport.targetKind === "controller-task") {
        return previewTaskComponentImport(project, componentImport.controllerId, componentImport.text, resolutions);
      }
      if (componentImport.targetKind === "tag") {
        return previewTagComponentImport(
          project,
          tagComponentTarget(componentImport.controllerId, componentImport.scope, componentImport.programId),
          componentImport.text,
          resolutions,
        );
      }
      if (componentImport.targetKind === "io-profile-pack") {
        return previewIoProfilePackImport(project, componentImport.controllerId, componentImport.text, resolutions);
      }
      return previewComponentImport(project, componentImport.controllerId, componentImport.family, componentImport.text, resolutions);
    },
    [componentImport, project],
  );
  const handleApplyComponentImport = (resolutions: ComponentImportResolutionMap) => {
    const pending = componentImport;
    setComponentImport(null);
    if (!pending) return;
    const result =
      pending.targetKind === "program"
        ? importRoutineComponent(project, pending.programId, pending.text, resolutions)
        : pending.targetKind === "controller-component"
          ? importControllerComponent(project, pending.text, resolutions)
        : pending.targetKind === "controller-program"
          ? importProgramComponent(project, pending.controllerId, pending.text, resolutions)
          : pending.targetKind === "controller-task"
            ? importTaskComponent(project, pending.controllerId, pending.text, resolutions)
          : pending.targetKind === "tag"
            ? importTagComponent(
                project,
                tagComponentTarget(pending.controllerId, pending.scope, pending.programId),
                pending.text,
                resolutions,
              )
            : pending.targetKind === "io-profile-pack"
              ? importIoProfilePack(project, pending.controllerId, pending.text, resolutions)
            : importComponents(project, pending.controllerId, pending.family, pending.text, resolutions);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to import component file.");
      return;
    }
    setProject(result.project);
    const { kindLabel, created, renamed, overwritten, skipped, errors, importedNames } = result.data;
    logActivity(
      "import",
      `Imported ${importedNames.length} ${kindLabel} component(s) from "${pending.fileName}": ${created} created, ${renamed} renamed, ${overwritten} overwritten, ${skipped} skipped.`,
    );
    // Navigate to the first imported component so the engineer sees the result.
    const firstName = importedNames[0];
    if (pending.targetKind === "program" && firstName) {
      const routine = result.project.controllers
        .flatMap((controller) => controller.programs)
        .find((program) => program.id === pending.programId)
        ?.routines.find((candidate) => candidate.name === firstName);
      if (routine) openStructureSelection({ kind: "routine", id: routine.id });
      else setView("structure");
    } else if (pending.targetKind === "controller-component" && firstName) {
      const controller = result.project.controllers.find((candidate) => candidate.name === firstName);
      if (controller) openStructureSelection({ kind: "controller", id: controller.id });
      else setView("structure");
    } else if (pending.targetKind === "controller-program" && firstName) {
      const program = result.project.controllers
        .find((controller) => controller.id === pending.controllerId)
        ?.programs.find((candidate) => candidate.name === firstName);
      if (program) openStructureSelection({ kind: "program", id: program.id });
      else setView("structure");
    } else if (pending.targetKind === "controller-task" && firstName) {
      const task = result.project.controllers
        .find((controller) => controller.id === pending.controllerId)
        ?.tasks.find((candidate) => candidate.name === firstName);
      if (task) openStructureSelection({ kind: "task", id: task.id });
      else setView("structure");
    } else if (pending.targetKind === "tag" && firstName) {
      const controller = result.project.controllers.find((candidate) => candidate.id === pending.controllerId);
      const tag =
        pending.scope === "controller"
          ? controller?.controllerTags.find((candidate) => candidate.name === firstName)
          : controller?.programs
              .find((program) => program.id === pending.programId)
              ?.programTags.find((candidate) => candidate.name === firstName);
      if (tag) {
        setSelection({ kind: "tag", id: tag.id });
        setView("tags");
      } else {
        setView("tags");
      }
    } else if (pending.targetKind === "io-profile-pack" && firstName) {
      const controller = result.project.controllers.find((candidate) => candidate.id === pending.controllerId);
      const module = controller?.ioConfiguration.modules.find((candidate) => candidate.name === firstName);
      openStructureSelection({ kind: "io", controllerId: pending.controllerId, ...(module ? { moduleId: module.id } : {}) });
    } else if (pending.targetKind === "controller" && firstName) {
      const controller = result.project.controllers.find((candidate) => candidate.id === pending.controllerId);
      if (controller && pending.family === "aoi") {
        const aoi = controller.addOnInstructions.find((candidate) => candidate.name === firstName);
        if (aoi) openStructureSelection({ kind: "aoi", id: aoi.id });
      } else if (controller && pending.family === "udt") {
        const udt = controller.dataTypes.find((candidate) => candidate.name === firstName);
        if (udt) openStructureSelection({ kind: "udt", id: udt.id });
      } else if (controller) {
        const trend = (controller.trends ?? []).find((candidate) => candidate.name === firstName);
        if (trend) openStructureSelection({ kind: "trend", id: trend.id });
      }
    } else {
      setView("structure");
    }
    const details = [`${created} created`];
    if (renamed) details.push(`${renamed} renamed`);
    if (overwritten) details.push(`${overwritten} overwritten`);
    if (skipped) details.push(`${skipped} skipped`);
    if (errors) details.push(`${errors} errors`);
    push(skipped || errors ? "warning" : "success", `Imported ${kindLabel}: ${details.join(", ")}.`);
  };
  const exportControllerAssetBundle = (
    controllerId: string,
    kind: string,
    fileSuffix: string,
    payload: unknown,
  ) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    if (!controller) {
      push("error", "Controller not found.");
      return;
    }
    const text = `${JSON.stringify(
      {
        format: "esco.controller-assets.export.v1",
        kind,
        exportedAt: new Date().toISOString(),
        project: { id: project.id, name: project.name },
        controller: { id: controller.id, name: controller.name },
        payload,
      },
      null,
      2,
    )}\n`;
    const fileName = `${slugify(controller.name)}-${fileSuffix}.json`;
    downloadTextFile(fileName, text, "application/vnd.esco.component+json");
    logActivity("export", `Exported ${kind} for ${controller.name} -> ${fileName}.`);
    push("success", `Exported ${kind} -> ${fileName}.`);
  };
  const handleExportAddOnInstructions = (controllerId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    if (controller) exportControllerAssetBundle(controllerId, "add-on-instructions", "add-on-instructions.esco-assets", controller.addOnInstructions);
    else push("error", "Controller not found.");
  };
  const handleExportDataTypes = (controllerId: string, group?: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    if (!controller) {
      push("error", "Controller not found.");
      return;
    }
    if (group && group !== "User-Defined") {
      push("info", `${group} data types are imported/read-only metadata; exporting User-Defined data types instead.`);
    }
    exportControllerAssetBundle(controllerId, "user-defined-data-types", "data-types.esco-assets", controller.dataTypes);
  };
  const handleExportTrends = (controllerId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    if (controller) exportControllerAssetBundle(controllerId, "controller-trends", "trends.esco-assets", controller.trends ?? []);
    else push("error", "Controller not found.");
  };
  const handleTrendProperties = (controllerId: string, trendId: string) => {
    const trend = project.controllers.find((controller) => controller.id === controllerId)?.trends?.find((candidate) => candidate.id === trendId);
    if (!trend) {
      push("error", "Trend not found.");
      return;
    }
    openStructureSelection({ kind: "trend", id: trend.id });
  };
  const handleExportTrend = (controllerId: string, trendId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    const trend = controller?.trends?.find((candidate) => candidate.id === trendId);
    if (!controller || !trend) {
      push("error", "Trend not found.");
      return;
    }
    exportControllerAssetBundle(controllerId, "controller-trend", `${slugify(trend.name)}.esco-trend`, trend);
  };
  const handleDeleteTrend = async (controllerId: string, trendId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    const trend = controller?.trends?.find((candidate) => candidate.id === trendId);
    if (!controller || !trend) {
      push("error", "Trend not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Trend",
        message: `Delete trend "${trend.name}"?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteControllerTrend(project, { controllerId, trendId });
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Could not delete trend.");
      return;
    }
    setProject(result.project);
    openStructureSelection({ kind: "controller", id: controller.id });
    push("success", `Deleted trend ${result.data.trendName}.`);
  };
  const handleDeleteAoi = async (controllerId: string, aoiId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    const aoi = controller?.addOnInstructions.find((candidate) => candidate.id === aoiId);
    if (!controller || !aoi) {
      push("error", "Add-On Instruction not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Custom Instruction",
        message: `Delete Custom Instruction "${aoi.name}"?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteAoi(project, { aoiId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete Add-On Instruction.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "controller", id: controller.id });
    setView("structure");
    push("success", `Deleted Add-On Instruction ${result.data?.aoiName ?? aoi.name}.`);
  };
  const handleDeleteUdt = async (controllerId: string, udtId: string) => {
    const controller = project.controllers.find((candidate) => candidate.id === controllerId);
    const udt = controller?.dataTypes.find((candidate) => candidate.id === udtId);
    if (!controller || !udt) {
      push("error", "UDT not found.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Delete Data Type",
        message: `Delete UDT "${udt.name}"?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const result = deleteUdt(project, { udtId });
    if (!result.ok) {
      push("error", result.error ?? "Could not delete UDT.");
      return;
    }
    setProject(result.project);
    setSelection({ kind: "controller", id: controller.id });
    setView("structure");
    push("success", `Deleted UDT ${result.data?.udtName ?? udt.name}.`);
  };

  const selectionRequestsRung =
    (selection?.kind === "rung" || selection?.kind === "instruction") && selection.routineId === openRoutineId;
  const selectionFromAnotherRoutine =
    (selection?.kind === "rung" || selection?.kind === "instruction") && selection.routineId !== openRoutineId;
  const requestedSelectedRungId = selectionRequestsRung
    ? selection.rungId
    : selectionFromAnotherRoutine
      ? undefined
      : openLadder?.rungs[0]?.id;
  const requestedSelectedRung = requestedSelectedRungId
    ? openLadder?.rungs.find((rung) => rung.id === requestedSelectedRungId)
    : undefined;
  const selectedRung = selectionRequestsRung ? requestedSelectedRung : requestedSelectedRung ?? openLadder?.rungs[0];
  const selectedRungId = selectedRung?.id;
  const selectedRungLabel = selectedRung
    ? `Rung ${String(selectedRung.number).padStart(3, "0")}`
    : "Rung --";

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchHits = useMemo(() => searchProject(project, searchQuery), [project, searchQuery]);
  useEffect(() => setActiveSearchIndex(-1), [project, searchQuery]);
  const selectSearchHit = (hit: SearchHit) => {
    const rungId = /\/rung:([^/]+)/.exec(hit.target)?.[1];
    if (hit.routineId) {
      openRoutineWindow(hit.routineId);
      if (rungId) setSelection({ kind: "rung", routineId: hit.routineId, rungId });
      return;
    }

    if (hit.kind === "tag" || hit.kind === "tag-comment") {
      setSelection({ kind: "tag", id: hit.label });
      setView("tags");
      return;
    }

    const taskId = /^task:([^/]+)/.exec(hit.target)?.[1];
    if (taskId) {
      setSelection({ kind: "task", id: taskId });
      setView("structure");
      return;
    }

    const ioModule = /^controller:([^/]+)\/io-module:([^/]+)/.exec(hit.target);
    if (ioModule) {
      const [, controllerId, moduleId] = ioModule;
      setSelection({ kind: "io", controllerId, moduleId });
      setIoModulePropertiesTarget({ controllerId, moduleId });
      setView("structure");
      return;
    }

    const hmiSurface = /^hmi\/(screen|popup|system-banner):([^/]+)/.exec(hit.target);
    if (hmiSurface) {
      const [, kind, id] = hmiSurface;
      setSelection(
        kind === "screen"
          ? { kind: "hmi-screen", id }
          : kind === "popup"
            ? { kind: "hmi-popup", id }
            : { kind: "hmi-banner", id },
      );
      setView("hmi");
      return;
    }

    if (hit.target.startsWith("hmi:") || hit.target.startsWith("hmi/")) {
      setView("hmi");
      return;
    }

    const programId = /^program:([^/]+)/.exec(hit.target)?.[1];
    if (programId) {
      setSelection({ kind: "program", id: programId });
      setView("structure");
      return;
    }

    const controllerId = /^controller:([^/]+)/.exec(hit.target)?.[1];
    const udtName = /\/udt:([^/]+)/.exec(hit.target)?.[1];
    if (udtName) {
      setSelection({ kind: "udt", id: udtName });
      setView("structure");
      return;
    }
    if (controllerId) {
      setSelection({ kind: "controller", id: controllerId });
      setView("structure");
    }
  };
  const handleOpenSearchHit = (hit: SearchHit) => {
    const hitIndex = searchHits.indexOf(hit);
    if (hitIndex >= 0) setActiveSearchIndex(hitIndex);
    selectSearchHit(hit);
    openDockTab("search");
  };
  const handleFindRelative = (direction: 1 | -1) =>
    requireProject(() => {
      openDockTab("search");
      const query = searchQuery.trim();
      if (!query) {
        push("info", "Type a search query before using Find Next.");
        return;
      }
      if (!searchHits.length) {
        push("info", `No matches for "${query}".`);
        return;
      }
      const nextIndex = (activeSearchIndex + direction + searchHits.length) % searchHits.length;
      setActiveSearchIndex(nextIndex);
      const hit = searchHits[nextIndex];
      selectSearchHit(hit);
      push("info", `${direction > 0 ? "Find Next" : "Find Previous"} ${nextIndex + 1} of ${searchHits.length}: ${hit.label}`);
    });
  const handleFindNext = () => handleFindRelative(1);
  const handleFindPrevious = () => handleFindRelative(-1);
  const handleReplaceAll = async (replacement: string) => {
    const preview = previewProjectTextReplace(project, searchQuery, replacement);
    if (preview.replaceableCount === 0) {
      push("info", "No mutable text fields match the current search.");
      return;
    }
    if (
      !(await requestConfirmation({
        title: "Replace Text",
        message: `Replace ${preview.replaceableCount} mutable text match${preview.replaceableCount === 1 ? "" : "es"}? Identifiers, tag paths, and read-only source are skipped.`,
        confirmLabel: "Replace",
        tone: "warning",
      }))
    ) {
      return;
    }
    const result = applyProjectTextReplace(project, searchQuery, replacement);
    setProject(result.project);
    logActivity(
      "info",
      `Replace All "${searchQuery}" → "${replacement}": ${result.appliedCount} mutable text field(s), ${result.preview.skippedCount} skipped.`,
    );
    push("success", `Replaced ${result.appliedCount} mutable text field${result.appliedCount === 1 ? "" : "s"}.`);
  };
  const selectedNodeId =
    selection?.kind === "instruction" &&
    selection.routineId === openRoutineId &&
    selectedRung?.id === selection.rungId &&
    rungNodes(selectedRung).some((node) => node.id === selection.nodeId)
      ? selection.nodeId
      : undefined;
  const selectedHmiSurface =
    selection?.kind === "hmi-screen"
      ? ({ kind: "screen", id: selection.id } as const)
      : selection?.kind === "hmi-popup"
        ? ({ kind: "popup", id: selection.id } as const)
        : selection?.kind === "hmi-banner"
          ? ({ kind: "system-banner", id: selection.id } as const)
          : undefined;

  // ---- File workflows ----
  const confirmDiscardDirtyProject = (action: string) =>
    !dirty
      ? Promise.resolve(true)
      : requestConfirmation({
          title: "Discard Unsaved Changes",
          message: `${action}? Unsaved changes will be lost.`,
          confirmLabel: "Continue",
          tone: "warning",
        });

  const loadProject = (loaded: PlcProject, file: DesktopSavedFile | null = null) => {
    history.reset(loaded); // opening/importing a project is a fresh undo baseline
    setSavedProject(loaded); // freshly loaded = no unsaved changes
    setProjectOpen(true);
    setProjectFile(file);
    setValues(zeroValues(loaded));
    setForces({});
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setControllerPropertiesOpen(false);
    setControllerPropertiesControllerId(undefined);
    setRecovery(null);
    clearAutosave(); // starting from a file supersedes any recovered autosave
    setOpenRoutineWindowIds(routineWindowIdsForProject(loaded));
    const main = findMainRoutine(loaded);
    if (main) {
      setOpenRoutineId(main.id);
      setSelection({ kind: "routine", id: main.id });
      setView("routine");
    } else {
      setOpenRoutineId(undefined);
      setSelection(null);
      setView("welcome");
    }
  };

  const handleCreateRoutineProject = async (options?: BlankRoutineProjectOptions, shouldConfirm = true) => {
    if (shouldConfirm && !(await confirmDiscardDirtyProject("Create a new project"))) return;
    const blank = recordImportProvenance(createBlankRoutineProject(options), { sourceType: "new" });
    history.reset(blank);
    setSavedProject(initialProject);
    setProjectOpen(true);
    setProjectFile(null);
    setValues(zeroValues(blank));
    setForces({});
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setControllerPropertiesOpen(false);
    setControllerPropertiesControllerId(undefined);
    setNewProjectDialogOpen(false);
    setRecovery(null);
    setOpenRoutineWindowIds(routineWindowIdsForProject(blank));
    const controller = blank.controllers[0];
    const main = findMainRoutine(blank);
    if (main) {
      setOpenRoutineId(main.id);
      setSelection({ kind: "routine", id: main.id });
      setView("routine");
    } else {
      setOpenRoutineId(undefined);
      setSelection(controller ? { kind: "controller", id: controller.id } : null);
      setView("welcome");
    }
    rememberProject({ projectId: blank.id, name: blank.name, source: "created", storage: "metadata" });
  };

  const handleOpenNewProjectDialog = () => {
    setNewProjectDialogOpen(true);
  };

  const handleCloseProject = async () => {
    if (dirty && !(await confirmDiscardDirtyProject("Close the project"))) return;
    history.reset(initialProject);
    setSavedProject(initialProject);
    setProjectOpen(false);
    setProjectFile(null);
    setValues(zeroValues(initialProject));
    setForces({});
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setControllerPropertiesOpen(false);
    setControllerPropertiesControllerId(undefined);
    setRecovery(null);
    setOpenRoutineWindowIds([]);
    setOpenRoutineId(undefined);
    setSelection(null);
    setView("welcome");
    clearAutosave();
    push("info", "Project closed.");
  };

  // ---- Autosave recovery ----
  const handleRestoreAutosave = async () => {
    if (!recovery) return;
    if (!(await confirmDiscardDirtyProject("Restore autosaved work"))) return;
    history.reset(recovery.project);
    setProjectOpen(true);
    setProjectFile(null);
    setValues(zeroValues(recovery.project));
    setForces({});
    setTrendSamples([]);
    setSavedProject(initialProject); // recovered work is unsaved → stays dirty
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setControllerPropertiesOpen(false);
    setControllerPropertiesControllerId(undefined);
    setRecovery(null);
    setOpenRoutineWindowIds(routineWindowIdsForProject(recovery.project));
    const main = findMainRoutine(recovery.project);
    if (main) {
      setOpenRoutineId(main.id);
      setSelection({ kind: "routine", id: main.id });
      setView("routine");
    }
    push("success", "Restored autosaved work.");
  };
  const handleDismissAutosave = () => {
    setRecovery(null);
    clearAutosave();
  };
  const completeDesktopStartup = (action: DesktopStartupAction) => {
    recordDesktopStartupAction(action);
    setFirstRunComplete(true);
    setDesktopSignInPrompted(false);
    setDesktopStartupOpen(false);
    void promoteDesktopWindowToIde();
  };
  const handleDesktopOpenProject = () => {
    completeDesktopStartup("open-project");
    setTimeout(() => handleImportClick(), 0);
  };
  const handleDesktopNewProject = () => {
    completeDesktopStartup("new-project");
    void handleCreateRoutineProject();
  };
  const handleDesktopImportL5X = () => {
    completeDesktopStartup("import-l5x");
    setTimeout(() => handleImportL5XClick(), 0);
  };
  const handleDesktopRestoreBackup = () => {
    if (!recovery) {
      push("info", "No autosaved backup was found on this workstation.");
      return;
    }
    completeDesktopStartup("restore-backup");
    void handleRestoreAutosave();
  };
  const handleDesktopContinueOffline = () => {
    completeDesktopStartup("continue-offline");
    push("info", "Workspace ready in Offline Simulation. No controller connection active.");
  };
  const handleHelpContents = () => {
    setAboutDialog({ open: true, mode: "help" });
    push("info", "Help and safety notes opened.");
  };
  const handleAbout = () => {
    const counts = escoCapabilityCounts();
    const runnableOffline = counts.implemented + counts["simulation-only"];
    setAboutDialog({ open: true, mode: "about" });
    push("info", `ESCO Automation Studio - ${runnableOffline} implemented or simulation-only areas.`);
  };
  const handleDesktopSignIn = () => {
    setDesktopSignInPrompted(true);
    setSetupOpen(true);
    push("info", "First-run workstation setup is required before opening the IDE.");
  };

  const finishSavedProject = (fileName: string, savedFile: DesktopSavedFile | null) => {
    setSavedProject(project); // saving/exporting is the save point — mark clean
    setLastExportedAt(new Date().toISOString());
    setProjectFile(savedFile);
    clearAutosave();
    rememberProject({
      projectId: project.id,
      name: project.name,
      source: "exported",
      storage: savedFile ? "desktop-file" : "download",
      fileName,
      path: savedFile?.path,
    });
  };

  const handleSaveProject = async (saveAs = false) => {
    const result = exportProjectJson(project);
    if (!result.data) return;

    const filename = `${slugify(project.name)}${EASPROJ_EXTENSION}`;
    try {
      const saved = await saveDesktopProjectFile({
        path: saveAs ? undefined : projectFile?.path,
        suggestedName: projectFile?.fileName ?? filename,
        text: result.data.text,
      });
      if (saved === null) {
        push("info", "Save canceled.");
        return;
      }
      if (saved) {
        finishSavedProject(saved.fileName, saved);
        logActivity("export", `Saved "${project.name}" → ${saved.path}`);
        push("success", `Saved "${project.name}" → ${saved.fileName}`);
        return;
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to save the project file.");
      return;
    }

    downloadTextFile(filename, result.data.text);
    finishSavedProject(filename, null);
    logActivity("export", `Exported "${project.name}" → ${filename}`);
    push("success", `Exported "${project.name}" → ${filename}`);
  };
  const handleExport = () => void handleSaveProject(false);
  const handleExportAs = () => void handleSaveProject(true);
  const handleExportL5X = () => {
    const result = exportProjectL5X(project);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to export L5X.");
      return;
    }
    const filename = `${slugify(project.name)}.L5X`;
    downloadTextFile(filename, result.data.text, "application/xml");
    logActivity("export", `Generated offline L5X "${filename}".`);
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: filename });
    push("success", "Generated offline L5X. Review before use. No proprietary binary project modification.");
    if (result.warnings?.length) push("warning", `${result.warnings.length} L5X export warning(s). Review generated file before use.`);
  };
  const handleExportTagsCsv = () => {
    const filename = `${slugify(project.name)}-tags.csv`;
    downloadTextFile(filename, exportTagsCsv(project), "text/csv;charset=utf-8");
    logActivity("export", `Exported tag CSV "${filename}".`);
    push("success", `Exported tag CSV "${filename}".`);
  };
  // ----- ESCO-native Runtime (.easruntime) ------------------------------------
  // Build / export / import the ESCO-owned compiled runtime artifact. ESCO
  // branding only — this is an ESCO-native workflow, independent of any other
  // controller-file format.
  const handleBuildRuntime = () => {
    const result = exportEscoRuntime(project, hmiProject ? { hmiProject } : undefined);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Runtime build failed.");
      return;
    }
    const s = result.data.summary;
    const runtimeWarnings = result.warnings ?? s.warnings;
    setRuntimeBuildPreview({
      projectName: project.name,
      fileName: result.data.fileName,
      checksum: result.data.checksum,
      builtAt: result.data.builtAt,
      runtimeVersion: result.data.runtimeVersion,
      summary: s,
      warnings: runtimeWarnings,
    });
    openDockTab("build");
    logActivity(
      "export",
      `Built ESCO Runtime preview for "${project.name}": ${s.controllerCount} controller(s), ${s.taskCount} task(s), ${s.programCount} program(s), ${s.routineCount} routine(s), checksum ${result.data.checksum.slice(0, 12)}...`,
    );
    push(
      runtimeWarnings.length ? "warning" : "success",
      `Built ESCO Runtime: ${s.controllerCount} controller(s), ${s.routineCount} routine(s), ${s.tagCount} tag(s).${runtimeWarnings.length ? ` ${runtimeWarnings.length} note(s).` : ""}`,
    );
  };
  const handleExportRuntime = () => {
    const result = exportEscoRuntime(project, hmiProject ? { hmiProject } : undefined);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Runtime build failed.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, "application/json");
    logActivity(
      "export",
      `Exported ESCO Runtime "${result.data.fileName}" (checksum ${result.data.checksum.slice(0, 12)}…).`,
    );
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: result.data.fileName });
    push("success", `Exported ESCO Runtime → ${result.data.fileName}. Integrity checksum embedded.`);
    if (result.warnings?.length) push("warning", `${result.warnings.length} ESCO Runtime build note(s).`);
  };
  const handleExportSnapshot = () => {
    const result = exportEscoSnapshot(project, hmiProject ? { hmiProject } : undefined);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Snapshot export failed.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, "application/vnd.esco.snapshot+json");
    logActivity(
      "export",
      `Exported ESCO Snapshot "${result.data.fileName}" (${result.data.summary.controllerCount} controller(s), checksum ${result.data.checksum.slice(0, 12)}...).`,
    );
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: result.data.fileName });
    push(
      "success",
      `Exported ESCO Snapshot -> ${result.data.fileName}. Project/HMI state captured offline with checksum.`,
    );
  };
  const handleExportLibrary = () => {
    const result = exportEscoLibrary(project, hmiProject ? { hmiProject } : undefined);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Library export failed.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, result.data.mediaType);
    logActivity(
      "export",
      `Exported ESCO Library "${result.data.fileName}" (${result.data.summary.routines} routine(s), ${result.data.summary.dataTypes} data type(s), checksum ${result.data.checksum.slice(0, 12)}...).`,
    );
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: result.data.fileName });
    push(
      "success",
      `Exported ESCO Library -> ${result.data.fileName}. Reusable offline assets captured with checksum; no controller transfer.`,
    );
  };
  const handleExportExchange = () => {
    const result = exportEscoExchange(project);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Exchange export failed.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, result.data.mediaType);
    logActivity(
      "export",
      `Exported ESCO Exchange "${result.data.fileName}" with ${result.data.projectPath} (${result.data.projectBytes} bytes, checksum ${result.data.checksum.slice(0, 12)}...).`,
    );
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: result.data.fileName });
    push(
      "success",
      `Exported ESCO Exchange -> ${result.data.fileName}. Editable project artifact embedded and checksummed offline.`,
    );
  };
  const handleExportPackage = () => {
    const result = exportEscoPackage(project, hmiProject ? { hmiProject } : undefined);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "ESCO Package export failed.");
      return;
    }
    const packageWarnings = result.warnings ?? [];
    setPackageBuildPreview({
      projectName: project.name,
      fileName: result.data.fileName,
      packageChecksum: result.data.packageChecksum,
      entryCount: result.data.entryCount,
      embeddedArtifactCount: result.data.embeddedArtifactCount,
      entries: result.data.entries,
      warnings: packageWarnings,
    });
    openDockTab("build");
    downloadTextFile(result.data.fileName, result.data.text, "application/vnd.esco.package+json");
    logActivity(
      "export",
      `Exported ESCO Package "${result.data.fileName}" with ${result.data.entryCount} embedded artifact(s) (checksum ${result.data.packageChecksum.slice(0, 12)}...).`,
    );
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: result.data.fileName });
    push(
      "success",
      `Exported ESCO Package -> ${result.data.fileName}. ${result.data.embeddedArtifactCount} artifact(s) embedded and checksummed.`,
    );
    if (packageWarnings.length) push("warning", `${packageWarnings.length} ESCO Package build note(s).`);
  };
  // Load a project image uploaded from the ESCO Virtual Controller (read-only review).
  const handleLoadUploadedImage = (payload: string) => {
    const result = importProjectFile(payload);
    if (!result.ok) {
      push("error", result.error ?? "Could not load the uploaded controller image.");
      return;
    }
    const softControllerUpload = result.project.provenance?.sourceType === "esco-softcontroller-upload";
    const loaded = softControllerUpload
      ? result.project
      : recordImportProvenance(result.project, {
          sourceType: "esco-project",
          fileName: "ESCO Virtual Controller upload",
        });
    loadProject(loaded);
    if (softControllerUpload) {
      const checksum = result.project.provenance?.softController?.runtimeChecksum;
      const checksumNote = checksum ? ` Runtime checksum ${checksum.slice(0, 12)}.` : "";
      logActivity("import", `Opened reconstructed project "${result.project.name}" from the ESCO SoftController.${checksumNote}`);
      push("success", `Opened reconstructed SoftController project "${result.project.name}".${checksumNote}`);
      return;
    }
    logActivity("import", `Loaded uploaded image "${result.project.name}" from the ESCO Virtual Controller.`);
    push("success", `Loaded uploaded image "${result.project.name}" from the ESCO Virtual Controller.`);
  };
  const toastVirtualAction = (result: { level: "info" | "success" | "warning" | "error"; message: string }) => {
    push(result.level, result.message);
    logActivity("info", `ESCO Virtual Controller: ${result.message}`);
  };
  const handleVirtualSelectPath = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.beginBrowsing());
  };
  const handleVirtualGoOnline = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.goOnline());
  };
  const handleVirtualMonitor = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.monitor());
  };
  const handleVirtualDownload = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.download());
  };
  const handleVirtualUpload = () => {
    openDockTab("controller");
    const result = virtualController.upload();
    toastVirtualAction(result);
    if (result.uploaded?.payload) handleLoadUploadedImage(result.uploaded.payload);
  };
  const handleVirtualGoOffline = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.goOffline());
  };
  const handleVirtualSetMode = (mode: ControllerMode) => {
    openDockTab("controller");
    toastVirtualAction(virtualController.setMode(mode));
  };
  const handleVirtualClearFaults = () => {
    openDockTab("controller");
    toastVirtualAction(virtualController.clearFaults());
  };
  const handleSoftControllerDownloadRuntime = () => {
    openDockTab("controller");
    const result = virtualController.downloadRuntimeToSoftController();
    const level = result.ok ? "success" : result.outcome === "failed" ? "error" : "warning";
    push(level, result.error ? `${result.message} ${result.error}` : result.message);
    logActivity(
      result.ok ? "export" : "info",
      `ESCO SoftController runtime download: ${result.message}${result.preflight.checksum ? ` (${result.preflight.checksum.slice(0, 12)}...)` : ""}`,
    );
  };
  const handleOpenSoftControllerUpload = () => {
    openDockTab("controller");
    push("info", "Controller dock opened. Use Upload from ESCO SoftController there to preview the software image before replacing the project.");
  };
  const handleImportRuntimeClick = () => runtimeInputRef.current?.click();
  const handleImportSnapshotClick = () => snapshotInputRef.current?.click();
  const handleImportExchangeClick = () => exchangeInputRef.current?.click();
  const handleImportPackageClick = () => packageInputRef.current?.click();
  const handleValidateEscoArtifactClick = () => escoArtifactInputRef.current?.click();
  const handleSnapshotSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await confirmDiscardDirtyProject("Import an ESCO Snapshot as the active project"))) return;
    try {
      const text = await readFileAsText(file);
      const result = importProjectFromEscoSnapshot(text, file.name);
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import ESCO Snapshot.");
        return;
      }
      const loaded = recordImportProvenance(result.project, { sourceType: "esco-project", fileName: file.name });
      loadProject(loaded);
      logActivity(
        "import",
        `Imported ESCO Snapshot "${file.name}" (${result.data.summary.controllerCount} controller(s), checksum ${result.data.checksumValid ? "verified" : "UNVERIFIED"}).`,
      );
      rememberProject({ projectId: result.project.id, name: result.project.name, source: "imported", storage: "browser-file", fileName: file.name });
      push(
        "success",
        `Imported ESCO Snapshot "${file.name}": ${result.data.summary.routineCount} routine(s), ${result.data.summary.tagCount} tag(s). Integrity ${result.data.checksumValid ? "verified" : "NOT verified"}.`,
      );
      for (const warning of result.warnings?.slice(0, 2) ?? []) push("warning", warning);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the ESCO Snapshot.");
    }
  };
  const handleExchangeSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await confirmDiscardDirtyProject("Import an ESCO Exchange as the active project"))) return;
    try {
      const text = await readFileAsText(file);
      const result = importProjectFromEscoExchange(text, file.name);
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import ESCO Exchange.");
        return;
      }
      const loaded = recordImportProvenance(result.project, { sourceType: "esco-project", fileName: file.name });
      loadProject(loaded);
      logActivity(
        "import",
        `Imported ESCO Exchange "${file.name}" and opened ${result.data.projectPath} (checksum ${result.data.checksumValid ? "verified" : "UNVERIFIED"}).`,
      );
      rememberProject({ projectId: result.project.id, name: result.project.name, source: "imported", storage: "browser-file", fileName: file.name });
      push(
        "success",
        `Imported ESCO Exchange "${file.name}": opened ${result.data.projectPath}. Integrity ${result.data.checksumValid ? "verified" : "NOT verified"}.`,
      );
      for (const warning of result.warnings?.slice(0, 2) ?? []) push("warning", warning);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the ESCO Exchange.");
    }
  };
  const handlePackageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await confirmDiscardDirtyProject("Import an ESCO Package as the active project"))) return;
    try {
      const text = await readFileAsText(file);
      const result = importProjectFromEscoPackage(text);
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import ESCO Package.");
        return;
      }
      const loaded = recordImportProvenance(result.project, { sourceType: "esco-project", fileName: file.name });
      loadProject(loaded);
      logActivity(
        "import",
        `Imported ESCO Package "${file.name}" and opened ${result.data.projectPath} with ${result.data.packageEntryCount} package entry(s).`,
      );
      rememberProject({ projectId: result.project.id, name: result.project.name, source: "imported", storage: "browser-file", fileName: file.name });
      push(
        "success",
        `Imported ESCO Package "${file.name}": opened ${result.data.projectPath} from ${result.data.packageEntryCount} entry(s). Integrity ${result.data.packageChecksumValid === false ? "not verified" : "verified"}.`,
      );
      for (const warning of result.warnings?.slice(0, 2) ?? []) push("warning", warning);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the ESCO Package.");
    }
  };
  const handleEscoArtifactSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = validateEscoNativeArtifact(text, file.name);
      setArtifactValidationPreview({
        fileName: file.name,
        validatedAt: new Date().toISOString(),
        ok: result.ok,
        summary: result.summary,
        checksum: result.checksum,
        errors: result.errors,
      });
      openDockTab("build");
      if (!result.ok || !result.summary) {
        logActivity("info", `Rejected ESCO artifact validation for "${file.name}": ${result.error ?? "invalid artifact"}. No project changes made.`);
        push("error", result.error ?? "Failed to validate ESCO artifact.");
        return;
      }
      const summary = result.summary;
      const noun =
        summary.validationType === "package"
          ? "ESCO package"
          : summary.validationType === "runtime"
            ? "ESCO Runtime"
            : summary.validationType === "controller-assets"
              ? "ESCO controller assets"
              : summary.validationType === "component"
                ? "ESCO component"
                : "ESCO artifact";
      const count =
        summary.entryCount !== undefined
          ? `${summary.entryCount} entr${summary.entryCount === 1 ? "y" : "ies"}`
          : summary.payloadCount !== undefined
            ? `${summary.payloadCount} payload item${summary.payloadCount === 1 ? "" : "s"}`
            : summary.checksumValid !== undefined
              ? `checksum ${summary.checksumValid ? "verified" : "not verified"}`
              : summary.kind;
      logActivity("info", `Validated ${noun} "${file.name}" (${count}). No project changes made.`);
      push("success", `Validated ${noun} "${file.name}": ${count}. No project changes made.`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the ESCO artifact.");
    }
  };
  const handleRuntimeSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await confirmDiscardDirtyProject("Import an ESCO Runtime as the active view"))) return;
    try {
      const text = await readFileAsText(file);
      const result = importEscoRuntime(text, file.name);
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import ESCO Runtime.");
        return;
      }
      loadProject(result.project);
      const r = result.data.runtime;
      logActivity(
        "import",
        `Imported ESCO Runtime "${result.project.name}" (read-only runtime source; checksum ${result.data.checksumValid ? "verified" : "UNVERIFIED"}).`,
      );
      push(
        "success",
        `Imported ESCO Runtime "${r.identity.projectName}": ${r.build.controllerCount} controller(s), ${r.build.routineCount} routine(s), ${r.build.tagCount} tag(s). Integrity ${result.data.checksumValid ? "verified" : "NOT verified"}.`,
      );
      push("warning", result.warnings?.[0] ?? "ESCO Runtime is read-only runtime source — open the source project to edit.");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the ESCO Runtime file.");
    }
  };
  const handleComponentExport = (result: ProjectActionResult<ComponentExportData>, fallbackLabel: string) => {
    if (!result.ok || !result.data) {
      push("error", result.error ?? `Failed to export ${fallbackLabel}.`);
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, result.data.mediaType);
    logActivity("export", `Exported ${result.data.envelope.kind} "${result.data.envelope.name}" -> ${result.data.fileName}.`);
    push("success", `Exported ${result.data.envelope.name} -> ${result.data.fileName}.`);
  };
  const handleExportRoutineComponent = (routineId: string) =>
    handleComponentExport(exportRoutineComponent(project, routineId), "routine");
  const handleExportTaskComponent = (taskId: string) =>
    handleComponentExport(exportTaskComponent(project, taskId), "task");
  const handleExportProgramComponent = (programId: string) =>
    handleComponentExport(exportProgramComponent(project, programId), "program");
  const handleExportControllerComponent = (controllerId: string) =>
    handleComponentExport(exportControllerComponent(project, controllerId), "controller");
  const handleExportTagComponent = (tagId: string) =>
    handleComponentExport(exportTagComponent(project, tagId), "tag");
  const handleExportDataTypeComponent = (dataTypeId: string) =>
    handleComponentExport(exportDataTypeComponent(project, dataTypeId), "data type");
  const handleExportCustomInstructionComponent = (instructionId: string) =>
    handleComponentExport(exportCustomInstructionComponent(project, instructionId), "custom instruction");
  const handleExportDeviceTreeComponent = (controllerId: string) =>
    handleComponentExport(exportDeviceTreeComponent(project, controllerId), "device tree");
  const handleExportDeviceDefinitionComponent = (controllerId: string, moduleId: string) =>
    handleComponentExport(exportDeviceDefinitionComponent(project, controllerId, moduleId), "device definition");
  const handleExportIoProfilePack = (controllerId: string) => {
    const result = exportIoProfilePack(project, controllerId);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to export I/O profile pack.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, result.data.mediaType);
    const controllerName = result.data.envelope.payload.controller.name;
    logActivity("export", `Exported ESCO I/O profile pack for "${controllerName}" -> ${result.data.fileName}.`);
    push("success", `Exported ESCO I/O profile pack -> ${result.data.fileName}. Offline metadata only.`);
  };
  /**
   * Guard unsupported project formats before any parse is attempted. Instead of
   * a fleeting toast, it opens a blocking file-policy modal and records the
   * attempt for this session. Returns true when the import should be aborted.
   */
  const guardImportFormat = (fileName: string, text?: string, path?: string): boolean => {
    const guard = detectUnsupportedProjectFormat(fileName, text);
    if (!guard.unsupported) return false;
    const info: FilePolicyInfo = {
      fileName,
      ...(path ? { path } : {}),
      formatLabel: guard.formatLabel ?? "Unsupported project format",
      reason: guard.reason ?? "This file format is not supported for offline interchange.",
      nextStep: guard.nextStep ?? "Import an L5X (XML) review file or an ESCO-native project instead.",
      supportedFormats: guard.supportedFormats,
      detectedAt: new Date().toISOString(),
    };
    logActivity("import", "Blocked unsupported proprietary/binary project import before reading file contents.");
    setFilePolicyInfo(info);
    setLastBlockedImport(info);
    return true;
  };

  const openProjectText = (
    text: string,
    fileName: string,
    file: DesktopTextFile | null,
    source: RecentProjectEntry["source"] = "opened",
  ): boolean => {
    if (guardImportFormat(fileName, text, file?.path)) return false;
    const result = importProjectFile(text);
    if (!result.ok) {
      push("error", result.error ?? "Failed to open project.");
      return false;
    }
    const savedFile = file ? { fileName: file.fileName, path: file.path } : null;
    loadProject(
      recordImportProvenance(result.project, {
        sourceType: "esco-project",
        fileName,
        ...(savedFile?.path ? { path: savedFile.path } : {}),
      }),
      savedFile,
    );
    logActivity("open", `Opened project "${result.project.name}".`);
    rememberProject({
      projectId: result.project.id,
      name: result.project.name,
      source,
      storage: savedFile ? "desktop-file" : "browser-file",
      fileName,
      path: savedFile?.path,
    });
    if (result.data?.migrationsApplied.length) {
      push("warning", `Opened and migrated "${result.project.name}" (${result.data.migrationsApplied.join(", ")}). Save to update the file.`);
    } else {
      push("success", `Opened project "${result.project.name}".`);
    }
    for (const warning of result.warnings?.slice(0, 2) ?? []) push("warning", warning);
    return true;
  };

  const handleImportClick = async (alreadyConfirmed = false) => {
    if (!alreadyConfirmed && !(await confirmDiscardDirtyProject("Open another project"))) return;
    try {
      const file = await openDesktopProjectFile();
      if (file === undefined) {
        openProjectAlreadyConfirmedRef.current = true;
        fileInputRef.current?.click();
        return;
      }
      if (file === null) {
        push("info", "Open canceled.");
        return;
      }
      openProjectText(file.text, file.fileName, file);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to open the project file.");
    }
  };
  const handleImportL5XClick = () => l5xInputRef.current?.click();
  const handleImportTagsCsvClick = () => tagCsvInputRef.current?.click();
  const handleCompareFileClick = () => compareInputRef.current?.click();

  // Load a second project (.plcproj.json or .L5X) to compare against the current one.
  const handleComparisonSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const isL5X = /\.(l5x|xml)$/i.test(file.name);
    try {
      const text = await readFileAsText(file);
      if (guardImportFormat(file.name, text)) return;
      const result = isL5X ? importL5XFile(text) : importProjectFile(text);
      if (result.ok) {
        setComparison({ name: file.name, project: result.project });
        logActivity("compare", `Loaded "${file.name}" for comparison.`);
        push("success", `Loaded "${file.name}" for comparison.`);
      } else {
        push("error", result.error ?? "Failed to load the comparison file.");
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const alreadyConfirmed = openProjectAlreadyConfirmedRef.current;
    openProjectAlreadyConfirmedRef.current = false;
    if (!alreadyConfirmed && !(await confirmDiscardDirtyProject("Open another project"))) return;
    try {
      openProjectText(await readFileAsText(file), file.name, null);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  const handleOpenRecentProject = async (entry: RecentProjectEntry) => {
    if (!entry.path) {
      push("info", "This recent item is metadata only. Choose the project file to reopen it.");
      void handleImportClick();
      return;
    }
    if (!(await confirmDiscardDirtyProject(`Open "${entry.name}"`))) return;
    try {
      const file = await readDesktopProjectFile(entry.path);
      if (file === undefined) {
        push("info", "Recent file paths are available in the desktop app. Choose the project file to reopen it.");
        void handleImportClick(true);
        return;
      }
      if (file === null) {
        push("info", "Open canceled.");
        return;
      }
      openProjectText(file.text, file.fileName, file, "opened");
    } catch (error) {
      setRecentProjects((current) => markRecentProjectMissing(current, entry.id));
      push(
        "error",
        error instanceof Error
          ? `${error.message} Choose the project file to relink this recent item.`
          : `Could not open "${entry.name}". Choose the project file to relink this recent item.`,
      );
      void handleImportClick(true);
    }
  };

  const handleL5XSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(await confirmDiscardDirtyProject("Import this L5X as the active project"))) return;
    const LARGE_L5X_MB = 25;
    if (file.size > LARGE_L5X_MB * 1024 * 1024) {
      push("warning", `Large L5X (${Math.round(file.size / 1048576)} MB) — import may take a moment.`);
    }
    try {
      const text = await readFileAsText(file);
      if (guardImportFormat(file.name, text)) return;
      const result = importL5XFile(text);
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import L5X file.");
        return;
      }
      loadProject(recordImportProvenance(result.project, { sourceType: "xml-review-import", fileName: file.name }));
      const s = result.data.summary;
      setLastImport({ name: result.project.name, summary: s });
      const counts = `${s.programs} program(s), ${s.routines} routine(s), ${s.rungs} rung(s), ${s.tags} tag(s)`;
      logActivity("import", `Imported L5X "${result.project.name}": ${counts}.`);
      rememberProject({ projectId: result.project.id, name: result.project.name, source: "imported", storage: "browser-file", fileName: file.name });
      const unsupported = s.unsupportedInstructions.length
        ? ` Unsupported: ${s.unsupportedInstructions.join(", ")}.`
        : "";
      const timing = s.durationMs != null ? ` (${s.durationMs} ms)` : "";
      push(
        s.warnings.length ? "warning" : "success",
        `Imported "${result.project.name}"${timing}: ${counts}.${unsupported}${s.warnings.length ? ` ${s.warnings.length} warning(s).` : ""}`,
      );
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  const handleTagCsvSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const csv = await readFileAsText(file);
      const preview = previewTagCsvImport(project, csv);
      setTagCsvPreview({ fileName: file.name, csv, preview });
      push(
        preview.errorCount ? "warning" : "success",
        `Previewed ${preview.rows.length} tag row(s): ${preview.createCount} create, ${preview.updateCount} update, ${preview.errorCount} error(s).`,
      );
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read tag CSV.");
    }
  };

  const handleApplyTagCsv = () => {
    if (!tagCsvPreview) return;
    const result = applyTagCsvImport(project, tagCsvPreview.csv);
    if (!result.ok || !result.data) {
      push("error", result.error ?? "Failed to import tag CSV.");
      return;
    }
    setProject(result.project);
    setValues(zeroValues(result.project));
    setTrendSamples([]);
    logActivity(
      "import",
      `Imported tag CSV "${tagCsvPreview.fileName}": ${result.data.created} created, ${result.data.updated} updated, ${result.data.skipped} skipped.`,
    );
    setTagCsvPreview(null);
    push("success", `Imported tag CSV: ${result.data.created} created, ${result.data.updated} updated.`);
  };

  // Selecting inspectable items surfaces local details in the copilot History tab.
  // AOI/UDT/trend/IO open their own center detail view, so they don't steal the side panel.
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "aoi" || selection.kind === "udt" || selection.kind === "trend" || selection.kind === "io") return;
    if (selection.kind !== "routine") setCopilotTab("history");
  }, [selection]);

  useEffect(() => {
    setRuntimeBuildPreview(null);
    setPackageBuildPreview(null);
  }, [project]);

  useEffect(() => {
    taskSchedulerStateRef.current = createOfflineTaskSchedulerState();
    taskScanSeqRef.current = 0;
    setTaskScanStats(resetTaskScanStats());
  }, [project.id]);

  // Continuous run uses the latest project + forces via refs.
  const projectRef = useRef(project);
  projectRef.current = project;
  const forcesRef = useRef(forces);
  forcesRef.current = forces;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => {
        const scan = scheduledScanOnce(
          projectRef.current,
          valuesRef.current,
          taskSchedulerStateRef.current,
          forcesRef.current,
          SCAN_INTERVAL_MS,
        );
        taskSchedulerStateRef.current = scan.schedulerState;
        const nextValues = scan.values;
        valuesRef.current = nextValues;
        setValues(nextValues);
        captureTrend(projectRef.current, nextValues);
        recordTaskScanCycle(projectRef.current, scan.scannedTaskKeys);
      },
      SCAN_INTERVAL_MS,
    );
    return () => clearInterval(id);
    // captureTrend writes state only; project/values refs keep the interval fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Undo/redo keyboard shortcuts (latest handlers via refs; native undo in text fields).
  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  const findNextRef = useRef(handleFindNext);
  const findPreviousRef = useRef(handleFindPrevious);
  const newProjectRef = useRef(handleOpenNewProjectDialog);
  const openProjectRef = useRef(handleImportClick);
  const saveProjectRef = useRef(() => requireProject(handleExport));
  const saveAsProjectRef = useRef(() => requireProject(handleExportAs));
  // Ctrl+F jumps to the Search Results dock tab (and focuses its input); F1 opens
  // the in-app Help panel — both work from anywhere, like a real IDE.
  const openFindRef = useRef(() => {});
  const openHelpRef = useRef(() => {});
  // Ctrl+Tab / Ctrl+Shift+Tab cycle the open routine tabs, like a real IDE.
  const cycleRoutineRef = useRef<(direction: 1 | -1) => void>(() => {});
  // Rung clipboard shortcuts only act when a ladder routine is open with a rung selected.
  const copyRungRef = useRef(() => {});
  const cutRungRef = useRef(() => {});
  const pasteRungRef = useRef(() => {});
  const addLadderElementRef = useRef(() => {});
  const deleteLadderSelectionRef = useRef(() => {});
  const hasDeleteLadderSelectionRef = useRef(false);
  const canCopyRungRef = useRef(false);
  const canPasteRungRef = useRef(false);
  const rungClipboardActive = view === "routine" && !!openLadder;
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;
  findNextRef.current = handleFindNext;
  findPreviousRef.current = handleFindPrevious;
  newProjectRef.current = handleOpenNewProjectDialog;
  openProjectRef.current = handleImportClick;
  saveProjectRef.current = () => requireProject(handleExport);
  saveAsProjectRef.current = () => requireProject(handleExportAs);
  openFindRef.current = () => openDockTab("search");
  openHelpRef.current = () => openCopilotPanel("help");
  cycleRoutineRef.current = (direction) => {
    if (view !== "routine") return;
    const ids = openRoutineTabs.map((routine) => routine.id);
    if (ids.length < 2) return;
    const current = openRoutineId ? ids.indexOf(openRoutineId) : -1;
    const start = current < 0 ? 0 : current;
    const next = (start + direction + ids.length) % ids.length;
    handleOpenRoutine(ids[next]);
  };
  canCopyRungRef.current = rungClipboardActive && !!selectedRungId;
  canPasteRungRef.current = rungClipboardActive && clipboardRung !== null && !controllerEditLocked;
  copyRungRef.current = () => {
    if (canCopyRungRef.current && selectedRungId) handleCopyRung(selectedRungId);
  };
  cutRungRef.current = () => {
    if (canCopyRungRef.current && selectedRungId) handleCutRung(selectedRungId);
  };
  pasteRungRef.current = () => {
    if (canPasteRungRef.current) handlePasteRung();
  };
  hasDeleteLadderSelectionRef.current =
    rungClipboardActive &&
    ((selection?.kind === "instruction" && selection.routineId === openRoutineId && !!selectedRungId && !!selectedNodeId) ||
      (selection?.kind === "rung" && selection.routineId === openRoutineId && !!selectedRungId));
  // Alt+Insert opens the Add Ladder Element picker for the selected rung.
  addLadderElementRef.current = () => {
    if (controllerEditLocked) {
      blockControllerLockedEdit("Add ladder element");
      return;
    }
    if (rungClipboardActive && selectedRungId) {
      setInstructionInsertTarget(
        selection?.kind === "instruction" && selectedNodeId && selection.routineId === openRoutineId
          ? { kind: "relative", routineId: selection.routineId, rungId: selectedRungId, nodeId: selectedNodeId, position: "after" }
          : openRoutineId
            ? { kind: "rung", routineId: openRoutineId, rungId: selectedRungId }
            : null,
      );
      setInstructionPickerOpen(true);
    }
  };
  deleteLadderSelectionRef.current = () => {
    if (!rungClipboardActive) return;
    if (controllerEditLocked) {
      blockControllerLockedEdit("Delete selection");
      return;
    }
    if (selection?.kind === "instruction" && selection.routineId === openRoutineId && selectedRungId && selectedNodeId) {
      handleRemoveInstruction(selectedRungId, selectedNodeId);
      return;
    }
    if (selection?.kind === "rung" && selection.routineId === openRoutineId && selectedRungId) handleDeleteRung(selectedRungId);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const resolution = resolveWorkbenchShortcut(event);
      if (!resolution) return;
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const editorOverlayOpen = () =>
        Boolean(
          document.querySelector(
            ".esco-context-menu, .esco-routine-command, .esco-confirmation, .esco-modal, .esco-instr-picker, [role='dialog']",
          ),
        );
      const isLadderShortcutTarget = (allowOperandInput = false) => {
        if (editorOverlayOpen()) return false;
        if (!target || target === document.body || target === document.documentElement) return true;
        if (
          allowOperandInput &&
          target instanceof HTMLInputElement &&
          target.classList.contains("esco-lad__operand") &&
          target.closest(".esco-editor__surface")
        ) {
          return true;
        }
        if (isTextEntry) return false;
        if (target.closest("button, select, a, [role='button'], [role='menuitem']")) return false;
        return Boolean(target.closest(".esco-editor__surface"));
      };
      // Editor commands (clipboard, undo/redo) defer to the browser's native
      // behaviour inside text fields; global commands fire everywhere.
      if (!resolution.global && isTextEntry) return;
      switch (resolution.command) {
        case "findNext":
          event.preventDefault();
          findNextRef.current();
          return;
        case "findPrevious":
          event.preventDefault();
          findPreviousRef.current();
          return;
        case "openFind":
          event.preventDefault();
          openFindRef.current();
          return;
        case "openHelp":
          event.preventDefault();
          openHelpRef.current();
          return;
        case "cycleTabNext":
          event.preventDefault();
          cycleRoutineRef.current(1);
          return;
        case "cycleTabPrevious":
          event.preventDefault();
          cycleRoutineRef.current(-1);
          return;
        case "newProject":
          event.preventDefault();
          newProjectRef.current();
          return;
        case "openProject":
          event.preventDefault();
          void openProjectRef.current();
          return;
        case "saveProject":
          event.preventDefault();
          saveProjectRef.current();
          return;
        case "saveProjectAs":
          event.preventDefault();
          saveAsProjectRef.current();
          return;
        case "copyRung":
        case "cutRung":
          // Don't hijack a genuine text selection (e.g. copying rung-comment text).
          if (!canCopyRungRef.current || window.getSelection()?.toString() || !isLadderShortcutTarget()) return;
          event.preventDefault();
          if (resolution.command === "copyRung") copyRungRef.current();
          else cutRungRef.current();
          return;
        case "pasteRung":
          if (!canPasteRungRef.current || !isLadderShortcutTarget()) return;
          event.preventDefault();
          pasteRungRef.current();
          return;
        case "addLadderElement":
          if (!isLadderShortcutTarget(true)) return;
          event.preventDefault();
          addLadderElementRef.current();
          return;
        case "deleteSelection":
          if (!hasDeleteLadderSelectionRef.current || !isLadderShortcutTarget()) return;
          event.preventDefault();
          deleteLadderSelectionRef.current();
          return;
        case "undo":
          event.preventDefault();
          undoRef.current();
          return;
        case "redo":
          event.preventDefault();
          redoRef.current();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDialogHelp = (event: Event) => {
      const detail = (event as CustomEvent<DialogHelpEventDetail>).detail;
      if (!detail?.title || !detail.body) return;
      setDialogHelp(detail);
    };
    window.addEventListener(DIALOG_HELP_EVENT, onDialogHelp);
    return () => window.removeEventListener(DIALOG_HELP_EVENT, onDialogHelp);
  }, []);

  useEffect(() => {
    const onConfirmation = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmationRequestDetail>).detail;
      if (!detail?.title || !detail.message || typeof detail.resolve !== "function") return;
      setConfirmation((current) => {
        current?.resolve(false);
        return detail;
      });
    };
    window.addEventListener(CONFIRMATION_EVENT, onConfirmation);
    return () => window.removeEventListener(CONFIRMATION_EVENT, onConfirmation);
  }, []);

  // Persist the workbench layout (active dock/inspector tabs, panel state) so the
  // shell comes back the way the user parked it on the next launch.
  useEffect(() => {
    saveWorkbenchLayout({ dockTab, copilotTab, rightPanelOpen });
  }, [dockTab, copilotTab, rightPanelOpen]);

  // Warn before closing/reloading the tab when there are unsaved changes.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = ""; // triggers the browser's native "unsaved changes" prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // On first load, offer to recover autosaved work from a previous session.
  useEffect(() => {
    const entry = loadAutosave();
    if (entry) setRecovery(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave (debounced) while there are unsaved changes; clear it when clean.
  useEffect(() => {
    if (!dirty) {
      clearAutosave();
      return;
    }
    const id = setTimeout(() => saveAutosave(project), 1000);
    return () => clearTimeout(id);
  }, [project, dirty]);

  const validationLabel = errorCount
    ? `${errorCount} error${errorCount > 1 ? "s" : ""}`
    : warnCount
      ? `${warnCount} warning${warnCount > 1 ? "s" : ""}`
      : "Verification Passed";
  const validationClass = errorCount ? "is-error" : warnCount ? "is-warn" : "is-ok";
  const virtualPathLabel = virtualController.snapshot.path
    ? `Virtual only: ${virtualCommPathDisplayLabel(virtualController.snapshot.path)}`
    : "No hardware path selected";
  const activeCommunicationPath = virtualPathLabel;
  const activeStatusPath = virtualPathLabel;
  const forceCount = Object.keys(forces).length;
  const pendingTestEditCount = project.controllers.reduce(
    (total, controller) =>
      total +
      controller.programs.filter((program) => {
        if (program.testEdits !== true) return false;
        const lifecycle = offlineEditLifecycle[program.id];
        return lifecycle !== "finalized" && lifecycle !== "canceled";
      }).length,
    0,
  );
  const requireProject = (next: () => void) => {
    if (!projectOpen) {
      push("info", "Create or import a project first.");
      return;
    }
    next();
  };
  const handleOpenGitTerminal = async () => {
    // Open the terminal in the current project's folder when we know it, otherwise
    // the desktop shell falls back to the user's home folder (e.g. to clone a repo).
    const filePath = projectFile?.path;
    const folder = filePath ? filePath.replace(/[\\/][^\\/]*$/, "") : undefined;
    if (projectOpen) setView("history");
    const result = await openGitTerminal(folder);
    if (result.ok) push("info", "Opened a Git terminal.");
    else if (projectOpen) push("info", `Project History opened. ${result.error ?? "Could not open a Git terminal."}`);
    else push("error", result.error ?? "Could not open a Git terminal.");
  };
  const focusWorkbenchSurface = () => {
    window.setTimeout(() => {
      const surface = document.querySelector<HTMLElement>(".esco-editor, .esco-detail, .esco-welcome");
      if (!surface) return;
      surface.scrollIntoView({ behavior: "smooth", block: "nearest" });
      surface.classList.add("is-flash");
      window.setTimeout(() => surface.classList.remove("is-flash"), 900);
      const focusTarget = surface.querySelector<HTMLElement>(
        ".esco-editor__surface, .esco-editor__empty, .esco-detail button, .esco-welcome button",
      );
      focusTarget?.focus?.();
    }, 0);
  };
  const handleMainWindow = () => {
    setRightPanelOpen(false);
    if (!projectOpen) {
      setView("welcome");
      focusWorkbenchSurface();
      push("info", "Main ESCO Automation Studio window is active.");
      return;
    }

    if (openRoutineId && findRoutine(project, openRoutineId)) {
      setView("routine");
      focusWorkbenchSurface();
      push("info", "Main routine window focused.");
      return;
    }

    setView("structure");
    if (!selection && activeContext.controller) setSelection({ kind: "controller", id: activeContext.controller.id });
    focusWorkbenchSurface();
    push("info", "Main project window focused.");
  };
  const handleVerify = (source?: DockTab) => {
    // Most Verify entry points focus the PLC-style Build/Output dock. Task
    // Monitor keeps focus so its per-task verification rows stay visible.
    if (source !== "tasks") openDockTab("build");
    // Walk the controller hierarchy and produce a real PLC-style build
    // report (per-component status + Output-window log + summary), all offline.
    const report = verifyProjectReport(project, findings, { includeIndustrialValidation: true });
    if (report.errorCount) {
      // Name the components that failed so the toast points the engineer at them.
      const failed = report.steps
        .filter((step) => step.kind !== "project" && step.errorCount > 0)
        .map((step) => step.label);
      const where = failed.length
        ? ` ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? `, +${failed.length - 3} more` : ""}.`
        : "";
      push("error", `${report.summary} in Offline Simulation.${where}`);
    } else if (report.warningCount) {
      push("warning", `${report.summary} in Offline Simulation.`);
    } else {
      push("success", `${report.summary} — verification passed in Offline Simulation.`);
    }
    logActivity("info", `Verified "${project.name}": ${report.summary}.`);
  };
  const handleSaveAiProfile = (draft: Partial<AiProfile>) => {
    const saved = saveAiProfile(draft);
    if (!saved) {
      push("error", "Enter a name and API key to finish AI setup.");
      return;
    }
    setAiProfile(saved);
    setSetupOpen(false);
    if (desktopStartupOpen) completeDesktopStartup("setup-saved");
    push("success", `AI setup saved for ${aiProfileModelLabel(saved)}.`);
  };
  const closeConfirmation = (confirmed: boolean) => {
    const active = confirmation;
    if (!active) return;
    setConfirmation(null);
    active.resolve(confirmed);
  };
  const confirmationDialog = confirmation ? (
    <div className={`esco-modal esco-confirmation esco-confirmation--${confirmation.tone ?? "warning"}`} role="presentation">
      <section
        className="esco-modal__panel esco-confirmation__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="esco-confirmation-title"
      >
        <header className="esco-modal__header">
          <div>
            <span className="esco-modal__eyebrow">Confirm action</span>
            <h2 id="esco-confirmation-title">{confirmation.title}</h2>
          </div>
          <button
            type="button"
            className="esco-icon-btn"
            aria-label="Cancel confirmation"
            onClick={() => closeConfirmation(false)}
          />
        </header>
        <div className="esco-confirmation__body">
          <p>{confirmation.message}</p>
        </div>
        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn" onClick={() => closeConfirmation(false)}>
              {confirmation.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              className={`esco-btn esco-btn--primary${confirmation.tone === "danger" ? " esco-btn--danger" : ""}`}
              onClick={() => closeConfirmation(true)}
            >
              {confirmation.confirmLabel ?? "OK"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  ) : null;
  const startup = desktopStartupOpen;
  const firstRunLoginRequired = startup && (!firstRunComplete || !aiProfile);

  if (startup) {
    return (
      <AppShell
        startup
        topBar={null}
        ribbon={null}
        toasts={
          <>
            <DesktopStartup
              hasBackup={!!recovery}
              requiresLogin={firstRunLoginRequired}
              signInReady={desktopSignInPrompted}
              onOpenProject={handleDesktopOpenProject}
              onNewProject={handleDesktopNewProject}
              onImportL5X={handleDesktopImportL5X}
              onRestoreBackup={handleDesktopRestoreBackup}
              onSignIn={handleDesktopSignIn}
              onContinueOffline={handleDesktopContinueOffline}
            />
            <FirstRunSetup
              open={setupOpen}
              profile={aiProfile}
              onClose={() => setSetupOpen(false)}
              onSave={handleSaveAiProfile}
            />
            {confirmationDialog}
          </>
        }
        left={null}
        center={null}
        right={null}
        bottomDock={null}
        statusBar={null}
      />
    );
  }

  return (
    <>
    <LiveBridge onProject={(next, isFirst) => (isFirst ? loadProject(next) : setProject(next))} />
    <FloatingAssistant
      project={project}
      selectedRoutineId={openRoutineId}
      selectedRungId={selectedRungId}
      modelLabel={aiProfileModelLabel(aiProfile)}
      aiProvider={aiProfile?.provider}
      modelId={aiProfile?.modelId}
      apiKey={aiProfile?.apiKey}
      onApplyPlan={handleApplyPlan}
      onOpenSetup={() => setSetupOpen(true)}
    />
    <AppShell
      startup={startup}
      topBar={
        <TopAppBar
          projectName={projectOpen ? project.name : "No project open"}
          projectOpen={projectOpen}
          dirty={dirty}
          lastExportedAt={lastExportedAt}
          openRoutineName={openRoutine?.name}
          validationLabel={validationLabel}
          validationClass={validationClass}
          connectionLabel={controllerSession.snapshot.stateLabel}
          connected={controllerSession.snapshot.connected}
          controllerCatalog={activeContext.controller?.catalogNumber}
          controllerRevision={activeContext.controller?.firmwareRevision}
          userLabel={aiProfile?.displayName ?? "User"}
          userInitials={profileInitials(aiProfile)}
          onHome={() => setView("welcome")}
          onOpenSettings={() => setSetupOpen(true)}
          onOpenController={() => openDockTab("controller")}
          onOpenDiagnostics={() => openDockTab("diagnostics")}
        />
      }
      ribbon={
        <RibbonToolbar
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          canPaste={clipboardRung !== null && !controllerEditLocked}
          canCopy={selectedRungId != null}
          canCut={selectedRungId != null && !controllerEditLocked}
          canEditLadder={!!openLadder && !controllerEditLocked}
          canClose={projectOpen}
          communicationPath={activeCommunicationPath}
          forceCount={forceCount}
          pendingTestEditCount={pendingTestEditCount}
          onHome={() => setView("welcome")}
          onClose={handleCloseProject}
          onTags={() => requireProject(() => setView("tags"))}
          onHmi={() => requireProject(() => setView("hmi"))}
          onCompare={() => requireProject(() => setView("compare"))}
          onProjectHistory={() => requireProject(() => setView("history"))}
          onSimulationLab={() => setView("simulation")}
          onGit={handleOpenGitTerminal}
          onMainWindow={handleMainWindow}
          onExport={() => requireProject(handleExport)}
          onSaveAs={() => requireProject(handleExportAs)}
          onExportL5X={() => requireProject(handleExportL5X)}
          onExportTagsCsv={() => requireProject(handleExportTagsCsv)}
          onImportProject={handleImportClick}
          onImportL5X={handleImportL5XClick}
          onBuildRuntime={() => requireProject(handleBuildRuntime)}
          onExportRuntime={() => requireProject(handleExportRuntime)}
          onImportRuntime={handleImportRuntimeClick}
          onSoftControllerDownloadRuntime={() => requireProject(handleSoftControllerDownloadRuntime)}
          onOpenSoftControllerUpload={handleOpenSoftControllerUpload}
          onExportSnapshot={() => requireProject(handleExportSnapshot)}
          onImportSnapshot={handleImportSnapshotClick}
          onExportLibrary={() => requireProject(handleExportLibrary)}
          onExportExchange={() => requireProject(handleExportExchange)}
          onImportExchange={handleImportExchangeClick}
          onExportPackage={() => requireProject(handleExportPackage)}
          onImportPackage={handleImportPackageClick}
          onValidateEscoArtifact={handleValidateEscoArtifactClick}
          onImportTagsCsv={() => requireProject(handleImportTagsCsvClick)}
          onNew={handleOpenNewProjectDialog}
          onAddRung={() => requireProject(handleAddRung)}
          onAddInstruction={(type) => selectedRungId && handleAddInstruction(selectedRungId, type)}
          onAddBranch={() => selectedRungId && handleAddParallelBranch(selectedRungId)}
          onAddBranchLeg={() => selectedRungId && handleAddBranchLeg(selectedRungId)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onCopy={() => selectedRungId && handleCopyRung(selectedRungId)}
          onCut={() => selectedRungId && handleCutRung(selectedRungId)}
          onPaste={handlePasteRung}
          onFind={() => requireProject(() => openDockTab("search"))}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          canFindNavigate={searchHits.length > 0}
          onProperties={() => requireProject(handleSelectionProperties)}
          onProjectProperties={() => requireProject(handleProjectProperties)}
          onControllerProperties={() => requireProject(handleControllerProperties)}
          onDockTab={openDockTab}
          onControllerAction={handleControllerAction}
          onVirtualSelectPath={handleVirtualSelectPath}
          onVirtualGoOnline={handleVirtualGoOnline}
          onVirtualMonitor={handleVirtualMonitor}
          onVirtualDownload={() => requireProject(handleVirtualDownload)}
          onVirtualUpload={handleVirtualUpload}
          onVirtualGoOffline={handleVirtualGoOffline}
          onVirtualSetMode={handleVirtualSetMode}
          onVirtualClearFaults={handleVirtualClearFaults}
          onHelpContents={handleHelpContents}
          onAbout={handleAbout}
          onToast={(message) => push("info", message)}
          onVerify={handleVerify}
        />
      }
      toasts={
        <>
          <Toasts toasts={toasts} onDismiss={dismiss} />
          <FirstRunSetup
            open={setupOpen}
            profile={aiProfile}
            onClose={() => setSetupOpen(false)}
            onSave={handleSaveAiProfile}
          />
          <AboutDialog
            open={aboutDialog.open}
            mode={aboutDialog.mode}
            lastBlockedImport={lastBlockedImport}
            onClose={() => setAboutDialog((prev) => ({ ...prev, open: false }))}
          />
          <FilePolicyDialog
            info={filePolicyInfo}
            onImportL5X={() => {
              setFilePolicyInfo(null);
              handleImportL5XClick();
            }}
            onShowNotes={() => {
              setFilePolicyInfo(null);
              setAboutDialog({ open: true, mode: "about" });
            }}
            onCancel={() => setFilePolicyInfo(null)}
          />
          {confirmationDialog}
          {dialogHelp ? (
            <div className="esco-modal esco-dialog-help" role="presentation">
              <section
                className="esco-modal__panel esco-dialog-help__panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="esco-dialog-help-title"
              >
                <header className="esco-modal__header">
                  <div>
                    <span className="esco-modal__eyebrow">Workflow help</span>
                    <h2 id="esco-dialog-help-title">{dialogHelp.title}</h2>
                  </div>
                  <button
                    type="button"
                    className="esco-icon-btn"
                    aria-label="Close Help"
                    onClick={() => setDialogHelp(null)}
                  />
                </header>
                <div className="esco-dialog-help__body">
                  <p>{dialogHelp.body}</p>
                </div>
                <footer className="esco-modal__footer">
                  <div className="esco-modal__actions">
                    <button type="button" className="esco-btn esco-btn--primary" onClick={() => setDialogHelp(null)}>
                      OK
                    </button>
                  </div>
                </footer>
              </section>
            </div>
          ) : null}
          <ProjectPropertiesDialog
            open={projectPropertiesOpen}
            project={project}
            projectFile={projectFile}
            onClose={() => setProjectPropertiesOpen(false)}
            onSave={handleSaveProjectProperties}
          />
          <ControllerPropertiesDialog
            open={controllerPropertiesOpen}
            controller={controllerPropertiesController ?? activeContext.controller ?? project.controllers[0]}
            projectName={project.name}
            onClose={() => {
              setControllerPropertiesOpen(false);
              setControllerPropertiesControllerId(undefined);
            }}
            onSave={handleSaveControllerProperties}
          />
          <NewProjectDialog
            open={newProjectDialogOpen}
            onClose={() => setNewProjectDialogOpen(false)}
            onCreate={handleCreateRoutineProject}
          />
          <NewRoutineDialog
            open={!!newRoutineProgramId}
            programId={newRoutineProgram?.id}
            programName={newRoutineProgram?.name}
            routines={newRoutineProgram?.routines}
            onClose={() => setNewRoutineProgramId(undefined)}
            onCreate={handleCreateRoutine}
          />
          <NewProgramDialog
            open={!!newProgramTarget}
            controller={newProgramContext?.controller}
            defaultTaskId={newProgramContext?.taskId}
            onClose={() => setNewProgramTarget(undefined)}
            onCreate={handleCreateProgram}
          />
          <NewTaskDialog
            open={!!newTaskControllerId}
            controller={newTaskController}
            onClose={() => setNewTaskControllerId(undefined)}
            onCreate={handleCreateTask}
          />
          <NewTagDialog
            open={newTagDialogOpen}
            project={project}
            initialScope={newTagDefaults.scope}
            initialProgramId={newTagDefaults.programId}
            initialName={newTagDefaults.name}
            initialDataType={newTagDefaults.dataType}
            onClose={() => setNewTagDialogOpen(false)}
            onCreate={handleCreateTagFromDialog}
          />
          <InstructionPicker
            open={instructionPickerOpen}
            targetLabel={
              instructionInsertTarget?.kind === "branch"
                ? `${selectedRungLabel} branch leg`
                : selectedRungLabel
            }
            onClose={() => {
              setInstructionPickerOpen(false);
              setInstructionInsertTarget(null);
            }}
            onInsert={(type) => {
              if (!handleInsertInstructionType(type) && selectedRungId) {
                handleAddInstruction(selectedRungId, type);
              }
              setInstructionPickerOpen(false);
            }}
          />
          <RoutinePropertiesDialog
            open={!!routinePropertiesRoutineId}
            routine={routinePropertiesRoutine}
            programName={routinePropertiesProgram?.name}
            routines={routinePropertiesProgram?.routines}
            onClose={() => setRoutinePropertiesRoutineId(undefined)}
            onSave={handleSaveRoutineProperties}
          />
          <ProgramPropertiesDialog
            open={!!programPropertiesProgramId}
            program={programPropertiesContext?.program}
            routines={programPropertiesContext?.program.routines}
            programs={programPropertiesContext?.controller.programs}
            controllerName={programPropertiesContext?.controller.name}
            onClose={() => setProgramPropertiesProgramId(undefined)}
            onSave={handleSaveProgramProperties}
          />
          <TaskPropertiesDialog
            open={!!taskPropertiesTaskId}
            task={taskPropertiesContext?.task}
            programs={taskPropertiesContext?.controller.programs}
            tasks={taskPropertiesContext?.controller.tasks}
            onClose={() => setTaskPropertiesTaskId(undefined)}
            onSave={handleSaveTaskProperties}
          />
          <AddExistingProgramDialog
            open={!!addExistingProgramTaskId}
            controller={addExistingProgramContext?.controller}
            task={addExistingProgramContext?.task}
            onClose={() => setAddExistingProgramTaskId(undefined)}
            onAdd={handleScheduleExistingProgram}
          />
          <IoModulePropertiesDialog
            open={!!ioModulePropertiesTarget}
            controller={ioModulePropertiesContext?.controller}
            module={ioModulePropertiesContext?.module}
            onClose={() => setIoModulePropertiesTarget(undefined)}
            onSave={handleSaveIoModuleProperties}
          />
          <NewIoModuleDialog
            open={!!newIoModuleControllerId}
            controller={newIoModuleController}
            initialQuery={newIoModuleInitialQuery}
            initialSlot={newIoModuleInitialSlot}
            existingModule={changeIoModuleContext?.module}
            onClose={() => {
              setNewIoModuleControllerId(undefined);
              setNewIoModuleInitialSlot(undefined);
              setNewIoModuleInitialQuery(undefined);
              setChangeIoModuleTarget(undefined);
            }}
            onCreate={handleCreateIoModule}
            onChange={handleChangeIoModule}
          />
          {tagCsvPreview ? (
            <TagCsvPreviewDialog
              fileName={tagCsvPreview.fileName}
              preview={tagCsvPreview.preview}
              onCancel={() => setTagCsvPreview(null)}
              onApply={handleApplyTagCsv}
            />
          ) : null}
          {componentImport ? (
            <ImportComponentDialog
              fileName={componentImport.fileName}
              initialPlan={componentImport.plan}
              recompute={recomputeComponentImport}
              onCancel={() => setComponentImport(null)}
              onApply={handleApplyComponentImport}
            />
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".easproj,.plcproj.json,.json,application/json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
          <input
            ref={l5xInputRef}
            type="file"
            accept=".l5x,.L5X,.xml"
            style={{ display: "none" }}
            onChange={handleL5XSelected}
          />
          <input
            ref={runtimeInputRef}
            type="file"
            accept={`${EASRT_EXTENSION},.easrt,application/json`}
            style={{ display: "none" }}
            onChange={handleRuntimeSelected}
          />
          <input
            ref={snapshotInputRef}
            type="file"
            accept={`${EASSNAPSHOT_EXTENSION},application/vnd.esco.snapshot+json,application/json`}
            style={{ display: "none" }}
            onChange={handleSnapshotSelected}
          />
          <input
            ref={exchangeInputRef}
            type="file"
            accept={`${EASX_EXTENSION},application/vnd.esco.exchange+json,application/json`}
            style={{ display: "none" }}
            onChange={handleExchangeSelected}
          />
          <input
            ref={packageInputRef}
            type="file"
            accept={`${EASPKG_EXTENSION},application/vnd.esco.package+json,application/json`}
            style={{ display: "none" }}
            onChange={handlePackageSelected}
          />
          <input
            ref={escoArtifactInputRef}
            type="file"
            accept={`${ESCO_ARTIFACT_EXTENSIONS.join(",")},.easrt,.esco-assets,.esco-trend,application/json,application/vnd.esco.component+json`}
            style={{ display: "none" }}
            onChange={handleEscoArtifactSelected}
          />
          <input
            ref={compareInputRef}
            type="file"
            accept=".easproj,.json,.plcproj.json,.l5x,.L5X,.xml,application/json"
            style={{ display: "none" }}
            onChange={handleComparisonSelected}
          />
          <input
            ref={tagCsvInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={handleTagCsvSelected}
          />
          <input
            ref={componentImportInputRef}
            type="file"
            accept=".json,.easlib,.easio,.l5x,.L5X,.xml,application/json,application/vnd.esco.component+json,application/vnd.esco.library+json,application/vnd.esco.io+json,text/xml,application/xml"
            style={{ display: "none" }}
            onChange={handleComponentImportSelected}
          />
        </>
      }
      recovery={
        !startup && recovery ? (
          <div className="esco-recovery" role="alert">
            <span className="esco-recovery__msg">
              Unsaved work from a previous session was found
              {recovery.savedAt ? ` (autosaved ${new Date(recovery.savedAt).toLocaleString()})` : ""}.
            </span>
            <div className="esco-recovery__actions">
              <button type="button" className="esco-btn esco-btn--primary" onClick={handleRestoreAutosave}>
                Restore autosave
              </button>
              <button type="button" className="esco-btn" onClick={handleDismissAutosave}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null
      }
      left={
        <ProjectExplorer
          project={project}
          selection={selection}
          onSelect={handleSelect}
          onControllerProperties={handleControllerProperties}
          onTaskProperties={handleTaskProperties}
          onNewTask={handleNewTask}
          onImportTask={handleImportTaskClick}
          onDeleteTask={handleDeleteTask}
          onExportTask={handleExportTaskComponent}
          onMonitorTasks={handleMonitorTasks}
          onToggleTaskInhibit={handleToggleTaskInhibit}
          onAddExistingProgram={handleAddExistingProgram}
          onVerifyController={handleVerify}
          onImportController={handleImportControllerComponentClick}
          onExportController={handleExportControllerComponent}
          onProgramProperties={handleProgramProperties}
          onNewProgram={handleNewProgram}
          onImportProgram={handleImportProgramClick}
          onDeleteProgram={handleDeleteProgram}
          onExportProgram={handleExportProgramComponent}
          onVerifyProgram={handleVerifyProgram}
          onNewRoutine={handleNewRoutine}
          onImportRoutine={handleImportRoutineClick}
          onRoutineProperties={handleRoutineProperties}
          onVerifyRoutine={handleVerifyRoutine}
          onCrossReferenceRoutine={handleCrossReferenceRoutine}
          onDeleteRoutine={handleDeleteRoutine}
          onExportRoutine={handleExportRoutineComponent}
          onNewTag={handleOpenNewTagDialog}
          onMonitorTags={handleMonitorTags}
          onImportTags={handleImportTagsCsvClick}
          onImportTagComponent={handleImportTagComponentClick}
          onExportTags={handleExportTagsCsv}
          onNewAddOnInstruction={handleNewAddOnInstruction}
          onImportAddOnInstruction={(controllerId) => handleImportComponentClick(controllerId, "aoi")}
          onExportAddOnInstructions={handleExportAddOnInstructions}
          onExportCustomInstruction={handleExportCustomInstructionComponent}
          onNewDataType={handleNewDataType}
          onImportDataType={(controllerId) => handleImportComponentClick(controllerId, "udt")}
          onExportDataTypes={handleExportDataTypes}
          onExportDataType={handleExportDataTypeComponent}
          onDeleteAoi={handleDeleteAoi}
          onDeleteUdt={handleDeleteUdt}
          onNewTrend={handleNewTrend}
          onImportTrend={(controllerId) => handleImportComponentClick(controllerId, "trend")}
          onExportTrends={handleExportTrends}
          onTrendProperties={handleTrendProperties}
          onExportTrend={handleExportTrend}
          onDeleteTrend={handleDeleteTrend}
          onNewIoModule={handleNewIoModule}
          onIoModuleProperties={handleIoModuleProperties}
          onIoModuleDiagnostics={handleIoModuleDiagnostics}
          onChangeIoModule={handleOpenChangeIoModule}
          onToggleIoModuleInhibit={handleToggleIoModuleInhibit}
          onDeleteIoModule={handleDeleteIoModule}
          onImportIoProfilePack={handleImportIoProfilePackClick}
          onExportIoProfilePack={handleExportIoProfilePack}
          onExportDeviceTree={handleExportDeviceTreeComponent}
          onExportDeviceDefinition={handleExportDeviceDefinitionComponent}
          onControllerAction={handleControllerAction}
          onVirtualSelectPath={handleVirtualSelectPath}
          onVirtualGoOnline={handleVirtualGoOnline}
          onVirtualMonitor={handleVirtualMonitor}
          onVirtualDownload={() => requireProject(handleVirtualDownload)}
          onVirtualUpload={handleVirtualUpload}
          onVirtualGoOffline={handleVirtualGoOffline}
          onVirtualSetMode={handleVirtualSetMode}
          onVirtualClearFaults={handleVirtualClearFaults}
          onSoftControllerDownloadRuntime={() => requireProject(handleSoftControllerDownloadRuntime)}
          onOpenSoftControllerUpload={handleOpenSoftControllerUpload}
          empty={!projectOpen}
        />
      }
      center={
        view === "simulation" ? (
          <SimulationLab />
        ) : view === "tags" ? (
          <TagsView
            project={project}
            values={values}
            onAddTag={handleAddTag}
            onRenameTag={handleRenameTag}
            onDeleteTag={handleDeleteTag}
            onEditDescription={handleEditDescription}
            onSetDataType={handleSetTagDataType}
            onSetDimensions={handleSetTagDimensions}
            onSetMetadata={handleSetTagMetadata}
            onSetAlias={handleSetTagAlias}
            onSetComments={handleSetTagComments}
            onSetEngineeringUnits={handleSetTagEngineeringUnits}
            forces={forces}
            onSetValue={handleSetMonitorValue}
            onToggleForce={handleToggleForce}
            onWatchTag={handleWatchTag}
            onCrossReferenceTag={handleCrossReferenceTag}
            onExportCsv={handleExportTagsCsv}
            onImportCsv={handleImportTagsCsvClick}
            onExportTagComponent={(tag) => handleExportTagComponent(tag.id)}
          />
        ) : view === "hmi" ? (
          <HmiDesigner
            hmi={hmiProject}
            knownTagPaths={hmiKnownTagPaths}
            selectedSurface={selectedHmiSurface}
            onEnableProject={handleEnableHmiProject}
            onCreateScreen={handleCreateHmiScreen}
            onCreatePopup={handleCreateHmiPopup}
            onAddElement={handleAddHmiElement}
            onSelectSurface={(surface) => {
              if (surface.kind === "screen") setSelection({ kind: "hmi-screen", id: surface.id });
              else if (surface.kind === "popup") setSelection({ kind: "hmi-popup", id: surface.id });
              else setSelection({ kind: "hmi-banner", id: surface.id });
            }}
            onUpdateElement={handleUpdateHmiElement}
            onUpdateElementGeometry={handleUpdateHmiElementGeometry}
            onDeleteElement={handleDeleteHmiElement}
            onSetBinding={handleSetHmiBinding}
            onRemoveBinding={handleRemoveHmiBinding}
            onAddEventCommand={handleAddHmiEventCommand}
            onRemoveEventCommand={handleRemoveHmiEventCommand}
            onSetHomeScreen={handleSetHmiHomeScreen}
            onRenameSurface={handleRenameHmiSurface}
            onSetSurfaceSecurityRoles={handleSetHmiSurfaceSecurityRoles}
            onDeleteSurface={handleDeleteHmiSurface}
            onBuildRuntimePackage={handleBuildHmiRuntimePackage}
            createRuntimeTagProvider={
              virtualController.softControllerStatus.runtimeLoaded
                ? virtualController.createSoftControllerRuntimeTagProvider
                : undefined
            }
            onCreateAlarm={handleCreateHmiAlarm}
            onUpdateAlarm={handleUpdateHmiAlarm}
            onDeleteAlarm={handleDeleteHmiAlarm}
            onCreateTrend={handleCreateHmiTrend}
            onUpdateTrend={handleUpdateHmiTrend}
            onDeleteTrend={handleDeleteHmiTrend}
            onAddTrendPen={handleAddHmiTrendPen}
            onRemoveTrendPen={handleRemoveHmiTrendPen}
            onCreateDataLog={handleCreateHmiDataLog}
            onUpdateDataLog={handleUpdateHmiDataLog}
            onDeleteDataLog={handleDeleteHmiDataLog}
            onCreateRecipe={handleCreateHmiRecipe}
            onAddRecipeItem={handleAddHmiRecipeItem}
            onRemoveRecipeItem={handleRemoveHmiRecipeItem}
            onDeleteRecipe={handleDeleteHmiRecipe}
            onCreateLanguage={handleCreateHmiLanguage}
            onDeleteLanguage={handleDeleteHmiLanguage}
            onSetLanguageString={handleSetHmiLanguageString}
            onRemoveLanguageString={handleRemoveHmiLanguageString}
            onSetDefaultLanguage={handleSetHmiDefaultLanguage}
            onExportLanguage={handleExportHmiLanguage}
            onImportLanguage={handleImportHmiLanguage}
            onCreateRole={handleCreateHmiRole}
            onDeleteRole={handleDeleteHmiRole}
            onCreateUser={handleCreateHmiUser}
            onDeleteUser={handleDeleteHmiUser}
          />
        ) : view === "compare" ? (
          <CompareView
            project={project}
            comparison={comparison}
            onChooseFile={handleCompareFileClick}
            onOpenRoutine={handleOpenRoutine}
          />
        ) : view === "history" ? (
          <ProjectHistoryView
            project={project}
            onRestored={(restored) => {
              setProject(restored);
              setValues(zeroValues(restored));
              restoreRoutineWindowState(restored, { preserveView: true });
            }}
            onToast={push}
          />
        ) : view === "structure" ? (
          <StructureView
            project={project}
            selection={selection}
            onOpenRoutine={handleOpenRoutine}
            editing={structureEditing}
            onNewIoModule={handleNewIoModule}
            onSelectIoModule={(controllerId, moduleId) => setSelection({ kind: "io", controllerId, moduleId })}
            onIoModuleProperties={handleIoModuleProperties}
            onToggleIoModuleInhibit={handleToggleIoModuleInhibit}
            onDeleteIoModule={handleDeleteIoModule}
          />
        ) : projectOpen && (view === "routine" || view === "welcome") ? (
          <EditorArea
            project={project}
            routine={view === "routine" ? openRoutine : undefined}
            routines={openRoutineTabs}
            activeRoutineId={openRoutineId}
            ladder={view === "routine" ? openLadder : undefined}
            findings={findings}
            selectedRungId={selectedRungId}
            selectedNodeId={selectedNodeId}
            onAddRung={handleAddRung}
            onDeleteRung={handleDeleteRung}
            onCopyRung={handleCopyRung}
            onCutRung={handleCutRung}
            onPasteRung={handlePasteRung}
            canPaste={clipboardRung !== null && !controllerEditLocked}
            editLocked={controllerEditLocked}
            onDuplicateRung={handleDuplicateRung}
            onInsertRung={handleInsertRung}
            onPasteRungRelative={handlePasteRungRelative}
            onAddBranchLeg={handleAddBranchLeg}
            onRemoveBranchLeg={handleRemoveBranchLeg}
            onVerifyRung={handleVerifyRung}
            onCrossReferenceRung={handleCrossReferenceRung}
            onInsertInstruction={handleInsertInstructionElement}
            onUnforceTag={handleUnforceTag}
            onSetRungComment={handleSetRungComment}
            onEditOperand={handleEditOperand}
            onRemoveInstruction={handleRemoveInstruction}
            onPickInstructionForBranch={handlePickInstructionForBranch}
            onCreateTag={handleCreateTag}
            onCreateTagFromOperand={handleCreateTagFromOperand}
            onAddLadderElement={(rungId) => {
              handleSelectRung(rungId);
              setInstructionInsertTarget(openRoutineId ? { kind: "rung", routineId: openRoutineId, rungId } : null);
              setInstructionPickerOpen(true);
            }}
            onSelectRung={handleSelectRung}
            onSelectNode={handleSelectNode}
            onAddParallelBranch={handleAddParallelBranch}
            onSetStructuredTextSource={handleSetStructuredTextSource}
            onEditTagProperties={handleEditTagProperties}
            onWatchTag={handleWatchTag}
            onCrossReferenceTag={handleCrossReferenceTag}
            onForceTag={handleForceTag}
            onToggleBit={handleToggleBit}
            onTrendTag={handleTrendTag}
            onInstructionHelp={handleInstructionHelp}
            onOpenRoutine={handleOpenRoutine}
            onCloseRoutine={handleCloseRoutineWindow}
            onControllerAction={handleControllerAction}
            editState={openRoutineEditState}
          />
        ) : (
          <WelcomeDashboard
            onCreateRoutine={handleCreateRoutineProject}
            onImportProject={handleImportClick}
            onImportL5X={handleImportL5XClick}
            onExport={() => requireProject(handleExport)}
            onOpenAi={() => openCopilotPanel("chat")}
            onOpenCrossRef={() => openDockTab("references")}
            onOpenWatch={() => openDockTab("watch")}
            onOpenTags={() => requireProject(() => setView("tags"))}
            onOpenCompare={() => requireProject(() => setView("compare"))}
            onOpenRecentProject={handleOpenRecentProject}
            projectOpen={projectOpen}
            recentProjects={recentProjects}
            lastImport={lastImport}
          />
        )
      }
      right={
        <RightCopilotPanel
          tab={copilotTab}
          onTabChange={setCopilotTab}
          empty={!projectOpen}
          modelName={aiProfileModelLabel(aiProfile)}
          project={project}
          selection={selection}
          values={values}
          findings={findings}
          selectedRoutineId={openRoutineId}
          openRoutineName={openRoutine?.name}
          aiProvider={aiProfile?.provider}
          modelId={aiProfile?.modelId}
          apiKey={aiProfile?.apiKey}
          onOpenSetup={() => setSetupOpen(true)}
          onApplyPlan={handleApplyPlan}
          undoDepth={history.undoDepth}
          redoDepth={history.redoDepth}
          dirty={dirty}
          activity={activity}
        />
      }
      rightOpen={rightPanelOpen}
      onRightOpenChange={setRightPanelOpen}
      bottomDock={
        <BottomPanel
          tab={dockTab}
          openKey={dockOpenKey}
          onTabChange={setDockTab}
          empty={!projectOpen}
          findings={findings}
          tags={rows}
          running={running}
          onToggleTag={handleToggleTag}
          onSetNumber={handleSetNumber}
          onSetString={handleSetString}
          onScanOnce={handleScanOnce}
          onTriggerEventTask={handleTriggerEventTaskScan}
          onReset={handleReset}
          onToggleRun={() => setRunning((value) => !value)}
          taskScanStats={taskScanStats}
          onResetTaskStats={handleResetTaskStats}
          forces={forces}
          onToggleForce={handleToggleForce}
          onClearForces={handleClearForces}
          trendSamples={trendSamples}
          scanIntervalMs={SCAN_INTERVAL_MS}
          onClearTrend={() => setTrendSamples([])}
          onVerify={handleVerify}
          runtimeBuildPreview={runtimeBuildPreview}
          packageBuildPreview={packageBuildPreview}
          artifactValidationPreview={artifactValidationPreview}
          onExportRuntime={handleExportRuntime}
          onExportPackage={handleExportPackage}
          onDownloadRuntimeToSoftController={handleSoftControllerDownloadRuntime}
          controller={controllerSession}
          onControllerToast={(kind, message) => push(kind, message)}
          virtualController={virtualController}
          onLoadUploadedImage={handleLoadUploadedImage}
          project={project}
          selectedTagName={selectedTagName}
          selectedTagPath={selectedTagPath}
          selectedRoutineId={selectedRoutineForCrossReference}
          selectedRoutineName={selectedRoutineNameForCrossReference}
          onOpenRoutine={handleOpenRoutine}
          onOpenDiagnosticTarget={handleOpenDiagnosticTarget}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onReplaceAll={handleReplaceAll}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          searchHits={searchHits}
          activeSearchIndex={activeSearchIndex}
          onOpenSearchHit={handleOpenSearchHit}
          onWatchTag={handleWatchTag}
          onCrossReferenceTag={handleCrossReferenceTag}
          onForceTag={handleForceTag}
        />
      }
      statusBar={
        <StatusBar
          projectOpen={projectOpen}
          controllerName={activeContext.controller?.name}
          verificationLabel={validationLabel}
          verificationClass={validationClass}
          errorCount={errorCount}
          warningCount={warnCount}
          running={running}
          selectedRungLabel={selectedRungLabel}
          path={activeStatusPath}
          connectionLabel={controllerSession.snapshot.stateLabel}
          connected={controllerSession.snapshot.connected}
          virtualStateLabel={virtualController.snapshot.stateLabel}
          virtualModeLabel={virtualController.snapshot.online ? virtualController.snapshot.modeLabel : undefined}
          virtualOnline={virtualController.snapshot.online}
          editState={openRoutineEditState}
          onOpenController={() => openDockTab("controller")}
          onOpenDiagnostics={() => openDockTab("diagnostics")}
          onBrowsePath={() => handleControllerAction("select-recent-path")}
        />
      }
    />
    </>
  );
}
