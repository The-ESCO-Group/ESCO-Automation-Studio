import { useEffect, useMemo, useRef, useState } from "react";
import {
  addRung,
  appendInstruction,
  removeInstruction,
  removeRung,
  setOperandValue,
} from "@esco/ladder";
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
import { scanOnce, watchRows, zeroValues, type TagValues } from "./simulation";

const SCAN_INTERVAL_MS = 250;

export function App() {
  const [project, setProject] = useState(createInitialProject);
  const [selection, setSelection] = useState<Selection>(null);
  const [values, setValues] = useState<TagValues>(() => zeroValues(project));
  const [running, setRunning] = useState(false);

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
        <div className="esco-titlebar__status">Offline · No controller connected</div>
      </header>

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
