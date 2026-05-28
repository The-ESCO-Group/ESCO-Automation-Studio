import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { PlcProject } from "@esco/core";
import {
  addInstruction,
  addRung,
  createTag,
  deleteRung,
  exportProjectJson,
  importL5XFile,
  importProjectFile,
  removeInstruction,
  updateInstructionOperand,
  type ProjectActionResult,
} from "@esco/project-actions";
import { PLCPROJ_EXTENSION } from "@esco/project-store";
import { createDefaultEngine } from "@esco/validator";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { EditorArea } from "./components/EditorArea";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { BottomPanel } from "./components/BottomPanel";
import type { Selection } from "./selection";
import { createInitialProject, findMainRoutine, getMainLadder } from "./project-edit";
import { downloadTextFile, readFileAsText, slugify } from "./file-io";
import { scanOnce, watchRows, zeroValues, type TagValues } from "./simulation";

const SCAN_INTERVAL_MS = 250;

export function App() {
  const [project, setProject] = useState(createInitialProject);
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [running, setRunning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const l5xInputRef = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => createDefaultEngine().run(project), [project]);
  const rows = watchRows(project, values);

  // All edits go through the controlled action layer; on success we adopt the
  // returned project, otherwise the current state is left unchanged.
  const routineId = (p: PlcProject) => findMainRoutine(p)?.id ?? "";
  const applyAction = (run: (p: PlcProject) => ProjectActionResult) =>
    setProject((current) => {
      const result = run(current);
      return result.ok ? result.project : current;
    });

  const handleAddRung = () => applyAction((p) => addRung(p, { routineId: routineId(p) }));
  const handleDeleteRung = (rungId: string) =>
    applyAction((p) => deleteRung(p, { routineId: routineId(p), rungId }));
  const handleAddInstruction = (rungId: string, type: string) =>
    applyAction((p) => addInstruction(p, { routineId: routineId(p), rungId, instructionType: type }));
  const handleEditOperand = (rungId: string, nodeId: string, index: number, value: string) =>
    applyAction((p) => updateInstructionOperand(p, { routineId: routineId(p), rungId, nodeId, index, value }));
  const handleRemoveInstruction = (rungId: string, nodeId: string) =>
    applyAction((p) => removeInstruction(p, { routineId: routineId(p), rungId, nodeId }));
  const handleCreateTag = (name: string, dataType: string) =>
    applyAction((p) => createTag(p, { name, dataType }));

  // Simulation.
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleSetNumber = (name: string, value: number) =>
    setValues((current) => ({ ...current, [name]: value }));
  const handleScanOnce = () => setValues((current) => scanOnce(project, current));
  const handleReset = () => setValues(zeroValues(project));

  // Persistence and import (the AST is the source of truth).
  const handleExport = () => {
    const result = exportProjectJson(project);
    if (result.data) {
      downloadTextFile(`${slugify(project.name)}${PLCPROJ_EXTENSION}`, result.data.text);
    }
  };
  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportL5XClick = () => l5xInputRef.current?.click();

  const loadProject = (loaded: PlcProject) => {
    setProject(loaded);
    setValues(zeroValues(loaded)); // reset watch values from the loaded tags
    setRunning(false);
    setSelection(null);
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const result = importProjectFile(await readFileAsText(file));
      if (result.ok) {
        loadProject(result.project);
        setImportError(null);
        setImportNotice(null);
      } else {
        setImportError(result.error ?? "Failed to import project.");
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to read the file.");
    }
  };

  const handleL5XSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const result = importL5XFile(await readFileAsText(file));
      if (!result.ok || !result.data) {
        setImportError(result.error ?? "Failed to import L5X file.");
        return;
      }
      loadProject(result.project);
      setImportError(null);
      const s = result.data.summary;
      const counts = `${s.programs} program(s), ${s.routines} routine(s), ${s.rungs} rung(s), ${s.tags} tag(s)`;
      const unsupported = s.unsupportedInstructions.length
        ? ` Unsupported: ${s.unsupportedInstructions.join(", ")}.`
        : "";
      const warned = s.warnings.length ? ` ${s.warnings.length} warning(s).` : "";
      setImportNotice(`Imported "${result.project.name}": ${counts}.${unsupported}${warned}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to read the file.");
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

  return (
    <div className="esco-app">
      <header className="esco-titlebar">
        <div className="esco-titlebar__brand">
          <span className="esco-titlebar__logo">ESCO</span>
          <span className="esco-titlebar__name">Automation Studio</span>
        </div>
        <div className="esco-titlebar__project">{project.name}</div>
        <div className="esco-titlebar__actions">
          <button type="button" className="esco-btn" onClick={handleExport}>
            Export Project
          </button>
          <button type="button" className="esco-btn" onClick={handleImportClick}>
            Import Project
          </button>
          <button type="button" className="esco-btn" onClick={handleImportL5XClick}>
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
        <div className="esco-titlebar__status">Offline · No controller connected</div>
      </header>

      {importError ? (
        <div className="esco-toast esco-toast--error" role="alert">
          <span>Import failed: {importError}</span>
          <button
            type="button"
            className="esco-toast__close"
            onClick={() => setImportError(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {importNotice ? (
        <div className="esco-toast esco-toast--info" role="status">
          <span>{importNotice}</span>
          <button
            type="button"
            className="esco-toast__close"
            onClick={() => setImportNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="esco-body">
        <aside className="esco-left">
          <ProjectExplorer
            project={project}
            selection={selection}
            onSelect={setSelection}
          />
        </aside>

        <main className="esco-center">
          <EditorArea
            project={project}
            selection={selection}
            ladder={getMainLadder(project)}
            onAddRung={handleAddRung}
            onDeleteRung={handleDeleteRung}
            onAddInstruction={handleAddInstruction}
            onEditOperand={handleEditOperand}
            onRemoveInstruction={handleRemoveInstruction}
            onCreateTag={handleCreateTag}
          />
        </main>

        <aside className="esco-right">
          <PropertiesPanel project={project} selection={selection} />
        </aside>
      </div>

      <footer className="esco-bottom">
        <BottomPanel
          findings={findings}
          tags={rows}
          running={running}
          onToggleTag={handleToggleTag}
          onSetNumber={handleSetNumber}
          onScanOnce={handleScanOnce}
          onReset={handleReset}
          onToggleRun={() => setRunning((value) => !value)}
        />
      </footer>
    </div>
  );
}
