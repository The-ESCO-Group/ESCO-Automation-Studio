import { useEffect, useMemo, useState } from "react";
import type { Controller, TaskType } from "@esco/core";
import { duplicateNameError, integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface NewTaskInput {
  controllerId: string;
  name: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  watchdogMs?: number;
  inhibited?: boolean;
  disableUpdateOutputs?: boolean;
  scheduledProgramIds: string[];
}

interface Props {
  open: boolean;
  controller?: Controller;
  onClose: () => void;
  onCreate: (input: NewTaskInput) => void;
}

const TASK_TYPES: Array<{ value: TaskType; label: string }> = [
  { value: "continuous", label: "Continuous" },
  { value: "periodic", label: "Periodic" },
  { value: "event", label: "Event" },
];
const TASK_TABS = ["General", "Configuration"] as const;
type TaskTab = (typeof TASK_TABS)[number];

function nextTaskName(controller: Controller): string {
  const names = new Set(controller.tasks.map((task) => task.name.toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Task_${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return "Task";
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : undefined;
}

export function NewTaskDialog({ open, controller, onClose, onCreate }: Props) {
  const [activeTab, setActiveTab] = useState<TaskTab>("General");
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskType>("periodic");
  const [periodMs, setPeriodMs] = useState("10");
  const [priority, setPriority] = useState("10");
  const [watchdogMs, setWatchdogMs] = useState("500");
  const [inhibited, setInhibited] = useState(false);
  const [disableUpdateOutputs, setDisableUpdateOutputs] = useState(false);
  const [scheduledProgramIds, setScheduledProgramIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !controller) return;
    setActiveTab("General");
    setName(nextTaskName(controller));
    setType(controller.tasks.some((task) => task.type === "continuous") ? "periodic" : "continuous");
    setPeriodMs("10");
    setPriority("10");
    setWatchdogMs("500");
    setInhibited(false);
    setDisableUpdateOutputs(false);
    setScheduledProgramIds([]);
  }, [controller, open]);

  const programs = useMemo(() => controller?.programs ?? [], [controller]);
  if (!open || !controller) return null;
  const validationMessage =
    studioIdentifierError(name, "Task") ??
    duplicateNameError(name, controller.tasks.map((task) => task.name), "Task") ??
    (type === "continuous" && controller.tasks.some((task) => task.type === "continuous")
      ? "A controller can only have one continuous task."
      : undefined) ??
    (type === "periodic" ? integerFieldError(periodMs, "Period", { min: 1 }) : undefined) ??
    (type !== "continuous" ? integerFieldError(priority, "Priority", { min: 1 }) : undefined) ??
    integerFieldError(watchdogMs, "Watchdog", { min: 1 });
  const showHelp = () =>
    showDialogHelp(
      "New Task",
      "OK creates an offline controller task and schedules the selected programs. Cancel closes without creating a task. Invalid names, duplicate names, and impossible timing values are blocked before the backend action runs.",
    );

  const toggleProgram = (programId: string, checked: boolean) => {
    setScheduledProgramIds((current) =>
      checked ? [...current, programId] : current.filter((candidate) => candidate !== programId),
    );
  };

  const create = () => {
    const trimmedName = name.trim();
    if (!trimmedName || validationMessage) return;
    onCreate({
      controllerId: controller.id,
      name: trimmedName,
      type,
      periodMs: type === "periodic" ? optionalNumber(periodMs) : undefined,
      priority: type === "continuous" ? undefined : optionalNumber(priority),
      watchdogMs: optionalNumber(watchdogMs),
      inhibited,
      disableUpdateOutputs,
      scheduledProgramIds,
    });
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="New Task">
        <header className="esco-modal__header">
          <h2>New Task</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close New Task" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="New task tabs">
          {TASK_TABS.map((tab) => (
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
                    <option key={candidate.value} value={candidate.value}>
                      {candidate.label}
                    </option>
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
            </div>
          </div>
        ) : (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__grid">
              <label className="esco-field">
                <span>Period (ms)</span>
                <input
                  value={periodMs}
                  inputMode="numeric"
                  disabled={type !== "periodic"}
                  onChange={(event) => setPeriodMs(event.target.value)}
                />
              </label>
              <label className="esco-field">
                <span>Priority</span>
                <input
                  value={priority}
                  inputMode="numeric"
                  disabled={type === "continuous"}
                  onChange={(event) => setPriority(event.target.value)}
                />
              </label>
              <label className="esco-field">
                <span>Watchdog (ms)</span>
                <input value={watchdogMs} inputMode="numeric" onChange={(event) => setWatchdogMs(event.target.value)} />
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
              <div className="esco-program-props__list">
                <strong>Scheduled Programs</strong>
                {programs.length ? (
                  programs.map((program) => (
                    <label key={program.id}>
                      <input
                        type="checkbox"
                        checked={scheduledProgramIds.includes(program.id)}
                        onChange={(event) => toggleProgram(program.id, event.target.checked)}
                      />
                      {program.name}
                    </label>
                  ))
                ) : (
                  <span>
                    No programs are defined.
                    <small>Not scheduled</small>
                  </span>
                )}
              </div>
              <label className="esco-check-field">
                <span />
                <span>
                  <input
                    type="checkbox"
                    checked={programs.length > 0 && scheduledProgramIds.length === programs.length}
                    disabled={programs.length === 0}
                    onChange={(event) =>
                      setScheduledProgramIds(event.target.checked ? programs.map((program) => program.id) : [])
                    }
                  />
                  Schedule all programs
                </span>
              </label>
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
