import { useEffect, useState } from "react";
import type { Routine, RoutineLanguage } from "@esco/core";
import { duplicateNameError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface NewRoutineInput {
  programId: string;
  name: string;
  language: RoutineLanguage;
  description?: string;
}

interface Props {
  open: boolean;
  programId?: string;
  programName?: string;
  routines?: Routine[];
  onClose: () => void;
  onCreate: (input: NewRoutineInput) => void;
}

const ROUTINE_TYPES: Array<{ label: string; value: RoutineLanguage; detail: string }> = [
  { label: "Ladder Diagram", value: "ladder", detail: "LD" },
  { label: "Structured Text", value: "structured-text", detail: "ST" },
  { label: "Function Block Diagram", value: "function-block", detail: "FBD" },
  { label: "Sequential Function Chart", value: "sfc", detail: "SFC" },
];
const ROUTINE_TABS = ["General", "Configuration"] as const;
type RoutineTab = (typeof ROUTINE_TABS)[number];

export function NewRoutineDialog({ open, programId, programName, routines = [], onClose, onCreate }: Props) {
  const [activeTab, setActiveTab] = useState<RoutineTab>("General");
  const [name, setName] = useState("Routine_1");
  const [language, setLanguage] = useState<RoutineLanguage>("ladder");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setActiveTab("General");
    setName("Routine_1");
    setLanguage("ladder");
    setDescription("");
  }, [open]);

  if (!open || !programId) return null;
  const validationMessage =
    studioIdentifierError(name, "Routine") ??
    duplicateNameError(name, routines.map((routine) => routine.name), "Routine");
  const showHelp = () =>
    showDialogHelp(
      "New Routine",
      "OK creates a routine in the selected program. Ladder routines start with an empty rung; Structured Text, Function Block, and SFC routines preserve editable source stubs for offline work. Cancel closes without creating a routine.",
    );

  const create = () => {
    const trimmedName = name.trim();
    if (!trimmedName || validationMessage) return;
    onCreate({
      programId,
      name: trimmedName,
      language,
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-routine-props" role="dialog" aria-modal="true" aria-label="New Routine">
        <header className="esco-modal__header">
          <h2>New Routine</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close New Routine" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="New routine tabs">
          {ROUTINE_TABS.map((tab) => (
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
            <aside className="esco-routine-props__identity" aria-label="Routine type">
              <span className="esco-routine-props__icon" aria-hidden="true" />
              <strong>{ROUTINE_TYPES.find((type) => type.value === language)?.detail ?? "LD"}</strong>
              <small>{programName ?? "Program"}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Type</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as RoutineLanguage)}>
                  {ROUTINE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="esco-field">
                <span>Program</span>
                <input value={programName ?? programId} readOnly />
              </label>
              <label className="esco-field">
                <span>Description</span>
                <textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          </div>
        ) : (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__grid">
              <div className="esco-controller-props__group">
                <h3>Routine Configuration</h3>
                <dl>
                  <div><dt>Program</dt><dd>{programName ?? programId}</dd></div>
                  <div><dt>Language</dt><dd>{ROUTINE_TYPES.find((type) => type.value === language)?.label}</dd></div>
                  <div><dt>Type Code</dt><dd>{ROUTINE_TYPES.find((type) => type.value === language)?.detail}</dd></div>
                </dl>
              </div>
            </div>
          </div>
        )}

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={create}>OK</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
