import { useEffect, useState } from "react";
import type { Controller, Task } from "@esco/core";
import { duplicateNameError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface NewProgramInput {
  controllerId: string;
  name: string;
  description?: string;
  scheduledTaskId?: string;
}

interface Props {
  open: boolean;
  controller?: Controller;
  defaultTaskId?: string;
  onClose: () => void;
  onCreate: (input: NewProgramInput) => void;
}

function nextProgramName(controller: Controller): string {
  const existing = new Set(controller.programs.map((program) => program.name.toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Program_${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `Program_${controller.programs.length + 1}`;
}

function selectedTask(controller: Controller, taskId?: string): Task | undefined {
  return controller.tasks.find((task) => task.id === taskId) ?? controller.tasks[0];
}

const PROGRAM_TABS = ["General", "Configuration"] as const;
type ProgramTab = (typeof PROGRAM_TABS)[number];

export function NewProgramDialog({ open, controller, defaultTaskId, onClose, onCreate }: Props) {
  const [activeTab, setActiveTab] = useState<ProgramTab>("General");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledTaskId, setScheduledTaskId] = useState("");
  const [scheduleProgram, setScheduleProgram] = useState(true);

  useEffect(() => {
    if (!open || !controller) return;
    const task = selectedTask(controller, defaultTaskId);
    setActiveTab("General");
    setName(nextProgramName(controller));
    setDescription("");
    setScheduledTaskId(task?.id ?? "");
    setScheduleProgram(!!task);
  }, [controller, defaultTaskId, open]);

  if (!open || !controller) return null;
  const validationMessage =
    studioIdentifierError(name, "Program") ??
    duplicateNameError(name, controller.programs.map((program) => program.name), "Program") ??
    (scheduleProgram && !scheduledTaskId ? "Select a task or turn off Schedule Program." : undefined);
  const showHelp = () =>
    showDialogHelp(
      "New Program",
      "OK creates the offline program folder and optionally schedules it under the selected task. Cancel closes without creating a program.",
    );

  const create = () => {
    const trimmedName = name.trim();
    if (!trimmedName || validationMessage) return;
    onCreate({
      controllerId: controller.id,
      name: trimmedName,
      description: description.trim() || undefined,
      scheduledTaskId: scheduleProgram ? scheduledTaskId || undefined : undefined,
    });
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="New Program">
        <header className="esco-modal__header">
          <h2>New Program</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close New Program" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="New program tabs">
          {PROGRAM_TABS.map((tab) => (
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
              <small>{controller.name}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Controller</span>
                <input value={controller.name} readOnly />
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
              <label className="esco-check-field">
                <span />
                <span>
                  <input type="checkbox" checked={scheduleProgram} onChange={(event) => setScheduleProgram(event.target.checked)} />
                  Schedule Program
                </span>
              </label>
              <label className="esco-field">
                <span>Task</span>
                <select
                  value={scheduledTaskId}
                  disabled={!scheduleProgram}
                  onChange={(event) => setScheduledTaskId(event.target.value)}
                >
                  {controller.tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </label>
              <div className="esco-controller-props__group">
                <h3>Task Assignment</h3>
                <dl>
                  <div><dt>Controller</dt><dd>{controller.name}</dd></div>
                  <div><dt>Scheduled Task</dt><dd>{controller.tasks.find((task) => task.id === scheduledTaskId)?.name ?? "None"}</dd></div>
                  <div><dt>Program Folder</dt><dd>Program Tags and Routines will be created under the new program.</dd></div>
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
