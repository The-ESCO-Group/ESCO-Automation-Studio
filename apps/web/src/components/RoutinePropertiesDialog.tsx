import { useEffect, useState } from "react";
import type { Routine } from "@esco/core";
import { duplicateNameError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface RoutinePropertiesInput {
  routineId: string;
  name: string;
  description?: string;
}

interface Props {
  open: boolean;
  routine?: Routine;
  programName?: string;
  routines?: Routine[];
  onClose: () => void;
  onSave: (input: RoutinePropertiesInput, options?: { close?: boolean }) => void;
}

function languageLabel(language: Routine["language"]): string {
  switch (language) {
    case "ladder":
      return "Ladder Diagram";
    case "structured-text":
      return "Structured Text";
    case "function-block":
      return "Function Block Diagram";
    case "sfc":
      return "Sequential Function Chart";
    default:
      return language;
  }
}

function languageCode(language: Routine["language"]): string {
  switch (language) {
    case "ladder":
      return "LD";
    case "structured-text":
      return "ST";
    case "function-block":
      return "FBD";
    case "sfc":
      return "SFC";
    default:
      return "RTN";
  }
}

export function RoutinePropertiesDialog({ open, routine, programName, routines = [], onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<"General" | "Configuration">("General");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !routine) return;
    setActiveTab("General");
    setName(routine.name);
    setDescription(routine.description ?? "");
  }, [open, routine]);

  if (!open || !routine) return null;
  const validationMessage =
    studioIdentifierError(name, "Routine") ??
    duplicateNameError(name, routines.map((candidate) => candidate.name), "Routine", routine.name);
  const showHelp = () =>
    showDialogHelp(
      "Routine Properties",
      "OK saves routine metadata and closes. Apply saves metadata and keeps the sheet open. Cancel closes and discards unapplied edits. Routine renames are guarded by the backend and remap routine-reference operands in the owning program.",
    );

  const buildInput = (): RoutinePropertiesInput => ({
      routineId: routine.id,
      name,
      description: description.trim(),
    });

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-routine-props" role="dialog" aria-modal="true" aria-label="Routine Properties">
        <header className="esco-modal__header">
          <h2>Routine Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Routine Properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Routine property tabs">
          {(["General", "Configuration"] as const).map((tab) => (
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

        {activeTab === "General" ? (
          <div className="esco-routine-props__body">
            <aside className="esco-routine-props__identity" aria-label="Routine identity">
              <span className="esco-routine-props__icon" aria-hidden="true" />
              <strong>{languageCode(routine.language)}</strong>
              <small>{languageLabel(routine.language)}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Type</span>
                <input value={languageLabel(routine.language)} readOnly />
              </label>
              <label className="esco-field">
                <span>Program</span>
                <input value={programName ?? routine.programId} readOnly />
              </label>
              <label className="esco-field">
                <span>Description</span>
                <textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          </div>
        ) : (
          <div className="esco-routine-props__pane">
            <div className="esco-controller-props__group">
              <h3>Routine</h3>
              <dl>
                <div><dt>Routine ID</dt><dd>{routine.id}</dd></div>
                <div><dt>Program</dt><dd>{programName ?? routine.programId}</dd></div>
                <div><dt>Language</dt><dd>{languageLabel(routine.language)}</dd></div>
              </dl>
            </div>
          </div>
        )}

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
