import { useEffect, useMemo, useState } from "react";
import type { Controller, Program, Task } from "@esco/core";
import { showDialogHelp } from "./dialogValidation";

export interface AddExistingProgramInput {
  taskId: string;
  programId: string;
}

interface Props {
  open: boolean;
  controller?: Controller;
  task?: Task;
  onClose: () => void;
  onAdd: (input: AddExistingProgramInput) => void;
}

function unscheduledPrograms(controller: Controller, task: Task): Program[] {
  const scheduledIds = new Set(controller.tasks.flatMap((candidate) => candidate.scheduledProgramIds));
  return controller.programs.filter((program) => !task.scheduledProgramIds.includes(program.id) && !scheduledIds.has(program.id));
}

export function AddExistingProgramDialog({ open, controller, task, onClose, onAdd }: Props) {
  const programs = useMemo(
    () => (controller && task ? unscheduledPrograms(controller, task) : []),
    [controller, task],
  );
  const [programId, setProgramId] = useState("");

  useEffect(() => {
    if (!open) return;
    setProgramId(programs[0]?.id ?? "");
  }, [open, programs]);

  if (!open || !controller || !task) return null;

  const selected = programs.find((program) => program.id === programId);
  const showHelp = () =>
    showDialogHelp(
      "Add Existing Program",
      "Schedules an existing unscheduled program under this task. The backend validates that the task and program belong to the same controller before writing the offline project model.",
    );

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="Add Existing Program">
        <header className="esco-modal__header">
          <h2>Add Existing Program</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Add Existing Program" onClick={onClose} />
        </header>

        <div className="esco-routine-props__body">
          <aside className="esco-routine-props__identity" aria-label="Task schedule target">
            <span className="esco-program-props__icon" aria-hidden="true" />
            <strong>{task.name}</strong>
            <small>{controller.name}</small>
          </aside>

          <div className="esco-routine-props__fields">
            {programs.length > 0 ? (
              <>
                <label className="esco-field">
                  <span>Program</span>
                  <select value={programId} autoFocus onChange={(event) => setProgramId(event.target.value)}>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="esco-controller-props__group">
                  <h3>Schedule Preview</h3>
                  <dl>
                    <div><dt>Task</dt><dd>{task.name}</dd></div>
                    <div><dt>Program</dt><dd>{selected?.name ?? "Select a program"}</dd></div>
                    <div><dt>Existing scheduled programs</dt><dd>{task.scheduledProgramIds.length}</dd></div>
                  </dl>
                </div>
              </>
            ) : (
              <div className="esco-controller-props__group">
                <h3>No Unscheduled Programs</h3>
                <p className="esco-empty">
                  Every program in {controller.name} is already scheduled. Create a new program or remove one from another task before adding an existing program.
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button
              type="button"
              className="esco-btn esco-btn--primary"
              disabled={!programId}
              onClick={() => onAdd({ taskId: task.id, programId })}
            >
              Add
            </button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
