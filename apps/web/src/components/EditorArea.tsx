import { useMemo } from "react";
import type { PlcProject, Routine } from "@esco/core";
import { baseTagName, createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { routineNodes, type LadderRung, type LadderRoutine } from "@esco/ladder";
import { tagExists } from "../project-edit";
import { RungDiagram } from "./LadderView";

const registry = createDefaultRegistry();

/** Instructions offered inside a branch leg (input conditioning + simple output). */
const BRANCH_INSTRUCTIONS = ["XIC", "XIO", "OTE"];

interface Props {
  project: PlcProject;
  routine: Routine | undefined;
  ladder: LadderRoutine | undefined;
  selectedRungId?: string;
  selectedNodeId?: string;
  onAddRung: () => void;
  onDeleteRung: (rungId: string) => void;
  onCopyRung: (rungId: string) => void;
  onDuplicateRung: (rungId: string) => void;
  onPasteRung: () => void;
  canPaste: boolean;
  onAddInstruction: (rungId: string, instructionType: string) => void;
  onEditOperand: (rungId: string, nodeId: string, index: number, value: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  onCreateTag: (name: string, dataType: string) => void;
  onSelectRung: (rungId: string) => void;
  onSelectNode: (rungId: string, nodeId: string) => void;
  onSetRungComment: (rungId: string, comment: string) => void;
  onAddParallelBranch: (rungId: string) => void;
  onAddBranchLeg: (rungId: string) => void;
  onRemoveBranchLeg: (rungId: string, branchId: string) => void;
  onAddToBranch: (rungId: string, branchId: string, instructionType: string) => void;
}

/**
 * Branch-editing controls for the selected rung. Presents the rung's parallel
 * legs (the main line plus each alternate) with per-leg add buttons, so a
 * seal-in / OR structure can be built by hand. Single-level parallels only.
 */
function BranchEditor({
  rung,
  onAddParallelBranch,
  onAddBranchLeg,
  onRemoveBranchLeg,
  onAddToBranch,
}: {
  rung: LadderRung;
  onAddParallelBranch: (rungId: string) => void;
  onAddBranchLeg: (rungId: string) => void;
  onRemoveBranchLeg: (rungId: string, branchId: string) => void;
  onAddToBranch: (rungId: string, branchId: string, instructionType: string) => void;
}) {
  const parallel = rung.root.parallelBranches ?? [];
  const hasParallel = parallel.length > 0;
  const legs = [
    { branch: rung.root, label: "Leg 1 (main)", main: true },
    ...parallel.map((branch, index) => ({ branch, label: `Leg ${index + 2}`, main: false })),
  ];

  return (
    <div className="esco-branch-edit" onClick={(event) => event.stopPropagation()}>
      <div className="esco-branch-edit__head">
        <span className="esco-branch-edit__title">Branches</span>
        <button
          type="button"
          className="esco-btn esco-btn--instr"
          onClick={() => onAddParallelBranch(rung.id)}
        >
          + Parallel Branch
        </button>
        {hasParallel ? (
          <button
            type="button"
            className="esco-btn esco-btn--instr"
            onClick={() => onAddBranchLeg(rung.id)}
          >
            + Branch Leg
          </button>
        ) : null}
      </div>

      {hasParallel ? (
        <div className="esco-branch-edit__legs">
          {legs.map((leg) => {
            const empty = leg.branch.nodes.length === 0;
            return (
              <div className="esco-branch-leg" key={leg.branch.id}>
                <span className="esco-branch-leg__name">{leg.label}</span>
                {empty ? (
                  <span className="esco-branch-leg__empty">Empty branch leg — add instruction</span>
                ) : null}
                {BRANCH_INSTRUCTIONS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="esco-btn esco-btn--instr"
                    onClick={() => onAddToBranch(rung.id, leg.branch.id, type)}
                  >
                    + {type}
                  </button>
                ))}
                {!leg.main ? (
                  <button
                    type="button"
                    className="esco-btn esco-btn--danger"
                    disabled={!empty}
                    title={empty ? "Remove this leg" : "Only empty legs can be removed"}
                    onClick={() => onRemoveBranchLeg(rung.id, leg.branch.id)}
                  >
                    Remove Leg
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <span className="esco-branch-edit__hint">
          Add a parallel branch to build seal-in / OR logic.
        </span>
      )}
    </div>
  );
}

interface UndefinedTag {
  name: string;
  inferredType: string;
}

/** Instruction palette grouped by category. */
const INSTRUCTION_GROUPS: { label: string; types: string[] }[] = [
  { label: "Bit", types: ["XIC", "XIO", "OTE", "OTL", "OTU", "ONS"] },
  { label: "Timer / Counter", types: ["TON", "TOF", "RTO", "CTU", "CTD", "RES"] },
  { label: "Move / Math", types: ["MOV", "ADD", "SUB", "MUL", "DIV", "MOD", "SQR", "NEG", "ABS", "CLR"] },
  { label: "Bitwise", types: ["AND", "OR", "XOR", "NOT"] },
  { label: "Compare", types: ["EQU", "NEQ", "GRT", "GEQ", "LES", "LEQ", "LIM", "MEQ"] },
  { label: "Program", types: ["NOP", "AFI"] },
];

/** Collect tag references that don't exist yet, with the type they should be. */
function findUndefinedTags(ladder: LadderRoutine, project: PlcProject): UndefinedTag[] {
  const found = new Map<string, string>();
  for (const node of routineNodes(ladder)) {
    const definition = registry.get(node.instructionType);
    node.operands.forEach((operand, index) => {
      const value = operand.value.trim();
      if (!value || isNumericLiteral(value)) return;
      const base = baseTagName(value);
      if (!base || tagExists(project, base) || found.has(base)) return;
      found.set(base, definition?.operands[index]?.allowedTypes?.[0] ?? "BOOL");
    });
  }
  return [...found].map(([name, inferredType]) => ({ name, inferredType }));
}

export function EditorArea({
  project,
  routine,
  ladder,
  selectedRungId,
  selectedNodeId,
  onAddRung,
  onDeleteRung,
  onCopyRung,
  onDuplicateRung,
  onPasteRung,
  canPaste,
  onAddInstruction,
  onEditOperand,
  onRemoveInstruction,
  onCreateTag,
  onSelectRung,
  onSelectNode,
  onSetRungComment,
  onAddParallelBranch,
  onAddBranchLeg,
  onRemoveBranchLeg,
  onAddToBranch,
}: Props) {
  const undefinedTags = useMemo(
    () => (ladder ? findUndefinedTags(ladder, project) : []),
    [ladder, project],
  );

  const editing = {
    onEditOperand,
    onRemoveInstruction,
    onSelectNode,
    selectedNodeId,
    isUndefinedTag: (value: string) => {
      const base = baseTagName(value);
      return base !== "" && !tagExists(project, base);
    },
  };

  if (!routine || !ladder) {
    return (
      <div className="esco-editor">
        <div className="esco-editor__empty">
          <h1>ESCO Automation Studio</h1>
          <p>Select a routine in the Project Explorer to edit its ladder.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="esco-editor">
      <div className="esco-editor__tabs">
        <span className="esco-editor__tab is-active">{routine.name}</span>
      </div>

      <div className="esco-editor__surface">
        <div className="esco-editor__toolbar">
          <button type="button" className="esco-btn esco-btn--primary" onClick={onAddRung}>
            + Add Rung
          </button>
          <button
            type="button"
            className="esco-btn"
            disabled={!canPaste}
            title={canPaste ? "Paste the copied rung" : "Copy a rung first"}
            onClick={onPasteRung}
          >
            Paste Rung
          </button>
          <div className="esco-palette">
            {INSTRUCTION_GROUPS.map((group) => (
              <div className="esco-palette__group" key={group.label}>
                <span className="esco-palette__label">{group.label}</span>
                {group.types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="esco-btn esco-btn--instr"
                    disabled={!selectedRungId}
                    title={selectedRungId ? `Add ${type} to the selected rung` : "Select a rung first"}
                    onClick={() => selectedRungId && onAddInstruction(selectedRungId, type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {ladder.rungs.length === 0 ? (
          <div className="esco-editor__norungs">
            <p className="esco-empty">This routine has no rungs yet.</p>
            <button type="button" className="esco-btn esco-btn--primary" onClick={onAddRung}>
              + Add first rung
            </button>
          </div>
        ) : (
          ladder.rungs.map((rung) => (
            <div
              key={rung.id}
              className={`esco-lad__rung${selectedRungId === rung.id ? " is-selected" : ""}`}
              onClick={() => onSelectRung(rung.id)}
            >
              <div className="esco-lad__rung-head">
                <span className="esco-lad__rung-no">{rung.number}</span>
                <input
                  className="esco-lad__comment-input"
                  defaultValue={rung.comment ?? ""}
                  placeholder="Rung comment…"
                  spellCheck={false}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    if (event.target.value !== (rung.comment ?? "")) {
                      onSetRungComment(rung.id, event.target.value);
                    }
                  }}
                />
                <button
                  type="button"
                  className="esco-btn esco-lad__rung-btn"
                  title="Copy this rung"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopyRung(rung.id);
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="esco-btn esco-lad__rung-btn"
                  title="Duplicate this rung"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicateRung(rung.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="esco-btn esco-btn--danger esco-lad__rung-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRung(rung.id);
                  }}
                >
                  Delete Rung
                </button>
              </div>
              <RungDiagram rung={rung} editing={editing} />
              {selectedRungId === rung.id ? (
                <BranchEditor
                  rung={rung}
                  onAddParallelBranch={onAddParallelBranch}
                  onAddBranchLeg={onAddBranchLeg}
                  onRemoveBranchLeg={onRemoveBranchLeg}
                  onAddToBranch={onAddToBranch}
                />
              ) : null}
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
    </div>
  );
}
