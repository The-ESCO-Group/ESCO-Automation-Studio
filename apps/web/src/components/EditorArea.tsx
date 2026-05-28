import { useMemo, useState } from "react";
import type { PlcProject, Routine } from "@esco/core";
import { baseTagName, createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { routineNodes, type LadderBranch, type LadderRung, type LadderRoutine } from "@esco/ladder";
import { tagExists } from "../project-edit";
import { capList } from "../windowing";
import { RungDiagram } from "./LadderView";

const registry = createDefaultRegistry();

/** Above this many rungs the editor collapses to the first N until "Show all". */
const LARGE_ROUTINE_LIMIT = 100;

/** Instructions offered inside a branch leg (input conditioning + simple output). */
const BRANCH_INSTRUCTIONS = ["XIC", "XIO", "OTE"];

interface Props {
  project: PlcProject;
  routine: Routine | undefined;
  routines?: Routine[];
  activeRoutineId?: string;
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
  onOpenRoutine?: (routineId: string) => void;
}

/**
 * Branch-editing controls for the selected rung. Presents the rung's parallel
 * legs (the main line plus each alternate) with per-leg add buttons, so a
 * seal-in / OR structure can be built by hand. Single-level parallels only.
 */
interface BranchRow {
  branch: LadderBranch;
  depth: number;
  /** A parallel leg (vs the main line) — only legs can be removed. */
  isLeg: boolean;
}

/** Flatten the rung's branch tree into editable rows (main line, then nested legs). */
function collectBranchRows(root: LadderBranch): BranchRow[] {
  const rows: BranchRow[] = [];
  const walk = (branch: LadderBranch, depth: number, isLeg: boolean) => {
    rows.push({ branch, depth, isLeg });
    for (const leg of branch.parallelBranches ?? []) walk(leg, depth + 1, true);
  };
  walk(root, 0, false);
  return rows;
}

function BranchEditor({
  rung,
  onAddParallelBranch,
  onAddBranchLeg,
  onRemoveBranchLeg,
  onAddToBranch,
}: {
  rung: LadderRung;
  onAddParallelBranch: (rungId: string, branchId?: string) => void;
  onAddBranchLeg: (rungId: string, branchId?: string) => void;
  onRemoveBranchLeg: (rungId: string, branchId: string) => void;
  onAddToBranch: (rungId: string, branchId: string, instructionType: string) => void;
}) {
  const rows = collectBranchRows(rung.root);

  return (
    <div className="esco-branch-edit" onClick={(event) => event.stopPropagation()}>
      <div className="esco-branch-edit__head">
        <span className="esco-branch-edit__title">Branches</span>
        <span className="esco-branch-edit__hint">
          + Parallel makes a seal-in / OR branch; add a parallel inside a leg to nest.
        </span>
      </div>

      <div className="esco-branch-edit__legs">
        {rows.map((row) => {
          const { branch, depth, isLeg } = row;
          const empty =
            branch.nodes.length === 0 && !(branch.parallelBranches?.length ?? 0) && !branch.next;
          const hasParallel = (branch.parallelBranches?.length ?? 0) > 0;
          return (
            <div
              className="esco-branch-leg"
              key={branch.id}
              style={{ marginLeft: `${depth * 16}px` }}
            >
              <span className="esco-branch-leg__name">{depth === 0 ? "Main line" : "Leg"}</span>
              {branch.nodes.length === 0 ? (
                <span className="esco-branch-leg__empty">Empty branch leg — add instruction</span>
              ) : null}
              {BRANCH_INSTRUCTIONS.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="esco-btn esco-btn--instr"
                  onClick={() => onAddToBranch(rung.id, branch.id, type)}
                >
                  + {type}
                </button>
              ))}
              <button
                type="button"
                className="esco-btn esco-btn--instr"
                title={depth === 0 ? "Add a parallel branch" : "Add a nested parallel branch"}
                onClick={() => onAddParallelBranch(rung.id, branch.id)}
              >
                + Parallel
              </button>
              {hasParallel ? (
                <button
                  type="button"
                  className="esco-btn esco-btn--instr"
                  onClick={() => onAddBranchLeg(rung.id, branch.id)}
                >
                  + Leg
                </button>
              ) : null}
              {isLeg ? (
                <button
                  type="button"
                  className="esco-btn esco-btn--danger"
                  disabled={!empty}
                  title={empty ? "Remove this leg" : "Only empty legs can be removed"}
                  onClick={() => onRemoveBranchLeg(rung.id, branch.id)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
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
  { label: "Program", types: ["JSR", "SBR", "RET", "NOP", "AFI"] },
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
  routines = routine ? [routine] : [],
  activeRoutineId,
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
  onOpenRoutine,
}: Props) {
  const [showAllRungs, setShowAllRungs] = useState(false);
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
        {routines.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`esco-editor__tab${(activeRoutineId ?? routine.id) === candidate.id ? " is-active" : ""}`}
            onClick={() => onOpenRoutine?.(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
        <button type="button" className="esco-editor__tab esco-editor__tab--disabled" disabled title="Open another routine">
          +
        </button>
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
          (() => {
            const rungCap = capList(ladder.rungs, showAllRungs ? 0 : LARGE_ROUTINE_LIMIT);
            return (
          <>
          {rungCap.truncated ? (
            <div className="esco-editor__largebanner">
              Large routine — showing the first {rungCap.items.length} of {rungCap.total} rungs.
              <button type="button" className="esco-btn" onClick={() => setShowAllRungs(true)}>
                Show all rungs
              </button>
            </div>
          ) : null}
          {rungCap.items.map((rung) => (
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
          ))}
          </>
            );
          })()
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
