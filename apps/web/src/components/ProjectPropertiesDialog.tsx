import { useEffect, useState } from "react";
import type { PlcProject } from "@esco/core";
import type { DesktopSavedFile } from "../file-io";

interface Props {
  open: boolean;
  project: PlcProject;
  projectFile: DesktopSavedFile | null;
  onClose: () => void;
  onSave: (input: { name: string; description?: string }) => void;
}

export function ProjectPropertiesDialog({ open, project, projectFile, onClose, onSave }: Props) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description ?? "");
  }, [open, project.description, project.name]);

  if (!open) return null;

  const submit = () => onSave({ name, description: description.trim() || undefined });

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-project-props" role="dialog" aria-modal="true" aria-label="Project properties">
        <header className="esco-modal__header">
          <div>
            <h2>Project Properties</h2>
            <p>Local project metadata saved with the .plcproj.json file.</p>
          </div>
          <button type="button" className="esco-icon-btn" aria-label="Close project properties" onClick={onClose}>
            x
          </button>
        </header>

        <div className="esco-project-props__body">
          <label className="esco-field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </label>
          <label className="esco-field">
            <span>Description</span>
            <textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
          </label>

          <dl className="esco-project-props__meta">
            <div><dt>Project ID</dt><dd>{project.id}</dd></div>
            <div><dt>Created</dt><dd>{new Date(project.createdAt).toLocaleString()}</dd></div>
            <div><dt>Updated</dt><dd>{new Date(project.updatedAt).toLocaleString()}</dd></div>
            <div><dt>Storage</dt><dd>{projectFile?.path ?? "Unsaved local project"}</dd></div>
          </dl>
        </div>

        <footer className="esco-modal__footer">
          <span>Changes are stored through the controlled project action layer.</span>
          <div className="esco-modal__actions">
          <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="esco-btn esco-btn--primary" onClick={submit}>Apply</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
