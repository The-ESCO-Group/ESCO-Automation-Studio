import { useMemo, useState } from "react";
import { arrayElementNames, isStructuredType, memberDefs, type PlcProject, type Routine } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  isNumericLiteral,
  type InstructionCategory,
  type InstructionDefinition,
} from "@esco/instructions";
import { routineNodes, type LadderBranch, type LadderRung, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding } from "@esco/validator";
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
  findings?: ValidationFinding[];
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

interface InstructionGroup {
  label: string;
  definitions: InstructionDefinition[];
}

const CATEGORY_LABELS: Record<InstructionCategory, string> = {
  bit: "Bit",
  timer: "Timer",
  counter: "Counter",
  compare: "Compare",
  math: "Math",
  move: "Move",
  "program-control": "Program",
  sequencer: "Sequencer",
  shift: "Shift",
  file: "File",
  message: "Message",
  alarm: "Alarm",
  motion: "Motion",
};

const CATEGORY_ORDER: InstructionCategory[] = [
  "bit",
  "timer",
  "counter",
  "move",
  "math",
  "compare",
  "program-control",
  "sequencer",
  "shift",
  "file",
  "message",
  "alarm",
  "motion",
];

function buildInstructionGroups(): InstructionGroup[] {
  const byCategory = new Map<InstructionCategory, InstructionDefinition[]>();
  for (const definition of registry.all()) {
    const current = byCategory.get(definition.category) ?? [];
    current.push(definition);
    byCategory.set(definition.category, current);
  }
  return CATEGORY_ORDER.flatMap((category) => {
    const definitions = byCategory.get(category);
    if (!definitions?.length) return [];
    return [{
      label: CATEGORY_LABELS[category],
      definitions: definitions.sort((a, b) => a.type.localeCompare(b.type)),
    }];
  });
}

/** Instruction palette follows the registry so backend instruction additions appear automatically. */
const INSTRUCTION_GROUPS = buildInstructionGroups();

const LANGUAGE_LABEL: Record<Routine["language"], string> = {
  ladder: "Ladder",
  "structured-text": "Structured Text",
  "function-block": "Function Block",
  sfc: "SFC",
};

function RoutineTabs({
  routines,
  activeRoutineId,
  fallbackRoutineId,
  onOpenRoutine,
}: {
  routines: Routine[];
  activeRoutineId?: string;
  fallbackRoutineId?: string;
  onOpenRoutine?: (routineId: string) => void;
}) {
  return (
    <div className="esco-editor__tabs">
      {routines.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          className={`esco-editor__tab${(activeRoutineId ?? fallbackRoutineId) === candidate.id ? " is-active" : ""}`}
          onClick={() => onOpenRoutine?.(candidate.id)}
        >
          {candidate.name}
          <span className="esco-editor__tab-lang">{candidate.language === "ladder" ? "LD" : LANGUAGE_LABEL[candidate.language]}</span>
        </button>
      ))}
      <button type="button" className="esco-editor__tab esco-editor__tab--disabled" disabled title="Open another routine">
        +
      </button>
    </div>
  );
}

function routineText(routine: Routine): string {
  if (routine.language === "structured-text") return routine.structuredText ?? routine.sourceText ?? "";
  return routine.sourceText ?? "";
}

function outlineRows(source: string, query: string): { id: string; depth: number; name: string; attrs: string }[] {
  const term = query.trim().toLowerCase();
  return source
    .split(/\r?\n/)
    .map((line, index) => {
      const depth = Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2);
      const trimmed = line.trim();
      const match = trimmed.match(/^([^\[]+?)(?:\s+\[(.*)\])?$/);
      return {
        id: `${index}-${trimmed}`,
        depth,
        name: (match?.[1] ?? trimmed).trim(),
        attrs: (match?.[2] ?? "").trim(),
      };
    })
    .filter((row) => row.name.length > 0)
    .filter((row) => !term || `${row.name} ${row.attrs}`.toLowerCase().includes(term));
}

function GraphicalRoutineOutline({ source, query }: { source: string; query: string }) {
  const rows = outlineRows(source, query);
  return (
    <div className="esco-graphical-outline">
      {rows.map((row) => (
        <div className="esco-graphical-outline__row" key={row.id} style={{ paddingLeft: `${row.depth * 18 + 10}px` }}>
          <span className="esco-graphical-outline__glyph" aria-hidden="true" />
          <strong>{row.name}</strong>
          {row.attrs ? <code>{row.attrs}</code> : null}
        </div>
      ))}
      {rows.length === 0 ? <p className="esco-empty">No source lines match the current search.</p> : null}
    </div>
  );
}

function NonLadderRoutineView({ routine }: { routine: Routine }) {
  const [query, setQuery] = useState("");
  const source = routineText(routine);
  const lines = source ? source.split(/\r?\n/) : [];
  const term = query.trim().toLowerCase();
  const visible = term
    ? lines
        .map((text, index) => ({ text, index }))
        .filter((line) => line.text.toLowerCase().includes(term))
    : lines.map((text, index) => ({ text, index }));
  const copySource = () => {
    void navigator.clipboard?.writeText(source);
  };

  return (
    <div className="esco-nonladder">
      <header className="esco-nonladder__head">
        <div>
          <h1>{routine.name}</h1>
          <p>
            {LANGUAGE_LABEL[routine.language]} imported routine is preserved read-only for review. It is not executed by Offline Simulation.
          </p>
        </div>
        <div className="esco-nonladder__badges">
          <span className="esco-detail__readonly">Read-only</span>
          <span className="esco-detail__readonly">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
          {term ? <span className="esco-detail__readonly">{visible.length} match{visible.length === 1 ? "" : "es"}</span> : null}
        </div>
      </header>
      <div className="esco-nonladder__toolbar">
        <input
          className="esco-tags__search"
          value={query}
          placeholder="Search source..."
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="esco-btn" disabled={!source} onClick={copySource}>
          Copy source
        </button>
      </div>
      {source ? (
        routine.language === "structured-text" ? (
          <ol className="esco-st-viewer">
            {visible.map((line) => (
              <li key={line.index} value={line.index + 1}>
                <code>{line.text || " "}</code>
              </li>
            ))}
          </ol>
        ) : (
          <GraphicalRoutineOutline source={source} query={query} />
        )
      ) : (
        <div className="esco-nonladder__empty">
          <p>Readonly imported routine. Editing/simulation not supported yet.</p>
          <p>No preserved source body was provided by the import backend.</p>
        </div>
      )}
    </div>
  );
}

function operandSuggestions(project: PlcProject): string[] {
  const suggestions = new Set<string>();
  const udts = new Map(project.controllers.flatMap((controller) => controller.dataTypes.map((udt) => [udt.name, udt.members])));
  const tags = project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);

  for (const tag of tags) {
    suggestions.add(tag.name);
    if (tag.dimension && tag.dimension > 0 && !isStructuredType(tag.dataType)) {
      for (const element of arrayElementNames(tag.name, Math.min(tag.dimension, 32))) suggestions.add(element);
    }
    const members = isStructuredType(tag.dataType)
      ? memberDefs(tag.dataType)
      : udts.get(tag.dataType) ?? [];
    for (const member of members) {
      suggestions.add(`${tag.name}.${member.name}`);
      const memberDimension = "dimension" in member ? member.dimension : undefined;
      if (memberDimension && memberDimension > 0) {
        for (let i = 0; i < Math.min(memberDimension, 16); i += 1) {
          suggestions.add(`${tag.name}.${member.name}[${i}]`);
        }
      }
    }
  }

  return [...suggestions].sort((a, b) => a.localeCompare(b));
}

function findingForRoutine(finding: ValidationFinding, routine: Routine): boolean {
  return finding.target?.split("/").includes(routine.name) ?? false;
}

function rungText(rung: LadderRung): string {
  return [
    rung.comment ?? "",
    ...routineNodes({ id: "tmp", rungs: [rung] }).flatMap((node) => [
      node.instructionType,
      ...node.operands.map((operand) => operand.value),
    ]),
  ].join(" ");
}

function findingMatchesRung(finding: ValidationFinding, rung: LadderRung): boolean {
  const text = rungText(rung);
  const quoted = [...finding.message.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return quoted.length > 0 ? quoted.some((part) => part && text.includes(part)) : false;
}

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
  findings = [],
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
  const suggestions = useMemo(() => operandSuggestions(project), [project]);
  const routineFindings = useMemo(
    () => (routine ? findings.filter((finding) => findingForRoutine(finding, routine)) : []),
    [findings, routine],
  );
  const findingsByRung = useMemo(() => {
    const map = new Map<string, ValidationFinding[]>();
    if (!ladder) return map;
    for (const rung of ladder.rungs) {
      const matches = routineFindings.filter((finding) => findingMatchesRung(finding, rung));
      if (matches.length > 0) map.set(rung.id, matches);
    }
    return map;
  }, [ladder, routineFindings]);
  const undefinedTags = useMemo(
    () => (ladder ? findUndefinedTags(ladder, project) : []),
    [ladder, project],
  );

  const editing = {
    onEditOperand,
    onRemoveInstruction,
    onSelectNode,
    selectedNodeId,
    operandSuggestions: suggestions,
    isUndefinedTag: (value: string) => {
      const base = baseTagName(value);
      return base !== "" && !tagExists(project, base);
    },
  };

  if (!routine) {
    return (
      <div className="esco-editor">
        <div className="esco-editor__empty">
          <h1>ESCO Automation Studio</h1>
          <p>Select a routine in the Project Explorer to edit its ladder.</p>
        </div>
      </div>
    );
  }

  if (routine.language !== "ladder" || !ladder) {
    return (
      <div className="esco-editor">
        <RoutineTabs
          routines={routines}
          activeRoutineId={activeRoutineId}
          fallbackRoutineId={routine.id}
          onOpenRoutine={onOpenRoutine}
        />
        <NonLadderRoutineView routine={routine} />
      </div>
    );
  }

  return (
    <div className="esco-editor">
      <RoutineTabs
        routines={routines}
        activeRoutineId={activeRoutineId}
        fallbackRoutineId={routine.id}
        onOpenRoutine={onOpenRoutine}
      />

      <div className="esco-editor__surface">
        {routineFindings.length > 0 ? (
          <div className="esco-editor__validation">
            <strong>{routineFindings.length} validation finding{routineFindings.length === 1 ? "" : "s"}</strong>
            <span>Rung badges highlight findings that can be associated with referenced tags.</span>
          </div>
        ) : null}
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
                {group.definitions.map((definition) => (
                  <button
                    key={definition.type}
                    type="button"
                    className={`esco-btn esco-btn--instr${definition.modelOnly ? " esco-btn--model-only" : ""}`}
                    disabled={!selectedRungId}
                    aria-label={definition.type}
                    title={
                      selectedRungId
                        ? `Add ${definition.displayName}${definition.modelOnly ? " (model-only)" : ""} to the selected rung`
                        : "Select a rung first"
                    }
                    onClick={() => selectedRungId && onAddInstruction(selectedRungId, definition.type)}
                  >
                    <span>{definition.type}</span>
                    {definition.modelOnly ? <span className="esco-palette__model" aria-hidden="true">M</span> : null}
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
            (() => {
              const rungFindings = findingsByRung.get(rung.id) ?? [];
              return (
            <div
              key={rung.id}
              className={`esco-lad__rung${selectedRungId === rung.id ? " is-selected" : ""}${
                rungFindings.length ? " has-finding" : ""
              }`}
              onClick={() => onSelectRung(rung.id)}
            >
              <div className="esco-lad__rung-head">
                <span className="esco-lad__rung-no">{rung.number}</span>
                {rungFindings.length > 0 ? (
                  <span
                    className={`esco-lad__finding esco-lad__finding--${rungFindings.some((finding) => finding.severity === "error") ? "error" : "warning"}`}
                    title={rungFindings.map((finding) => finding.message).join("\n")}
                  >
                    {rungFindings.length}
                  </span>
                ) : null}
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
              );
            })()
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
