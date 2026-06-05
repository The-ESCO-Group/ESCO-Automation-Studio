import { useEffect, useState } from "react";
import type { PlcProject } from "@esco/core";
import type { DesktopSavedFile } from "../file-io";
import { showDialogHelp } from "./dialogValidation";

interface Props {
  open: boolean;
  project: PlcProject;
  projectFile: DesktopSavedFile | null;
  onClose: () => void;
  onSave: (input: { name: string; description?: string }, options?: { close?: boolean }) => void;
}

const PROJECT_TABS = ["General", "Source", "Controller", "Documentation", "Security", "Audit"] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

const SOURCE_TYPE_LABELS: Record<string, string> = {
  "xml-review-import": "XML review import",
  "esco-project": "ESCO project",
  "component-import": "Component import",
  recovered: "Recovered autosave",
  "binary-project-open-blocked": "Unsupported binary project",
  "external-conversion-import": "Unsupported external conversion",
  "esco-runtime": "ESCO Runtime (compiled, read-only)",
  "esco-softcontroller-upload": "ESCO SoftController upload (reconstructed, read-only)",
  new: "New project",
};

function displayValue(value: unknown, fallback = "Not configured"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return String(value);
}

function displayDate(value: string | undefined, fallback = "Not configured"): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ProjectPropertiesDialog({ open, project, projectFile, onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("General");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  useEffect(() => {
    if (!open) return;
    setActiveTab("General");
    setName(project.name);
    setDescription(project.description ?? "");
  }, [open, project.description, project.name]);

  if (!open) return null;

  const buildInput = () => ({ name, description: description.trim() || undefined });
  const validationMessage = name.trim() ? undefined : "Project name is required.";
  const showHelp = () =>
    showDialogHelp(
      "Project Properties",
      "OK saves project name and description and closes. Apply saves without closing. Cancel discards unapplied edits. Other tabs show imported/offline controller metadata for review.",
    );
  const controller = project.controllers[0];
  const propertyRow = (label: string, value: unknown) => (
    <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>
  );
  const renderTab = () => {
    switch (activeTab) {
      case "General":
        return (
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
              {propertyRow("Project ID", project.id)}
              {propertyRow("Storage", projectFile?.path ?? "Unsaved local project")}
              {propertyRow("Created", new Date(project.createdAt).toLocaleString())}
              {propertyRow("Updated", new Date(project.updatedAt).toLocaleString())}
            </dl>
          </div>
        );
      case "Source": {
        const provenance = project.provenance;
        const blocked = provenance?.blockedImport;
        return (
          <div className="esco-project-props__body">
            <dl className="esco-project-props__meta">
              {propertyRow(
                "Source Type",
                provenance ? SOURCE_TYPE_LABELS[provenance.sourceType] ?? "Project source" : undefined,
              )}
              {propertyRow("Source File", provenance?.fileName)}
              {propertyRow("Source Path", provenance?.path)}
              <div key="Imported"><dt>Imported / Created</dt><dd>{displayDate(provenance?.importedAt)}</dd></div>
            </dl>
            <p className="esco-project-props__hint">
              ESCO Automation Studio is offline-safe: ESCO-native project/runtime files are the
              primary workflow, while L5X (XML) is legacy review interchange only. It does not read,
              write, compile, decompile, or convert proprietary binary controller-project files.
              This panel records, honestly, where this project model came from.
            </p>
            {blocked ? (
              <dl className="esco-project-props__meta" aria-label="Blocked import">
                {propertyRow("Last Blocked Import", "Unsupported proprietary/binary project file")}
                <div key="BlockedAt"><dt>Blocked At</dt><dd>{displayDate(blocked.blockedAt)}</dd></div>
              </dl>
            ) : null}
          </div>
        );
      }
      case "Controller":
        return (
          <div className="esco-project-props__body">
            <dl className="esco-project-props__meta">
              {propertyRow("Controller", controller?.name)}
              {propertyRow("Catalog Number", controller?.catalogNumber)}
              {propertyRow("Type", controller?.processorType)}
              {propertyRow("Revision", controller?.firmwareRevision)}
              {propertyRow("Chassis", controller?.chassis)}
              {propertyRow("Slot", controller?.slot)}
              {propertyRow("Driver", controller?.commDriver ?? "Offline Model")}
              {propertyRow("Path", controller?.commPath ?? "No hardware path selected")}
            </dl>
          </div>
        );
      case "Documentation":
        return (
          <div className="esco-project-props__body">
            <dl className="esco-project-props__meta">
              {propertyRow("Current Project Language", controller?.currentProjectLanguage)}
              {propertyRow("Default Project Language", controller?.defaultProjectLanguage)}
              {propertyRow("Controller Language", controller?.controllerLanguage)}
              {propertyRow("Pass Through Configuration", controller?.passThroughConfiguration)}
              {propertyRow("Download Documentation and Extended Properties", controller?.downloadProjectDocumentationAndExtendedProperties)}
              {propertyRow("Download Custom Properties", controller?.downloadProjectCustomProperties)}
            </dl>
          </div>
        );
      case "Security":
        return (
          <div className="esco-project-props__body">
            <dl className="esco-project-props__meta">
              {propertyRow("Security Authority", controller?.security?.securityAuthorityName ?? controller?.security?.securityAuthorityId)}
              {propertyRow("Changes To Detect", controller?.security?.changesToDetect)}
              {propertyRow("Match Project To Controller", controller?.matchProjectToController)}
              {propertyRow("Project Serial Number", controller?.projectSN)}
              {propertyRow("Safety Level", controller?.safetyInfo?.safetyLevel)}
              {propertyRow("Safety Locked", controller?.safetyInfo?.safetyLocked)}
            </dl>
          </div>
        );
      case "Audit":
        return (
          <div className="esco-project-props__body">
            <dl className="esco-project-props__meta">
              {propertyRow("Project Creation Date", controller?.projectCreationDate ?? new Date(project.createdAt).toLocaleString())}
              {propertyRow("Last Modified Date", controller?.lastModifiedDate ?? new Date(project.updatedAt).toLocaleString())}
              {propertyRow("Software Revision", controller?.softwareRevision)}
              {propertyRow("Export Owner", controller?.exportOwner)}
              {propertyRow("Export Date", controller?.exportDate)}
              {propertyRow("Contains Context", controller?.containsContext)}
              {propertyRow("Export Options", controller?.exportOptions)}
            </dl>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-project-props" role="dialog" aria-modal="true" aria-label="Project properties">
        <header className="esco-modal__header">
          <h2>Project Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close project properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Project property tabs">
          {PROJECT_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "is-active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        {renderTab()}

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={() => onSave(buildInput(), { close: true })}>OK</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" disabled={!!validationMessage} onClick={() => onSave(buildInput(), { close: false })}>Apply</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
