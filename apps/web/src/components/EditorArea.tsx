import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { arrayElementNames, isStructuredType, memberDefs, type PlcProject, type Routine } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  isNumericLiteral,
  type InstructionCategory,
  type InstructionDefinition,
} from "@esco/instructions";
import { routineNodes, type LadderBranch, type LadderNode, type LadderRung, type LadderRoutine } from "@esco/ladder";
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
  onSetStructuredTextSource: (routineId: string, source: string) => void;
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

type LadderContextMenu =
  | {
      kind: "instruction";
      x: number;
      y: number;
      rungId: string;
      nodeId: string;
      instructionType: string;
      operand: string;
    }
  | {
      kind: "rung";
      x: number;
      y: number;
      rungId: string;
      rungNumber: number;
    };

const CATEGORY_LABELS: Partial<Record<InstructionCategory, string>> = {
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
  const ordered = CATEGORY_ORDER.flatMap((category) => {
    const definitions = byCategory.get(category);
    if (!definitions?.length) return [];
    byCategory.delete(category);
    return [{
      label: CATEGORY_LABELS[category] ?? category,
      definitions: definitions.sort((a, b) => a.type.localeCompare(b.type)),
    }];
  });
  const remaining = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, definitions]) => ({
      label: CATEGORY_LABELS[category] ?? category,
      definitions: definitions.sort((a, b) => a.type.localeCompare(b.type)),
    }));
  return [...ordered, ...remaining];
}

/** Instruction palette follows the registry so backend instruction additions appear automatically. */
const INSTRUCTION_GROUPS = buildInstructionGroups();

function InstructionButton({
  definition,
  disabled,
  onAdd,
}: {
  definition: InstructionDefinition;
  disabled: boolean;
  onAdd: (instructionType: string) => void;
}) {
  return (
    <button
      key={definition.type}
      type="button"
      className={`esco-btn esco-btn--instr${definition.modelOnly ? " esco-btn--model-only" : ""}`}
      disabled={disabled}
      aria-label={definition.type}
      title={
        disabled
          ? "Select a rung first"
          : `Add ${definition.displayName}${definition.modelOnly ? " (model-only)" : ""} to the selected rung`
      }
      onClick={(event) => {
        if (!disabled) onAdd(definition.type);
        event.currentTarget.closest("details.esco-palette__group")?.removeAttribute("open");
      }}
    >
      <span>{definition.type}</span>
      {definition.modelOnly ? <span className="esco-palette__model" aria-hidden="true">M</span> : null}
    </button>
  );
}

function InstructionPalette({
  selectedRungId,
  onAddInstruction,
}: {
  selectedRungId?: string;
  onAddInstruction: (rungId: string, instructionType: string) => void;
}) {
  const disabled = !selectedRungId;
  const add = (instructionType: string) => {
    if (selectedRungId) onAddInstruction(selectedRungId, instructionType);
  };
  const closeSiblings = (current: HTMLDetailsElement) => {
    if (!current.open) return;
    current.parentElement
      ?.querySelectorAll<HTMLDetailsElement>("details.esco-palette__group[open]")
      .forEach((details) => {
        if (details !== current) details.removeAttribute("open");
      });
  };

  return (
    <div className="esco-palette" aria-label="Instruction palette">
      {INSTRUCTION_GROUPS.map((group) => (
        <details className="esco-palette__group" key={group.label} onToggle={(event) => closeSiblings(event.currentTarget)}>
          <summary
            className="esco-palette__summary"
            title={disabled ? "Select a rung first" : `${group.label} instructions (${group.definitions.length})`}
          >
            <span>{group.label}</span>
          </summary>
          <div className="esco-palette__menu" role="menu" aria-label={`${group.label} instructions`}>
            {group.definitions.map((definition) => (
              <InstructionButton
                key={definition.type}
                definition={definition}
                disabled={disabled}
                onAdd={add}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

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
      const xml = trimmed.match(/^<([A-Za-z0-9_:.-]+)([^>]*)\/?>$/);
      const legacy = trimmed.match(/^([^\[]+?)(?:\s+\[(.*)\])?$/);
      const rawAttrs = xml?.[2]?.replace(/\/$/, "").trim() ?? legacy?.[2] ?? "";
      return {
        id: `${index}-${trimmed}`,
        depth,
        name: (xml?.[1] ?? legacy?.[1] ?? trimmed).trim(),
        attrs: rawAttrs.replace(/\s+/g, " ").trim(),
      };
    })
    .filter((row) => !row.name.startsWith("/") && !row.name.startsWith("</"))
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

function NonLadderRoutineView({
  routine,
  onSetStructuredTextSource,
}: {
  routine: Routine;
  onSetStructuredTextSource: (routineId: string, source: string) => void;
}) {
  const [query, setQuery] = useState("");
  const source = routineText(routine);
  const [draftSource, setDraftSource] = useState(source);
  const editable = routine.language === "structured-text";
  const lines = source ? source.split(/\r?\n/) : [];
  const draftLines = draftSource ? draftSource.split(/\r?\n/).length : 0;
  const dirty = editable && draftSource !== source;
  const term = query.trim().toLowerCase();
  const visible = term
    ? lines
        .map((text, index) => ({ text, index }))
        .filter((line) => line.text.toLowerCase().includes(term))
    : lines.map((text, index) => ({ text, index }));
  const copySource = () => {
    void navigator.clipboard?.writeText(editable ? draftSource : source);
  };
  useEffect(() => {
    setDraftSource(source);
    setQuery("");
  }, [routine.id, source]);

  return (
    <div className="esco-nonladder">
      <header className="esco-nonladder__head">
        <div>
          <h1>{routine.name}</h1>
          <p>
            {editable
              ? "Structured Text source is editable and exports with the project. It is not executed by Offline Simulation yet."
              : `${LANGUAGE_LABEL[routine.language]} imported routine is preserved read-only for review. It is not executed by Offline Simulation.`}
          </p>
        </div>
        <div className="esco-nonladder__badges">
          <span className="esco-detail__readonly">{editable ? "Editable ST" : "Read-only"}</span>
          <span className="esco-detail__readonly">
            {editable ? draftLines : lines.length} line{(editable ? draftLines : lines.length) === 1 ? "" : "s"}
          </span>
          {dirty ? <span className="esco-detail__readonly">Unsaved ST edit</span> : null}
          {!editable && term ? <span className="esco-detail__readonly">{visible.length} match{visible.length === 1 ? "" : "es"}</span> : null}
        </div>
      </header>
      <div className="esco-nonladder__toolbar">
        {editable ? (
          <span className="esco-nonladder__hint">Apply saves through project-actions; simulation continues to skip ST routines.</span>
        ) : (
          <input
            className="esco-tags__search"
            value={query}
            placeholder="Search source..."
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <button type="button" className="esco-btn" disabled={editable ? !draftSource : !source} onClick={copySource}>
          Copy source
        </button>
        {editable ? (
          <>
            <button
              type="button"
              className="esco-btn"
              disabled={!dirty}
              onClick={() => setDraftSource(source)}
            >
              Revert
            </button>
            <button
              type="button"
              className="esco-btn esco-btn--primary"
              disabled={!dirty}
              onClick={() => onSetStructuredTextSource(routine.id, draftSource)}
            >
              Apply ST
            </button>
          </>
        ) : null}
      </div>
      {editable ? (
        <textarea
          className="esco-st-editor"
          value={draftSource}
          spellCheck={false}
          aria-label={`${routine.name} Structured Text source`}
          placeholder="Enter Structured Text source..."
          onChange={(event) => setDraftSource(event.target.value)}
        />
      ) : source ? (
        <GraphicalRoutineOutline source={source} query={query} />
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

function ContextShortcut({ children }: { children: string }) {
  return <span className="esco-context-menu__shortcut">{children}</span>;
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
  onSetStructuredTextSource,
  onOpenRoutine,
}: Props) {
  const [showAllRungs, setShowAllRungs] = useState(false);
  const [contextMenu, setContextMenu] = useState<LadderContextMenu | null>(null);
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
    onOpenInstructionMenu: (event: MouseEvent<HTMLElement>, rungId: string, node: LadderNode) => {
      setContextMenu({
        kind: "instruction",
        x: event.clientX,
        y: event.clientY,
        rungId,
        nodeId: node.id,
        instructionType: node.instructionType,
        operand: node.operands[0]?.value ?? "",
      });
    },
    isUndefinedTag: (value: string) => {
      const base = baseTagName(value);
      return base !== "" && !tagExists(project, base);
    },
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

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
        <NonLadderRoutineView routine={routine} onSetStructuredTextSource={onSetStructuredTextSource} />
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
          <InstructionPalette selectedRungId={selectedRungId} onAddInstruction={onAddInstruction} />
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
              onContextMenu={(event) => {
                event.preventDefault();
                onSelectRung(rung.id);
                setContextMenu({
                  kind: "rung",
                  x: event.clientX,
                  y: event.clientY,
                  rungId: rung.id,
                  rungNumber: rung.number,
                });
              }}
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
      {contextMenu ? (
        <div
          className="esco-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="esco-context-menu__title">
            {contextMenu.kind === "instruction"
              ? `${contextMenu.instructionType} ${contextMenu.operand}`.trim()
              : `Rung ${String(contextMenu.rungNumber).padStart(3, "0")}`}
          </div>
          {contextMenu.kind === "instruction" ? (
            <>
              <button type="button" className="esco-context-menu__item" onClick={() => setContextMenu(null)}>
                <span className="esco-context-menu__icon">✎</span>
                Edit Operand
                <ContextShortcut>Enter</ContextShortcut>
              </button>
              <button type="button" className="esco-context-menu__item" disabled>
                <span className="esco-context-menu__icon">◉</span>
                Toggle XIC / XIO
                <ContextShortcut>T</ContextShortcut>
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                onClick={() => {
                  onAddParallelBranch(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">⑂</span>
                Add Parallel Branch
                <ContextShortcut>›</ContextShortcut>
              </button>
              <button type="button" className="esco-context-menu__item" disabled>
                <span className="esco-context-menu__icon">{"{}"}</span>
                Replace Instruction
                <ContextShortcut>Ctrl+R ›</ContextShortcut>
              </button>
              <div className="esco-context-menu__sep" />
              <button type="button" className="esco-context-menu__item" disabled>
                <span className="esco-context-menu__icon">◌</span>
                Watch Tag
                <ContextShortcut>Ctrl+W</ContextShortcut>
              </button>
              <button type="button" className="esco-context-menu__item" disabled>
                <span className="esco-context-menu__icon">⌕</span>
                Cross Reference Tag
                <ContextShortcut>Shift+F12</ContextShortcut>
              </button>
              <button type="button" className="esco-context-menu__item" disabled>
                <span className="esco-context-menu__icon">⚙</span>
                Force Value
              </button>
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item esco-context-menu__item--danger"
                onClick={() => {
                  onRemoveInstruction(contextMenu.rungId, contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">⌫</span>
                Delete Instruction
                <ContextShortcut>Del</ContextShortcut>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="esco-context-menu__item"
                onClick={() => {
                  onAddRung();
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">+</span>
                Add Rung Below
                <ContextShortcut>Ctrl+I</ContextShortcut>
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                onClick={() => {
                  onDuplicateRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">⧉</span>
                Duplicate Rung
                <ContextShortcut>Ctrl+D</ContextShortcut>
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                onClick={() => {
                  onCopyRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">□</span>
                Copy Rung
              </button>
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item esco-context-menu__item--danger"
                onClick={() => {
                  onDeleteRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon">⌫</span>
                Delete Rung
                <ContextShortcut>Del</ContextShortcut>
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
