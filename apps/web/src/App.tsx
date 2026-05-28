import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  addRung,
  appendInstruction,
  removeInstruction,
  removeRung,
  setOperandValue,
} from "@esco/ladder";
import {
  deserializeProject,
  serializeProject,
  PLCPROJ_EXTENSION,
} from "@esco/project-store";
import { createDefaultEngine } from "@esco/validator";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { EditorArea } from "./components/EditorArea";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { BottomPanel } from "./components/BottomPanel";
import type { Selection } from "./selection";
import {
  createInitialProject,
  getMainLadder,
  withMainLadder,
  withNewTag,
} from "./project-edit";
import { downloadTextFile, readFileAsText, slugify } from "./file-io";
import { scanOnce, watchRows, zeroValues, type TagValues } from "./simulation";

const SCAN_INTERVAL_MS = 250;

export function App() {
  const [project, setProject] = useState(createInitialProject);
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [running, setRunning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => createDefaultEngine().run(project), [project]);
  const rows = watchRows(project, values);

  // Ladder edits (immutable; each returns a new project).
  const editLadder = (updater: Parameters<typeof withMainLadder>[1]) =>
    setProject((current) => withMainLadder(current, updater));

  const handleAddRung = () => editLadder(addRung);
  const handleDeleteRung = (rungId: string) =>
    editLadder((ladder) => removeRung(ladder, rungId));
  const handleAddInstruction = (rungId: string, type: string) =>
    editLadder((ladder) => appendInstruction(ladder, rungId, type));
  const handleEditOperand = (rungId: string, nodeId: string, value: string) =>
    editLadder((ladder) => setOperandValue(ladder, rungId, nodeId, value));
  const handleRemoveInstruction = (rungId: string, nodeId: string) =>
    editLadder((ladder) => removeInstruction(ladder, rungId, nodeId));
  const handleCreateTag = (name: string) =>
    setProject((current) => withNewTag(current, name));

  // Simulation.
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleScanOnce = () => setValues((current) => scanOnce(project, current));
  const handleReset = () => setValues(zeroValues(project));

  // Persistence: export to / import from .plcproj.json (the AST is the source of truth).
  const handleExport = () => {
    downloadTextFile(`${slugify(project.name)}${PLCPROJ_EXTENSION}`, serializeProject(project));
  };
  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const loaded = deserializeProject(await readFileAsText(file));
      setProject(loaded);
      setValues(zeroValues(loaded)); // reset watch values from the loaded BOOL tags
      setRunning(false);
      setSelection(null);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import project.");
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
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
          onScanOnce={handleScanOnce}
          onReset={handleReset}
          onToggleRun={() => setRunning((value) => !value)}
        />
      </footer>
    </div>
  );
}
