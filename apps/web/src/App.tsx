import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { PlcProject } from "@esco/core";
import {
  addInstruction,
  addRung,
  createTag,
  deleteRung,
  deleteTag,
  exportProjectJson,
  findRoutine,
  getLadder,
  importL5XFile,
  importProjectFile,
  removeInstruction,
  renameTag,
  setRungComment,
  setTagDescription,
  updateInstructionOperand,
  type ProjectActionResult,
} from "@esco/project-actions";
import { PLCPROJ_EXTENSION } from "@esco/project-store";
import { applyPlan, type ApplyResult, type AssistantPlan } from "@esco/ai-assistant";
import { createDefaultEngine } from "@esco/validator";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { EditorArea } from "./components/EditorArea";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { BottomPanel, type DockTab } from "./components/BottomPanel";
import { WelcomeDashboard } from "./components/WelcomeDashboard";
import { TagsView } from "./components/TagsView";
import { Toasts } from "./components/Toasts";
import type { Selection } from "./selection";
import { createInitialProject, findMainRoutine } from "./project-edit";
import { downloadTextFile, readFileAsText, slugify } from "./file-io";
import { scanOnce, watchRows, zeroValues, type TagValues } from "./simulation";
import { useToasts } from "./toasts";

const SCAN_INTERVAL_MS = 250;
type CenterView = "welcome" | "routine" | "tags";

export function App() {
  const [project, setProject] = useState(createInitialProject);
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<CenterView>("welcome");
  const [openRoutineId, setOpenRoutineId] = useState<string | undefined>(undefined);
  const [dockTab, setDockTab] = useState<DockTab>("watch");
  const { toasts, push, dismiss } = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const l5xInputRef = useRef<HTMLInputElement>(null);

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
    setProject(loaded);
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
      push("success", `Exported "${project.name}" → ${filename}`);
    }
  };
  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportL5XClick = () => l5xInputRef.current?.click();

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
          {openRoutine ? <span className="esco-titlebar__routine">▸ {openRoutine.name}</span> : null}
          <span className={`esco-titlebar__validation ${validationClass}`} title="Validation status">
            {validationLabel}
          </span>
        </div>

        <div className="esco-titlebar__actions">
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
          ) : view === "routine" && openRoutine ? (
            <EditorArea
              project={project}
              routine={openRoutine}
              ladder={openLadder}
              selectedRungId={selectedRungId}
              selectedNodeId={selectedNodeId}
              onAddRung={handleAddRung}
              onDeleteRung={handleDeleteRung}
              onAddInstruction={handleAddInstruction}
              onEditOperand={handleEditOperand}
              onRemoveInstruction={handleRemoveInstruction}
              onCreateTag={handleCreateTag}
              onSelectRung={handleSelectRung}
              onSelectNode={handleSelectNode}
              onSetRungComment={handleSetRungComment}
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
