import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { PlcProject } from "@esco/core";
import {
  addBranchLeg,
  addInstruction,
  addInstructionToBranch,
  addParallelBranch,
  addRung,
  createTag,
  deleteRung,
  deleteTag,
  duplicateRung,
  exportProjectJson,
  findRoutine,
  getLadder,
  importL5XFile,
  importProjectFile,
  pasteRung,
  removeBranchLeg,
  removeInstruction,
  renameTag,
  setRungComment,
  setTagDescription,
  updateInstructionOperand,
  type ProjectActionResult,
} from "@esco/project-actions";
import { PLCPROJ_EXTENSION } from "@esco/project-store";
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
import type { Selection } from "./selection";
import { createBlankRoutineProject, createInitialProject, findMainRoutine } from "./project-edit";
import { downloadTextFile, readFileAsText, slugify } from "./file-io";
import { scanOnce, traceOnce, watchRows, zeroValues, type Forces, type TagValues, type TraceEntry } from "./simulation";
import { useToasts } from "./toasts";
import { useHistoryState } from "./history";
import { clearAutosave, loadAutosave, saveAutosave, type AutosaveEntry } from "./autosave";
import { recordActivity, type ActivityEntry, type ActivityKind } from "./activity";
import { loadAiProfile, profileInitials, saveAiProfile, type AiProfile } from "./ai-profile";

const SCAN_INTERVAL_MS = 250;
const AI_MODEL_NAME = "Opus 4.7";
type CenterView = "welcome" | "routine" | "tags" | "compare" | "structure";

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
  const [running, setRunning] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [view, setView] = useState<CenterView>("welcome");
  const [openRoutineId, setOpenRoutineId] = useState<string | undefined>(undefined);
  const [dockTab, setDockTab] = useState<DockTab>("watch");
  const [copilotTab, setCopilotTab] = useState<CopilotTab>("chat");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [aiProfile, setAiProfile] = useState<AiProfile | null>(() => loadAiProfile());
  const [setupOpen, setSetupOpen] = useState(false);
  const logActivity = (kind: ActivityKind, message: string) =>
    setActivity((log) => recordActivity(log, kind, message));
  const [lastImport, setLastImport] = useState<{ name: string; summary: ImportSummary } | null>(null);
  const [comparison, setComparison] = useState<{ name: string; project: PlcProject } | null>(null);
  const [clipboardRung, setClipboardRung] = useState<{ root: LadderBranch; comment?: string } | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const l5xInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => createDefaultEngine().run(project), [project]);
  const rows = useMemo(() => watchRows(project, values), [project, values]);
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
    } else if (sel?.kind === "aoi" || sel?.kind === "udt" || sel?.kind === "io") {
      setView("structure");
    } else if (sel?.kind === "tag" || sel?.kind === "controller" || sel?.kind === "program") {
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

  // ---- Tag table editor (toast on failure; reset values when the tag set changes) ----
  const runTagAction = (result: ProjectActionResult, successMsg?: string, resyncValues = true) => {
    if (result.ok) {
      setProject(result.project);
      if (resyncValues) setValues(zeroValues(result.project));
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
    history.undo();
  };
  const handleRedo = () => {
    if (!history.canRedo) return;
    if (history.redoTarget) setValues(zeroValues(history.redoTarget));
    history.redo();
  };

  // ---- Simulation ----
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleSetNumber = (name: string, value: number) =>
    setValues((current) => ({ ...current, [name]: value }));
  const handleScanOnce = () => {
    const result = traceOnce(project, values, forces);
    setValues(result.values);
    setTrace(result.trace);
  };
  const handleReset = () => {
    setValues(zeroValues(project));
    setTrace([]);
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

  const selectedRungId =
    selection?.kind === "rung" || selection?.kind === "instruction" ? selection.rungId : undefined;
  const selectedNodeId = selection?.kind === "instruction" ? selection.nodeId : undefined;

  // ---- File workflows ----
  const loadProject = (loaded: PlcProject) => {
    history.reset(loaded); // opening/importing a project is a fresh undo baseline
    setSavedProject(loaded); // freshly loaded = no unsaved changes
    setProjectOpen(true);
    setValues(zeroValues(loaded));
    setRunning(false);
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
    const blank = createBlankRoutineProject();
    history.reset(blank);
    setSavedProject(initialProject);
    setProjectOpen(true);
    setValues(zeroValues(blank));
    setForces({});
    setTrace([]);
    setRunning(false);
    setRecovery(null);
    const main = findMainRoutine(blank);
    if (main) {
      setOpenRoutineId(main.id);
      setSelection({ kind: "routine", id: main.id });
      setView("routine");
    }
    push("success", "Created a blank routine.");
  };

  // ---- Autosave recovery ----
  const handleRestoreAutosave = () => {
    if (!recovery) return;
    history.reset(recovery.project);
    setProjectOpen(true);
    setValues(zeroValues(recovery.project));
    setSavedProject(initialProject); // recovered work is unsaved → stays dirty
    setRunning(false);
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

  const handleExport = () => {
    const result = exportProjectJson(project);
    if (result.data) {
      const filename = `${slugify(project.name)}${PLCPROJ_EXTENSION}`;
      downloadTextFile(filename, result.data.text);
      setSavedProject(project); // exporting is the save point — mark clean
      setLastExportedAt(new Date().toISOString());
      clearAutosave();
      logActivity("export", `Exported "${project.name}" → ${filename}`);
      push("success", `Exported "${project.name}" → ${filename}`);
    }
  };
  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportL5XClick = () => l5xInputRef.current?.click();
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
    try {
      const result = importProjectFile(await readFileAsText(file));
      if (result.ok) {
        loadProject(result.project);
        logActivity("open", `Opened project "${result.project.name}".`);
        push("success", `Opened project "${result.project.name}".`);
      } else {
        push("error", result.error ?? "Failed to import project.");
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  const handleL5XSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setValues((current) => scanOnce(projectRef.current, current, forcesRef.current)),
      SCAN_INTERVAL_MS,
    );
    return () => clearInterval(id);
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
  };
  const handleSaveAiProfile = (draft: Partial<AiProfile>) => {
    const saved = saveAiProfile(draft);
    if (!saved) {
      push("error", "Enter a name and API key to finish AI setup.");
      return;
    }
    setAiProfile(saved);
    setSetupOpen(false);
    push("success", "AI setup saved for this workstation.");
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
          onHome={() => setView("welcome")}
          onTags={() => requireProject(() => setView("tags"))}
          onCompare={() => requireProject(() => setView("compare"))}
          onExport={handleExport}
          onImportProject={handleImportClick}
          onImportL5X={handleImportL5XClick}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onPaste={handlePasteRung}
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
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
          onClick: () => setCopilotTab("chat"),
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
            onOpenRoutine={handleOpenRoutine}
          />
        ) : (
          <WelcomeDashboard
            onCreateRoutine={handleCreateRoutineProject}
            onImportL5X={handleImportL5XClick}
            onExport={handleExport}
            onOpenAi={() => setCopilotTab("chat")}
          onOpenCrossRef={() => setDockTab("references")}
          onOpenWatch={() => setDockTab("watch")}
            onOpenTags={() => requireProject(() => setView("tags"))}
            onOpenCompare={() => requireProject(() => setView("compare"))}
            lastImport={lastImport}
          />
        )
      }
      right={
        <RightCopilotPanel
          tab={copilotTab}
          onTabChange={setCopilotTab}
          empty={!projectOpen}
          modelName={AI_MODEL_NAME}
          project={project}
          selection={selection}
          values={values}
          findings={findings}
          selectedRoutineId={openRoutineId}
          apiKey={aiProfile?.apiKey}
          onOpenSetup={() => setSetupOpen(true)}
          onApplyPlan={handleApplyPlan}
          undoDepth={history.undoDepth}
          redoDepth={history.redoDepth}
          dirty={dirty}
          activity={activity}
        />
      }
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
          project={project}
          selectedTagName={selectedTagName}
          onOpenRoutine={handleOpenRoutine}
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
        />
      }
    />
  );
}
