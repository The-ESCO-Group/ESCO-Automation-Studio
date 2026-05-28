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
import { PropertiesPanel } from "./components/PropertiesPanel";
import { BottomPanel, type DockTab } from "./components/BottomPanel";
import { WelcomeDashboard } from "./components/WelcomeDashboard";
import { TagsView } from "./components/TagsView";
import { CompareView } from "./components/CompareView";
import { Toasts } from "./components/Toasts";
import type { Selection } from "./selection";
import { createInitialProject, findMainRoutine } from "./project-edit";
import { downloadTextFile, readFileAsText, slugify } from "./file-io";
import { scanOnce, watchRows, zeroValues, type TagValues } from "./simulation";
import { useToasts } from "./toasts";
import { useHistoryState } from "./history";

const SCAN_INTERVAL_MS = 250;
type CenterView = "welcome" | "routine" | "tags" | "compare";

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
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<CenterView>("welcome");
  const [openRoutineId, setOpenRoutineId] = useState<string | undefined>(undefined);
  const [dockTab, setDockTab] = useState<DockTab>("watch");
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

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warning").length;

  // ---- Selection / navigation ----
  const handleSelect = (sel: Selection) => {
    setSelection(sel);
    if (sel?.kind === "routine") {
      setOpenRoutineId(sel.id);
      setView("routine");
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
  const handleSelectRung = (rungId: string) =>
    setSelection({ kind: "rung", routineId: openRoutineId ?? "", rungId });
  const handleSelectNode = (rungId: string, nodeId: string) =>
    setSelection({ kind: "instruction", routineId: openRoutineId ?? "", rungId, nodeId });
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

  // ---- Branch editing (single-level parallel/seal-in branches) ----
  const handleAddParallelBranch = (rungId: string) =>
    applyAction((p) => addParallelBranch(p, { routineId: targetRoutineId(p), rungId }));
  const handleAddBranchLeg = (rungId: string) =>
    applyAction((p) => addBranchLeg(p, { routineId: targetRoutineId(p), rungId }));
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
  const handleScanOnce = () => setValues((current) => scanOnce(project, current));
  const handleReset = () => setValues(zeroValues(project));

  // ---- AI assistant: apply a previewed plan through the action layer ----
  const handleApplyPlan = (plan: AssistantPlan): ApplyResult => {
    const result = applyPlan(project, plan);
    if (result.ok) {
      setProject(result.project);
      setValues(zeroValues(result.project));
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
    setValues(zeroValues(loaded));
    setRunning(false);
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

  const handleExport = () => {
    const result = exportProjectJson(project);
    if (result.data) {
      const filename = `${slugify(project.name)}${PLCPROJ_EXTENSION}`;
      downloadTextFile(filename, result.data.text);
      setSavedProject(project); // exporting is the save point — mark clean
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
      const unsupported = s.unsupportedInstructions.length
        ? ` Unsupported: ${s.unsupportedInstructions.join(", ")}.`
        : "";
      push(
        s.warnings.length ? "warning" : "success",
        `Imported "${result.project.name}": ${counts}.${unsupported}${s.warnings.length ? ` ${s.warnings.length} warning(s).` : ""}`,
      );
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  // Continuous run uses the latest project via a ref.
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setValues((current) => scanOnce(projectRef.current, current)),
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

  const validationLabel = errorCount
    ? `${errorCount} error${errorCount > 1 ? "s" : ""}`
    : warnCount
      ? `${warnCount} warning${warnCount > 1 ? "s" : ""}`
      : "Valid";
  const validationClass = errorCount ? "is-error" : warnCount ? "is-warn" : "is-ok";

  return (
    <div className="esco-app">
      <header className="esco-titlebar">
        <div className="esco-titlebar__brand">
          <button
            type="button"
            className="esco-titlebar__home"
            title="Dashboard"
            onClick={() => setView("welcome")}
          >
            ESCO
          </button>
          <span className="esco-titlebar__name">Automation Studio</span>
        </div>

        <div className="esco-titlebar__context">
          <span className="esco-titlebar__project" title="Project">{project.name}</span>
          <span
            className={`esco-titlebar__saved ${dirty ? "is-dirty" : "is-saved"}`}
            title={dirty ? "Unsaved changes — export to save" : "All changes saved"}
          >
            {dirty ? "● Unsaved" : "✓ Saved"}
          </span>
          {openRoutine ? <span className="esco-titlebar__routine">▸ {openRoutine.name}</span> : null}
          <span className={`esco-titlebar__validation ${validationClass}`} title="Validation status">
            {validationLabel}
          </span>
        </div>

        <div className="esco-titlebar__actions">
          <button
            type="button"
            className="esco-btn"
            title="Undo (Ctrl+Z)"
            disabled={!history.canUndo}
            onClick={handleUndo}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="esco-btn"
            title="Redo (Ctrl+Y)"
            disabled={!history.canRedo}
            onClick={handleRedo}
          >
            ↷ Redo
          </button>
          <span className="esco-titlebar__divider" />
          <button type="button" className="esco-btn" onClick={() => setView("welcome")}>
            Dashboard
          </button>
          <button
            type="button"
            className={`esco-btn${view === "tags" ? " esco-btn--primary" : ""}`}
            onClick={() => setView("tags")}
          >
            Tags
          </button>
          <button
            type="button"
            className={`esco-btn${view === "compare" ? " esco-btn--primary" : ""}`}
            onClick={() => setView("compare")}
          >
            Compare
          </button>
          <span className="esco-titlebar__divider" />
          <button type="button" className="esco-btn" onClick={handleExport}>
            Export Project
          </button>
          <button type="button" className="esco-btn" onClick={handleImportClick}>
            Import Project
          </button>
          <button type="button" className="esco-btn esco-btn--l5x" onClick={handleImportL5XClick}>
            Import L5X
          </button>
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
        </div>

        <span className="esco-badge esco-badge--offline" title="No PLC/controller communication">
          ● Offline
        </span>
      </header>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className="esco-body">
        <aside className="esco-left">
          <ProjectExplorer project={project} selection={selection} onSelect={handleSelect} />
        </aside>

        <main className="esco-center">
          {view === "tags" ? (
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
          ) : view === "routine" && openRoutine ? (
            <EditorArea
              project={project}
              routine={openRoutine}
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
            />
          ) : (
            <WelcomeDashboard
              onOpenDemo={() => {
                const id = findMainRoutine(project)?.id;
                if (id) handleSelect({ kind: "routine", id });
              }}
              onImportL5X={handleImportL5XClick}
              onExport={handleExport}
              onOpenAi={() => setDockTab("ai")}
              onOpenCrossRef={() => setDockTab("xref")}
              onOpenWatch={() => setDockTab("watch")}
              onOpenTags={() => setView("tags")}
              onOpenCompare={() => setView("compare")}
              lastImport={lastImport}
            />
          )}
        </main>

        <aside className="esco-right">
          <PropertiesPanel project={project} selection={selection} values={values} findings={findings} />
        </aside>
      </div>

      <footer className="esco-bottom">
        <BottomPanel
          tab={dockTab}
          onTabChange={setDockTab}
          findings={findings}
          tags={rows}
          running={running}
          onToggleTag={handleToggleTag}
          onSetNumber={handleSetNumber}
          onScanOnce={handleScanOnce}
          onReset={handleReset}
          onToggleRun={() => setRunning((value) => !value)}
          project={project}
          selectedRoutineId={openRoutineId}
          selectedTagName={selectedTagName}
          onApplyPlan={handleApplyPlan}
          onOpenRoutine={handleOpenRoutine}
        />
      </footer>
    </div>
  );
}
