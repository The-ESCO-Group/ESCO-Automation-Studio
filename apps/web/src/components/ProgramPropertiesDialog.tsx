import { useEffect, useState } from "react";
import type { Program, Routine } from "@esco/core";
import { duplicateNameError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface ProgramPropertiesInput {
  programId: string;
  name: string;
  description?: string;
  mainRoutineId?: string;
  faultRoutineId?: string;
  inhibited?: boolean;
}

interface Props {
  open: boolean;
  program?: Program;
  routines?: Routine[];
  programs?: Program[];
  controllerName?: string;
  onClose: () => void;
  onSave: (input: ProgramPropertiesInput, options?: { close?: boolean }) => void;
}

export function ProgramPropertiesDialog({ open, program, routines = [], programs = [], controllerName, onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<"General" | "Configuration">("General");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mainRoutineId, setMainRoutineId] = useState("");
  const [faultRoutineId, setFaultRoutineId] = useState("");
  const [inhibited, setInhibited] = useState(false);

  useEffect(() => {
    if (!open || !program) return;
    setActiveTab("General");
    setName(program.name);
    setDescription(program.description ?? "");
    setMainRoutineId(program.mainRoutineId ?? "");
    setFaultRoutineId(program.faultRoutineId ?? "");
    setInhibited(program.inhibited === true);
  }, [open, program]);

  if (!open || !program) return null;
  const validationMessage =
    studioIdentifierError(name, "Program") ??
    duplicateNameError(name, programs.map((candidate) => candidate.name), "Program", program.name);
  const showHelp = () =>
    showDialogHelp(
      "Program Properties",
      "OK saves program metadata and closes. Apply saves without closing. Cancel discards unapplied edits. Main and fault routine choices are validated against routines in this program.",
    );

  const buildInput = (): ProgramPropertiesInput => ({
      programId: program.id,
      name,
      description: description.trim(),
      mainRoutineId: mainRoutineId || undefined,
      faultRoutineId: faultRoutineId || undefined,
      inhibited,
    });

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="Program Properties">
        <header className="esco-modal__header">
          <h2>Program Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Program Properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Program property tabs">
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
            <aside className="esco-routine-props__identity" aria-label="Program identity">
              <span className="esco-program-props__icon" aria-hidden="true" />
              <strong>Program</strong>
              <small>{controllerName ?? "Controller"}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Controller</span>
                <input value={controllerName ?? program.controllerId} readOnly />
              </label>
              <label className="esco-field">
                <span>Description</span>
                <textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input type="checkbox" checked={inhibited} onChange={(event) => setInhibited(event.target.checked)} />
                  Inhibit Program
                </span>
              </label>
            </div>
          </div>
        ) : (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__grid">
              <label className="esco-field">
                <span>Main Routine</span>
                <select value={mainRoutineId} onChange={(event) => setMainRoutineId(event.target.value)}>
                  <option value="">None</option>
                  {routines.map((routine) => (
                    <option key={routine.id} value={routine.id}>{routine.name}</option>
                  ))}
                </select>
              </label>
              <label className="esco-field">
                <span>Fault Routine</span>
                <select value={faultRoutineId} onChange={(event) => setFaultRoutineId(event.target.value)}>
                  <option value="">None</option>
                  {routines.map((routine) => (
                    <option key={routine.id} value={routine.id}>{routine.name}</option>
                  ))}
                </select>
              </label>
              <div className="esco-program-props__list">
                <strong>Routines</strong>
                {routines.map((routine) => (
                  <span key={routine.id}>{routine.name}<small>{routine.language}</small></span>
                ))}
              </div>
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
