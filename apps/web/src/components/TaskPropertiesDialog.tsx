import { useEffect, useState } from "react";
import type { Program, Task, TaskType } from "@esco/core";
import { duplicateNameError, integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface TaskPropertiesInput {
  taskId: string;
  name: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  inhibited?: boolean;
  disableUpdateOutputs?: boolean;
  scheduledProgramIds?: string[];
}

interface Props {
  open: boolean;
  task?: Task;
  programs?: Program[];
  tasks?: Task[];
  onClose: () => void;
  onSave: (input: TaskPropertiesInput, options?: { close?: boolean }) => void;
}

const TASK_TYPES: Array<{ value: TaskType; label: string }> = [
  { value: "continuous", label: "Continuous" },
  { value: "periodic", label: "Periodic" },
  { value: "event", label: "Event" },
];

function numericValue(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined;
}

export function TaskPropertiesDialog({ open, task, programs = [], tasks = [], onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<"General" | "Configuration">("General");
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskType>("continuous");
  const [periodMs, setPeriodMs] = useState("");
  const [priority, setPriority] = useState("");
  const [watchdogMs, setWatchdogMs] = useState("");
  const [inhibited, setInhibited] = useState(false);
  const [disableUpdateOutputs, setDisableUpdateOutputs] = useState(false);
  const [scheduledProgramIds, setScheduledProgramIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !task) return;
    setActiveTab("General");
    setName(task.name);
    setType(task.type);
    setPeriodMs(task.periodMs != null ? String(task.periodMs) : "");
    setPriority(task.priority != null ? String(task.priority) : "");
    setWatchdogMs(task.watchdogMs != null ? String(task.watchdogMs) : "");
    setInhibited(task.inhibited === true);
    setDisableUpdateOutputs(task.disableUpdateOutputs === true);
    setScheduledProgramIds(task.scheduledProgramIds);
  }, [open, task]);

  if (!open || !task) return null;
  const validationMessage =
    studioIdentifierError(name, "Task") ??
    duplicateNameError(name, tasks.map((candidate) => candidate.name), "Task", task.name) ??
    (type === "continuous" && task.type !== "continuous" && tasks.some((candidate) => candidate.id !== task.id && candidate.type === "continuous")
      ? "A controller can only have one continuous task."
      : undefined) ??
    (type === "periodic" ? integerFieldError(periodMs, "Period", { min: 1 }) : undefined) ??
    (type !== "continuous" ? integerFieldError(priority, "Priority", { min: 1 }) : undefined) ??
    integerFieldError(watchdogMs, "Watchdog", { min: 1 });
  const showHelp = () =>
    showDialogHelp(
      "Task Properties",
      "OK saves task metadata and closes. Apply saves while keeping the sheet open. Cancel discards unapplied edits. Scheduled programs and timing values are validated before writing the offline project model.",
    );

  const toggleProgram = (programId: string) => {
    setScheduledProgramIds((current) =>
      current.includes(programId)
        ? current.filter((id) => id !== programId)
        : [...current, programId],
    );
  };

  const buildInput = (): TaskPropertiesInput => ({
      taskId: task.id,
      name,
      type,
      periodMs: numericValue(periodMs),
      priority: numericValue(priority),
      watchdogMs: numericValue(watchdogMs),
      inhibited,
      disableUpdateOutputs,
      scheduledProgramIds,
    });

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="Task Properties">
        <header className="esco-modal__header">
          <h2>Task Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Task Properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Task property tabs">
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
            <aside className="esco-routine-props__identity" aria-label="Task identity">
              <span className="esco-task-props__icon" aria-hidden="true" />
              <strong>Task</strong>
              <small>{TASK_TYPES.find((candidate) => candidate.value === type)?.label}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Type</span>
                <select value={type} onChange={(event) => setType(event.target.value as TaskType)}>
                  {TASK_TYPES.map((candidate) => (
                    <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
                  ))}
                </select>
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input type="checkbox" checked={inhibited} onChange={(event) => setInhibited(event.target.checked)} />
                  Inhibit Task
                </span>
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input
                    type="checkbox"
                    checked={disableUpdateOutputs}
                    onChange={(event) => setDisableUpdateOutputs(event.target.checked)}
                  />
                  Disable Automatic Output Processing
                </span>
              </label>
            </div>
          </div>
        ) : (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__grid">
              <label className="esco-field">
                <span>Period (ms)</span>
                <input value={periodMs} inputMode="numeric" onChange={(event) => setPeriodMs(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Priority</span>
                <input value={priority} inputMode="numeric" onChange={(event) => setPriority(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Watchdog (ms)</span>
                <input value={watchdogMs} inputMode="numeric" onChange={(event) => setWatchdogMs(event.target.value)} />
              </label>
              <div className="esco-program-props__list">
                <strong>Scheduled Programs</strong>
                {programs.map((program) => (
                  <label key={program.id}>
                    <input
                      type="checkbox"
                      checked={scheduledProgramIds.includes(program.id)}
                      onChange={() => toggleProgram(program.id)}
                    />
                    {program.name}
                  </label>
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
