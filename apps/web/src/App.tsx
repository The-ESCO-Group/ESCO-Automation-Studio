import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { PlcProject } from "@esco/core";
import {
  addBranchLeg,
  addInstruction,
  addInstructionToBranch,
  addParallelBranch,
  addRung,
  addHmiElement,
  addHmiEventCommand,
  createTag,
  createHmiPopup as createHmiPopupAction,
  createHmiScreen as createHmiScreenAction,
  deleteHmiElement,
  deleteHmiPopup,
  deleteHmiScreen,
  deleteRung,
  deleteTag,
  duplicateRung,
  ensureHmiProject,
  removeHmiElementBinding,
  removeHmiEventCommand,
  renameHmiSurface,
  setHmiElementBinding,
  setHmiHomeScreen,
  updateHmiElement,
  updateHmiElementGeometry,
  exportProjectJson,
  exportProjectL5X,
  exportTagsCsv,
  findRoutine,
  getLadder,
  importL5XFile,
  importProjectFile,
  pasteRung,
  previewTagCsvImport,
  applyTagCsvImport,
  removeBranchLeg,
  removeInstruction,
  renameTag,
  setProjectProperties,
  setRungComment,
  setStructuredTextSource,
  setTagDescription,
  updateInstructionOperand,
  type ProjectActionResult,
  type TagCsvImportPreview,
} from "@esco/project-actions";
import { PLCPROJ_EXTENSION } from "@esco/project-store";
import { getHmiProject, type HmiGraphicElement, type HmiSurfaceKind } from "@esco/hmi-model";
import type { LadderBranch } from "@esco/ladder";
import type { ImportSummary } from "@esco/parser-l5x";
import { applyPlan, type ApplyResult, type AssistantPlan } from "@esco/ai-assistant";
import { createDefaultEngine } from "@esco/validator";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { EditorArea } from "./components/EditorArea";
import { BottomPanel, type DockTab } from "./components/BottomPanel";
import { WelcomeDashboard } from "./components/WelcomeDashboard";
import { TagsView } from "./components/TagsView";
import { CompareView } from "./components/CompareView";
import { StructureView } from "./components/StructureView";
import { Toasts } from "./components/Toasts";
import { AppShell } from "./components/AppShell";
import { TopAppBar } from "./components/TopAppBar";
import { RibbonToolbar } from "./components/RibbonToolbar";
import { RightCopilotPanel, type CopilotTab } from "./components/RightCopilotPanel";
import { StatusBar } from "./components/StatusBar";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { TagCsvPreviewDialog } from "./components/TagCsvPreviewDialog";
import { DesktopStartup } from "./components/DesktopStartup";
import { ProjectPropertiesDialog } from "./components/ProjectPropertiesDialog";
import { HmiDesigner, type BindingDraft, type ElementPatch } from "./components/hmi/HmiDesigner";
import type { Selection } from "./selection";
import { createBlankRoutineProject, createInitialProject, findMainRoutine } from "./project-edit";
import { searchProject } from "./search";
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
  scanOnce,
  traceOnce,
  watchRows,
  zeroValues,
  type Forces,
  type TagValues,
  type TraceEntry,
  type TrendSample,
} from "./simulation";
import { useToasts } from "./toasts";
import { useControllerSession } from "./controller-session";
import { useHistoryState } from "./history";
import { clearAutosave, loadAutosave, saveAutosave, type AutosaveEntry } from "./autosave";
import { recordActivity, type ActivityEntry, type ActivityKind } from "./activity";
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

const SCAN_INTERVAL_MS = 250;
const TREND_BUFFER_LIMIT = 120;
type CenterView = "welcome" | "routine" | "tags" | "compare" | "structure" | "hmi";

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
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [trendSamples, setTrendSamples] = useState<TrendSample[]>([]);
  const [running, setRunning] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [view, setView] = useState<CenterView>("welcome");
  const [openRoutineId, setOpenRoutineId] = useState<string | undefined>(undefined);
  const [dockTab, setDockTab] = useState<DockTab>("watch");
  const [copilotTab, setCopilotTab] = useState<CopilotTab>("chat");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [aiProfile, setAiProfile] = useState<AiProfile | null>(() => loadAiProfile());
  const [setupOpen, setSetupOpen] = useState(false);
  const [desktopStartupOpen, setDesktopStartupOpen] = useState(
    () => isDesktopStartupRequested() && !isFirstRunComplete(),
  );
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const [projectFile, setProjectFile] = useState<DesktopSavedFile | null>(null);
  const [projectPropertiesOpen, setProjectPropertiesOpen] = useState(false);
  const [tagCsvPreview, setTagCsvPreview] = useState<{
    fileName: string;
    csv: string;
    preview: TagCsvImportPreview;
  } | null>(null);

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
  const { toasts, push, dismiss } = useToasts();
  const controllerSession = useControllerSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const l5xInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const tagCsvInputRef = useRef<HTMLInputElement>(null);
  const openProjectAlreadyConfirmedRef = useRef(false);

  const findings = useMemo(() => createDefaultEngine().run(project), [project]);
  const rows = useMemo(() => watchRows(project, values), [project, values]);
  const hmiProject = getHmiProject(project);
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

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warning").length;

  // ---- Selection / navigation ----
  const handleSelect = (sel: Selection) => {
    setSelection(sel);
    if (sel?.kind === "routine") {
      setOpenRoutineId(sel.id);
      setView("routine");
    } else if (
      sel?.kind === "hmi" ||
      sel?.kind === "hmi-screen" ||
      sel?.kind === "hmi-popup" ||
      sel?.kind === "hmi-banner"
    ) {
      setView("hmi");
      setCopilotTab("history");
    } else if (
      sel?.kind === "project" ||
      sel?.kind === "controller" ||
      sel?.kind === "task" ||
      sel?.kind === "program" ||
      sel?.kind === "aoi" ||
      sel?.kind === "udt" ||
      sel?.kind === "io"
    ) {
      setView("structure");
      setCopilotTab("history");
    } else if (sel?.kind === "tag") {
      setCopilotTab("history");
    }
  };

  // ---- Ladder edits via the controlled action layer (target the open routine) ----
  const targetRoutineId = (p: PlcProject) => openRoutineId ?? findMainRoutine(p)?.id ?? "";
  const applyAction = (run: (p: PlcProject) => ProjectActionResult) =>
    setProject((current) => {
      const result = run(current);
      return result.ok ? result.project : current;
    });

  const handleAddRung = () => {
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = addRung(project, { routineId: rid });
    if (result.ok) {
      setProject(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    }
  };
  const handleDeleteRung = (rungId: string) =>
    applyAction((p) => deleteRung(p, { routineId: targetRoutineId(p), rungId }));
  const handleCopyRung = (rungId: string) => {
    const rung = openLadder?.rungs.find((r) => r.id === rungId);
    if (rung) {
      setClipboardRung({ root: rung.root, comment: rung.comment });
      push("info", `Copied rung ${rung.number}.`);
    }
  };
  const handleDuplicateRung = (rungId: string) =>
    applyAction((p) => duplicateRung(p, { routineId: targetRoutineId(p), rungId }));
  const handleCutRung = (rungId: string) => {
    handleCopyRung(rungId);
    handleDeleteRung(rungId);
  };
  const handlePasteRung = () => {
    if (!clipboardRung) return;
    const rid = targetRoutineId(project);
    if (!rid) return;
    const result = pasteRung(project, {
      routineId: rid,
      root: clipboardRung.root,
      comment: clipboardRung.comment,
    });
    if (result.ok) {
      setProject(result.project);
      if (result.data) setSelection({ kind: "rung", routineId: rid, rungId: result.data.rungId });
    }
  };
  const handleSelectRung = (rungId: string) => {
    setSelection({ kind: "rung", routineId: openRoutineId ?? "", rungId });
    setCopilotTab("history");
  };
  const handleSelectNode = (rungId: string, nodeId: string) => {
    setSelection({ kind: "instruction", routineId: openRoutineId ?? "", rungId, nodeId });
    setCopilotTab("history");
  };
  const handleSetRungComment = (rungId: string, comment: string) =>
    applyAction((p) => setRungComment(p, { routineId: targetRoutineId(p), rungId, comment }));
  const handleAddInstruction = (rungId: string, type: string) =>
    applyAction((p) => addInstruction(p, { routineId: targetRoutineId(p), rungId, instructionType: type }));
  const handleEditOperand = (rungId: string, nodeId: string, index: number, value: string) =>
    applyAction((p) => updateInstructionOperand(p, { routineId: targetRoutineId(p), rungId, nodeId, index, value }));
  const handleRemoveInstruction = (rungId: string, nodeId: string) =>
    applyAction((p) => removeInstruction(p, { routineId: targetRoutineId(p), rungId, nodeId }));
  const handleCreateTag = (name: string, dataType: string) =>
    applyAction((p) => createTag(p, { name, dataType }));

  // ---- Branch editing (parallel/seal-in branches, incl. nested) ----
  const handleAddParallelBranch = (rungId: string, branchId?: string) =>
    applyAction((p) => addParallelBranch(p, { routineId: targetRoutineId(p), rungId, branchId }));
  const handleAddBranchLeg = (rungId: string, branchId?: string) =>
    applyAction((p) => addBranchLeg(p, { routineId: targetRoutineId(p), rungId, branchId }));
  const handleRemoveBranchLeg = (rungId: string, branchId: string) =>
    applyAction((p) => removeBranchLeg(p, { routineId: targetRoutineId(p), rungId, branchId }));
  const handleAddToBranch = (rungId: string, branchId: string, type: string) =>
    applyAction((p) =>
      addInstructionToBranch(p, { routineId: targetRoutineId(p), rungId, branchId, instructionType: type }),
    );
  const handleSetStructuredTextSource = (routineId: string, source: string) => {
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
  const handleAddTag = (name: string, dataType: string, description: string) =>
    runTagAction(createTag(project, { name, dataType, description: description || undefined }), `Created tag ${name}.`);
  const handleRenameTag = (from: string, to: string) =>
    runTagAction(renameTag(project, { from, to }), `Renamed ${from} → ${to}.`);
  const handleDeleteTag = (name: string) =>
    runTagAction(deleteTag(project, { name }), `Deleted tag ${name}.`);
  const handleEditDescription = (name: string, description: string) =>
    runTagAction(setTagDescription(project, { name, description }), undefined, false);

  // ---- Undo / redo (reverts project edits; simulation values resync) ----
  const handleUndo = () => {
    if (!history.canUndo) return;
    if (history.undoTarget) setValues(zeroValues(history.undoTarget));
    setTrendSamples([]);
    history.undo();
  };
  const handleRedo = () => {
    if (!history.canRedo) return;
    if (history.redoTarget) setValues(zeroValues(history.redoTarget));
    setTrendSamples([]);
    history.redo();
  };

  // ---- Simulation ----
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleSetNumber = (name: string, value: number) =>
    setValues((current) => ({ ...current, [name]: value }));
  const captureTrend = (nextProject: PlcProject, nextValues: TagValues) => {
    const sample = createTrendSample(watchRows(nextProject, nextValues));
    setTrendSamples((samples) => [...samples, sample].slice(-TREND_BUFFER_LIMIT));
  };
  const handleScanOnce = () => {
    const result = traceOnce(project, values, forces);
    setValues(result.values);
    setTrace(result.trace);
    captureTrend(project, result.values);
  };
  const handleReset = () => {
    setValues(zeroValues(project));
    setTrace([]);
    setTrendSamples([]);
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
      logActivity("ai", `Applied "${plan.title}" — ${result.applied.length} action(s).`);
    }
    return result;
  };
  const selectedTagName =
    selection?.kind === "tag"
      ? project.controllers
          .flatMap((c) => [...c.controllerTags, ...c.programs.flatMap((p) => p.programTags)])
          .find((tag) => tag.id === selection.id)?.name
      : undefined;
  const handleOpenRoutine = (routineId: string) => handleSelect({ kind: "routine", id: routineId });
  const handleProjectProperties = () => {
    setSelection({ kind: "project", id: project.id });
    setView("structure");
    setCopilotTab("history");
    setProjectPropertiesOpen(true);
  };
  const handleSaveProjectProperties = (input: { name: string; description?: string }) => {
    const result = setProjectProperties(project, input);
    if (!result.ok) {
      push("error", result.error ?? "Could not update project properties.");
      return;
    }
    setProject(result.project);
    setProjectPropertiesOpen(false);
    push("success", "Project properties updated.");
  };
  const handleControllerProperties = () => {
    const controller = project.controllers[0];
    if (!controller) {
      push("info", "Create or import a project first.");
      return;
    }
    handleSelect({ kind: "controller", id: controller.id });
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
  const handleAddHmiNavigation = (
    surfaceKind: HmiSurfaceKind,
    surfaceId: string,
    elementId: string,
    targetScreenId: string,
    eventType: "press" | "release",
  ) =>
    applyHmiEdit(
      addHmiEventCommand(project, {
        surfaceKind,
        surfaceId,
        elementId,
        eventType,
        command: {
          id: hmiLocalId("hmicmd"),
          type: "navigate",
          safety: "runtime-preview",
          args: { screenId: targetScreenId },
        },
      }),
      "Added navigation event.",
    );
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
  const handleSetHmiHomeScreen = (screenId: string) =>
    applyHmiEdit(setHmiHomeScreen(project, { screenId }), "Set HMI home screen.");
  const handleRenameHmiSurface = (surfaceKind: "screen" | "popup", surfaceId: string, name: string) =>
    applyHmiEdit(renameHmiSurface(project, { surfaceKind, surfaceId, name }), "Renamed HMI surface.");
  const handleDeleteHmiSurface = (surfaceKind: "screen" | "popup", surfaceId: string) => {
    const result =
      surfaceKind === "screen"
        ? deleteHmiScreen(project, { screenId: surfaceId })
        : deleteHmiPopup(project, { popupId: surfaceId });
    if (applyHmiEdit(result, `Deleted HMI ${surfaceKind}.`)) {
      setSelection({ kind: "hmi", id: hmiProject?.id ?? "hmi" });
    }
  };

  const selectedRungId =
    selection?.kind === "rung" || selection?.kind === "instruction" ? selection.rungId : undefined;
  const selectedRungLabel = selectedRungId
    ? `Rung ${String(openLadder?.rungs.find((rung) => rung.id === selectedRungId)?.number ?? "--").padStart(3, "0")}`
    : "Rung --";

  const [searchQuery, setSearchQuery] = useState("");
  const searchHits = useMemo(() => searchProject(project, searchQuery), [project, searchQuery]);
  const selectedNodeId = selection?.kind === "instruction" ? selection.nodeId : undefined;
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
    !dirty || window.confirm(`${action}? Unsaved changes will be lost.`);

  const loadProject = (loaded: PlcProject, file: DesktopSavedFile | null = null) => {
    history.reset(loaded); // opening/importing a project is a fresh undo baseline
    setSavedProject(loaded); // freshly loaded = no unsaved changes
    setProjectOpen(true);
    setProjectFile(file);
    setValues(zeroValues(loaded));
    setForces({});
    setTrace([]);
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setRecovery(null);
    clearAutosave(); // starting from a file supersedes any recovered autosave
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

  const handleCreateRoutineProject = () => {
    if (!confirmDiscardDirtyProject("Create a new project")) return;
    const blank = createBlankRoutineProject();
    history.reset(blank);
    setSavedProject(initialProject);
    setProjectOpen(true);
    setProjectFile(null);
    setValues(zeroValues(blank));
    setForces({});
    setTrace([]);
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setRecovery(null);
    const main = findMainRoutine(blank);
    if (main) {
      setOpenRoutineId(main.id);
      setSelection({ kind: "routine", id: main.id });
      setView("routine");
    }
    rememberProject({ projectId: blank.id, name: blank.name, source: "created", storage: "metadata" });
  };

  const handleCloseProject = () => {
    if (dirty && !window.confirm("Close the project? Unsaved changes will be lost.")) return;
    history.reset(initialProject);
    setSavedProject(initialProject);
    setProjectOpen(false);
    setProjectFile(null);
    setValues(zeroValues(initialProject));
    setForces({});
    setTrace([]);
    setTrendSamples([]);
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setRecovery(null);
    setOpenRoutineId(undefined);
    setSelection(null);
    setView("welcome");
    clearAutosave();
    push("info", "Project closed.");
  };

  // ---- Autosave recovery ----
  const handleRestoreAutosave = () => {
    if (!recovery) return;
    if (!confirmDiscardDirtyProject("Restore autosaved work")) return;
    history.reset(recovery.project);
    setProjectOpen(true);
    setProjectFile(null);
    setValues(zeroValues(recovery.project));
    setForces({});
    setTrace([]);
    setTrendSamples([]);
    setSavedProject(initialProject); // recovered work is unsaved → stays dirty
    setRunning(false);
    setLastExportedAt(null);
    setLastImport(null);
    setComparison(null);
    setClipboardRung(null);
    setTagCsvPreview(null);
    setProjectPropertiesOpen(false);
    setRecovery(null);
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
    setDesktopStartupOpen(false);
    void promoteDesktopWindowToIde();
  };
  const handleDesktopOpenProject = () => {
    completeDesktopStartup("open-project");
    setTimeout(() => handleImportClick(), 0);
  };
  const handleDesktopNewProject = () => {
    completeDesktopStartup("new-project");
    handleCreateRoutineProject();
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
    handleRestoreAutosave();
  };
  const handleDesktopContinueOffline = () => {
    completeDesktopStartup("continue-offline");
    push("info", "Workspace ready in Offline Simulation. No controller connection active.");
  };
  const handleDesktopSignIn = () => {
    setSetupOpen(true);
    push("info", "Microsoft SSO is not configured yet. Save a local AI profile or continue offline.");
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

    const filename = `${slugify(project.name)}${PLCPROJ_EXTENSION}`;
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
    downloadTextFile(filename, result.data.text);
    logActivity("export", `Generated offline L5X "${filename}".`);
    rememberProject({ projectId: project.id, name: project.name, source: "exported", storage: "download", fileName: filename });
    push("success", "Generated offline L5X. Review before use. No .ACD modification.");
    if (result.warnings?.length) push("warning", `${result.warnings.length} L5X export warning(s). Review generated file before use.`);
  };
  const handleExportTagsCsv = () => {
    const filename = `${slugify(project.name)}-tags.csv`;
    downloadTextFile(filename, exportTagsCsv(project));
    logActivity("export", `Exported tag CSV "${filename}".`);
    push("success", `Exported tag CSV "${filename}".`);
  };
  const openProjectText = (
    text: string,
    fileName: string,
    file: DesktopTextFile | null,
    source: RecentProjectEntry["source"] = "opened",
  ): boolean => {
    const result = importProjectFile(text);
    if (!result.ok) {
      push("error", result.error ?? "Failed to open project.");
      return false;
    }
    const savedFile = file ? { fileName: file.fileName, path: file.path } : null;
    loadProject(result.project, savedFile);
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

  const handleImportClick = async () => {
    if (!confirmDiscardDirtyProject("Open another project")) return;
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
    if (!alreadyConfirmed && !confirmDiscardDirtyProject("Open another project")) return;
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
    if (!confirmDiscardDirtyProject(`Open "${entry.name}"`)) return;
    try {
      const file = await readDesktopProjectFile(entry.path);
      if (file === undefined) {
        push("info", "Recent file paths are available in the desktop app. Choose the project file to reopen it.");
        void handleImportClick();
        return;
      }
      if (file === null) {
        push("info", "Open canceled.");
        return;
      }
      openProjectText(file.text, file.fileName, file, "opened");
    } catch (error) {
      setRecentProjects((current) => markRecentProjectMissing(current, entry.id));
      push("error", error instanceof Error ? error.message : `Could not open "${entry.name}". The file may have moved or been deleted.`);
    }
  };

  const handleL5XSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirmDiscardDirtyProject("Import this L5X as the active project")) return;
    const LARGE_L5X_MB = 25;
    if (file.size > LARGE_L5X_MB * 1024 * 1024) {
      push("warning", `Large L5X (${Math.round(file.size / 1048576)} MB) — import may take a moment.`);
    }
    try {
      const result = importL5XFile(await readFileAsText(file));
      if (!result.ok || !result.data) {
        push("error", result.error ?? "Failed to import L5X file.");
        return;
      }
      loadProject(result.project);
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
  // AOI/UDT/IO open their own center detail view, so they don't steal the side panel.
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "aoi" || selection.kind === "udt" || selection.kind === "io") return;
    if (selection.kind !== "routine") setCopilotTab("history");
  }, [selection]);

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
        const nextValues = scanOnce(projectRef.current, valuesRef.current, forcesRef.current);
        valuesRef.current = nextValues;
        setValues(nextValues);
        captureTrend(projectRef.current, nextValues);
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
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return; // let the browser handle undo inside text fields
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoRef.current();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const requireProject = (next: () => void) => {
    if (!projectOpen) {
      push("info", "Create or import a project first.");
      return;
    }
    next();
  };
  const handleVerify = () => {
    setDockTab("diagnostics");
    if (errorCount) {
      push("error", `Verification found ${errorCount} error${errorCount > 1 ? "s" : ""}.`);
    } else if (warnCount) {
      push("warning", `Verification found ${warnCount} warning${warnCount > 1 ? "s" : ""}.`);
    } else {
      push("success", "Verification passed in Offline Simulation.");
    }
    logActivity("info", `Verified "${project.name}": ${errorCount} error(s), ${warnCount} warning(s).`);
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

  return (
    <AppShell
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
          userLabel={aiProfile?.displayName ?? "User"}
          userInitials={profileInitials(aiProfile)}
          onHome={() => setView("welcome")}
          onOpenSettings={() => setSetupOpen(true)}
        />
      }
      ribbon={
        <RibbonToolbar
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          canPaste={clipboardRung !== null}
          canCopy={selectedRungId != null}
          canEditLadder={!!openLadder}
          canClose={projectOpen}
          onHome={() => setView("welcome")}
          onClose={handleCloseProject}
          onTags={() => requireProject(() => setView("tags"))}
          onCompare={() => requireProject(() => setView("compare"))}
          onExport={() => requireProject(handleExport)}
          onSaveAs={() => requireProject(handleExportAs)}
          onExportL5X={() => requireProject(handleExportL5X)}
          onExportTagsCsv={() => requireProject(handleExportTagsCsv)}
          onImportProject={handleImportClick}
          onImportL5X={handleImportL5XClick}
          onImportTagsCsv={() => requireProject(handleImportTagsCsvClick)}
          onNew={handleCreateRoutineProject}
          onAddRung={() => requireProject(handleAddRung)}
          onAddInstruction={(type) => selectedRungId && handleAddInstruction(selectedRungId, type)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onCopy={() => selectedRungId && handleCopyRung(selectedRungId)}
          onCut={() => selectedRungId && handleCutRung(selectedRungId)}
          onPaste={handlePasteRung}
          onFind={() => requireProject(() => setDockTab("search"))}
          onProperties={() => openCopilotPanel("history")}
          onProjectProperties={() => requireProject(handleProjectProperties)}
          onControllerProperties={() => requireProject(handleControllerProperties)}
          onOpenCopilot={() => openCopilotPanel("chat")}
          onDockTab={setDockTab}
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
          <ProjectPropertiesDialog
            open={projectPropertiesOpen}
            project={project}
            projectFile={projectFile}
            onClose={() => setProjectPropertiesOpen(false)}
            onSave={handleSaveProjectProperties}
          />
          {desktopStartupOpen ? (
            <DesktopStartup
              hasBackup={!!recovery}
              onOpenProject={handleDesktopOpenProject}
              onNewProject={handleDesktopNewProject}
              onImportL5X={handleDesktopImportL5X}
              onRestoreBackup={handleDesktopRestoreBackup}
              onSignIn={handleDesktopSignIn}
              onContinueOffline={handleDesktopContinueOffline}
            />
          ) : null}
          {tagCsvPreview ? (
            <TagCsvPreviewDialog
              fileName={tagCsvPreview.fileName}
              preview={tagCsvPreview.preview}
              onCancel={() => setTagCsvPreview(null)}
              onApply={handleApplyTagCsv}
            />
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".plcproj.json,.json,application/json"
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
            ref={compareInputRef}
            type="file"
            accept=".json,.plcproj.json,.l5x,.L5X,.xml,application/json"
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
        </>
      }
      activityItems={[
        {
          id: "welcome",
          label: "Welcome",
          icon: "⌂",
          active: view === "welcome",
          onClick: () => setView("welcome"),
        },
        {
          id: "project",
          label: "Project Explorer",
          icon: "⌘",
          active: view === "routine" || view === "structure",
          onClick: () => {
            const id = openRoutineId ?? findMainRoutine(project)?.id;
            if (id) handleSelect({ kind: "routine", id });
            else requireProject(() => setView("welcome"));
          },
        },
        {
          id: "tags",
          label: "Tags",
          icon: "#",
          active: view === "tags",
          onClick: () => requireProject(() => setView("tags")),
        },
        {
          id: "hmi",
          label: "HMI Designer",
          icon: "HMI",
          active: view === "hmi",
          onClick: () => requireProject(() => setView("hmi")),
        },
        {
          id: "compare",
          label: "Compare",
          icon: "◇",
          active: view === "compare",
          onClick: () => requireProject(() => setView("compare")),
        },
        {
          id: "watch",
          label: "Watch",
          icon: "◉",
          active: false,
          onClick: () => setDockTab("watch"),
        },
        {
          id: "copilot",
          label: "AI Copilot",
          icon: "✦",
          active: false,
          onClick: () => openCopilotPanel("chat"),
        },
      ]}
      recovery={
        recovery ? (
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
      left={<ProjectExplorer project={project} selection={selection} onSelect={handleSelect} empty={!projectOpen} />}
      center={
        view === "tags" ? (
          <TagsView
            project={project}
            values={values}
            onAddTag={handleAddTag}
            onRenameTag={handleRenameTag}
            onDeleteTag={handleDeleteTag}
            onEditDescription={handleEditDescription}
            onExportCsv={handleExportTagsCsv}
            onImportCsv={handleImportTagsCsvClick}
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
            onAddNavigationEvent={handleAddHmiNavigation}
            onRemoveEventCommand={handleRemoveHmiEventCommand}
            onSetHomeScreen={handleSetHmiHomeScreen}
            onRenameSurface={handleRenameHmiSurface}
            onDeleteSurface={handleDeleteHmiSurface}
          />
        ) : view === "compare" ? (
          <CompareView
            project={project}
            comparison={comparison}
            onChooseFile={handleCompareFileClick}
          />
        ) : view === "structure" ? (
          <StructureView project={project} selection={selection} onOpenRoutine={handleOpenRoutine} />
        ) : view === "routine" && openRoutine ? (
          <EditorArea
            project={project}
            routine={openRoutine}
            routines={activeContext.routines}
            activeRoutineId={openRoutineId}
            ladder={openLadder}
            findings={findings}
            selectedRungId={selectedRungId}
            selectedNodeId={selectedNodeId}
            onAddRung={handleAddRung}
            onDeleteRung={handleDeleteRung}
            onCopyRung={handleCopyRung}
            onDuplicateRung={handleDuplicateRung}
            onPasteRung={handlePasteRung}
            canPaste={clipboardRung !== null}
            onAddInstruction={handleAddInstruction}
            onEditOperand={handleEditOperand}
            onRemoveInstruction={handleRemoveInstruction}
            onCreateTag={handleCreateTag}
            onSelectRung={handleSelectRung}
            onSelectNode={handleSelectNode}
            onSetRungComment={handleSetRungComment}
            onAddParallelBranch={handleAddParallelBranch}
            onAddBranchLeg={handleAddBranchLeg}
            onRemoveBranchLeg={handleRemoveBranchLeg}
            onAddToBranch={handleAddToBranch}
            onSetStructuredTextSource={handleSetStructuredTextSource}
            onOpenRoutine={handleOpenRoutine}
          />
        ) : (
          <WelcomeDashboard
            onCreateRoutine={handleCreateRoutineProject}
            onImportProject={handleImportClick}
            onImportL5X={handleImportL5XClick}
            onExport={() => requireProject(handleExport)}
            onOpenAi={() => openCopilotPanel("chat")}
            onOpenCrossRef={() => setDockTab("references")}
            onOpenWatch={() => setDockTab("watch")}
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
          onTabChange={setDockTab}
          empty={!projectOpen}
          findings={findings}
          tags={rows}
          running={running}
          onToggleTag={handleToggleTag}
          onSetNumber={handleSetNumber}
          onScanOnce={handleScanOnce}
          onReset={handleReset}
          onToggleRun={() => setRunning((value) => !value)}
          forces={forces}
          onToggleForce={handleToggleForce}
          onClearForces={handleClearForces}
          trace={trace}
          trendSamples={trendSamples}
          scanIntervalMs={SCAN_INTERVAL_MS}
          onClearTrend={() => setTrendSamples([])}
          project={project}
          selectedTagName={selectedTagName}
          onOpenRoutine={handleOpenRoutine}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchHits={searchHits}
          activity={activity}
          onClearActivity={() => setActivity([])}
          controller={controllerSession}
          onToast={push}
        />
      }
      statusBar={
        <StatusBar
          projectOpen={projectOpen}
          controllerName={activeContext.controller?.name}
          programName={activeContext.program?.name}
          routineName={openRoutine?.name}
          verificationLabel={validationLabel}
          verificationClass={validationClass}
          errorCount={errorCount}
          warningCount={warnCount}
          running={running}
          selectedRungLabel={selectedRungLabel}
          connectionLabel={controllerSession.snapshot.stateLabel}
          connected={controllerSession.snapshot.connected}
        />
      }
    />
  );
}
