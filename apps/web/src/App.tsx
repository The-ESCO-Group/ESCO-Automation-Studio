import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  addRung,
  appendNode,
  createNode,
  removeInstruction,
  removeRung,
  setOperandValue,
  tagOperand,
} from "@esco/ladder";
import { createDefaultRegistry } from "@esco/instructions";
import {
  deserializeProject,
  serializeProject,
  PLCPROJ_EXTENSION,
} from "@esco/project-store";
import { importL5X } from "@esco/parser-l5x";
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
const registry = createDefaultRegistry();

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

  // Ladder edits (immutable; each returns a new project).
  const editLadder = (updater: Parameters<typeof withMainLadder>[1]) =>
    setProject((current) => withMainLadder(current, updater));

  const handleAddRung = () => editLadder(addRung);
  const handleDeleteRung = (rungId: string) =>
    editLadder((ladder) => removeRung(ladder, rungId));
  const handleAddInstruction = (rungId: string, type: string) => {
    // Build the node with one (empty) operand per the instruction's definition.
    const operandDefs = registry.get(type)?.operands ?? [{ name: "tag" }];
    const node = createNode(type, operandDefs.map((operand) => tagOperand(operand.name, "")));
    editLadder((ladder) => appendNode(ladder, rungId, node));
  };
  const handleEditOperand = (rungId: string, nodeId: string, index: number, value: string) =>
    editLadder((ladder) => setOperandValue(ladder, rungId, nodeId, value, index));
  const handleRemoveInstruction = (rungId: string, nodeId: string) =>
    editLadder((ladder) => removeInstruction(ladder, rungId, nodeId));
  const handleCreateTag = (name: string, dataType: string) =>
    setProject((current) => withNewTag(current, name, dataType));

  // Simulation.
  const handleToggleTag = (name: string) =>
    setValues((current) => ({ ...current, [name]: current[name] !== true }));
  const handleSetNumber = (name: string, value: number) =>
    setValues((current) => ({ ...current, [name]: value }));
  const handleScanOnce = () => setValues((current) => scanOnce(project, current));
  const handleReset = () => setValues(zeroValues(project));

  // Persistence: export to / import from .plcproj.json (the AST is the source of truth).
  const handleExport = () => {
    downloadTextFile(`${slugify(project.name)}${PLCPROJ_EXTENSION}`, serializeProject(project));
  };
  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportL5XClick = () => l5xInputRef.current?.click();

  const loadProject = (loaded: typeof project) => {
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
      loadProject(deserializeProject(await readFileAsText(file)));
      setImportError(null);
      setImportNotice(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import project.");
    }
  };

  const handleL5XSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const { project: imported, summary } = importL5X(await readFileAsText(file));
      loadProject(imported);
      setImportError(null);
      const counts = `${summary.programs} program(s), ${summary.routines} routine(s), ${summary.rungs} rung(s), ${summary.tags} tag(s)`;
      const unsupported = summary.unsupportedInstructions.length
        ? ` Unsupported: ${summary.unsupportedInstructions.join(", ")}.`
        : "";
      const warned = summary.warnings.length ? ` ${summary.warnings.length} warning(s).` : "";
      setImportNotice(`Imported "${imported.name}": ${counts}.${unsupported}${warned}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import L5X file.");
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
