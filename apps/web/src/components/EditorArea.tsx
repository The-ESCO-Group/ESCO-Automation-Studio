import { useMemo } from "react";
import type { PlcProject, Routine } from "@esco/core";
import { createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import type { Selection } from "../selection";
import { tagExists } from "../project-edit";
import { RungDiagram } from "./LadderView";

const registry = createDefaultRegistry();

interface Props {
  project: PlcProject;
  selection: Selection;
  ladder: LadderRoutine | undefined;
  onAddRung: () => void;
  onDeleteRung: (rungId: string) => void;
  onAddInstruction: (rungId: string, instructionType: string) => void;
  onEditOperand: (rungId: string, nodeId: string, index: number, value: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  onCreateTag: (name: string, dataType: string) => void;
}

function findRoutine(project: PlcProject, id: string): Routine | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((r) => r.id === id);
      if (routine) return routine;
    }
  }
  return undefined;
}

interface UndefinedTag {
  name: string;
  /** Type to create, inferred from the operand's allowed types (defaults to BOOL). */
  inferredType: string;
}

/** Collect tag references that don't exist yet, with the type they should be. */
function findUndefinedTags(ladder: LadderRoutine, project: PlcProject): UndefinedTag[] {
  const found = new Map<string, string>();
  for (const node of routineNodes(ladder)) {
    const definition = registry.get(node.instructionType);
    node.operands.forEach((operand, index) => {
      const value = operand.value.trim();
      if (!value || isNumericLiteral(value) || tagExists(project, value)) return;
      if (found.has(value)) return;
      found.set(value, definition?.operands[index]?.allowedTypes?.[0] ?? "BOOL");
    });
  }
  return [...found].map(([name, inferredType]) => ({ name, inferredType }));
}

// Bit instructions first, then timers/counters, move, and compares.
const INSTRUCTION_BUTTONS = ["XIC", "XIO", "OTE", "TON", "CTU", "MOV", "EQU", "GRT", "LES"] as const;

export function EditorArea({
  project,
  selection,
  ladder,
  onAddRung,
  onDeleteRung,
  onAddInstruction,
  onEditOperand,
  onRemoveInstruction,
  onCreateTag,
}: Props) {
  const routine =
    selection?.kind === "routine" ? findRoutine(project, selection.id) : undefined;

  const undefinedTags = useMemo(
    () => (ladder ? findUndefinedTags(ladder, project) : []),
    [ladder, project],
  );

  const editing = {
    onEditOperand,
    onRemoveInstruction,
    isUndefinedTag: (name: string) => !tagExists(project, name),
  };

  return (
    <div className="esco-editor">
      <div className="esco-editor__tabs">
        <span className="esco-editor__tab is-active">
          {routine ? routine.name : "Welcome"}
        </span>
      </div>

      <div className="esco-editor__surface">
        {routine && ladder ? (
          <div className="esco-ladder">
            <div className="esco-editor__toolbar">
              <button type="button" className="esco-btn esco-btn--primary" onClick={onAddRung}>
                + Add Rung
              </button>
              <span className="esco-editor__hint">
                Edit operands inline; use each rung's buttons to add instructions.
              </span>
            </div>

            {ladder.rungs.length === 0 ? (
              <p className="esco-empty">No rungs yet — click “Add Rung” to start.</p>
            ) : (
              ladder.rungs.map((rung) => (
                <div className="esco-lad__rung" key={rung.id}>
                  <div className="esco-lad__rung-head">
                    <span className="esco-lad__rung-no">{rung.number}</span>
                    {rung.comment ? (
                      <span className="esco-lad__comment">{rung.comment}</span>
                    ) : null}
                    <div className="esco-lad__rung-actions">
                      {INSTRUCTION_BUTTONS.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className="esco-btn"
                          onClick={() => onAddInstruction(rung.id, type)}
                        >
                          + {type}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="esco-btn esco-btn--danger"
                        onClick={() => onDeleteRung(rung.id)}
                      >
                        Delete Rung
                      </button>
                    </div>
                  </div>
                  <RungDiagram rung={rung} editing={editing} />
                </div>
              ))
            )}

            {undefinedTags.length > 0 ? (
              <div className="esco-undef">
                <span className="esco-undef__label">Undefined tags:</span>
                {undefinedTags.map(({ name, inferredType }) => (
                  <button
                    key={name}
                    type="button"
                    className="esco-btn esco-btn--create"
                    onClick={() => onCreateTag(name, inferredType)}
                  >
                    + Create {inferredType} “{name}”
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="esco-editor__empty">
            <h1>ESCO Automation Studio</h1>
            <p>Select MainRoutine in the Project Explorer to edit the ladder.</p>
            <p className="esco-editor__hint">
              Ladder is a semantic model in <code>@esco/ladder</code>, executed by{" "}
              <code>@esco/simulator</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
