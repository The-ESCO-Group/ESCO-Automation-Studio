import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { arrayDimensionsOf, arrayElementNames, isStructuredType, memberDefs, type AddOnInstruction, type PlcProject, type Routine } from "@esco/core";
import { baseTagName } from "@esco/instructions";
import { routineNodes, rungToText, type LadderBranch, type LadderNode, type LadderRung, type LadderRoutine } from "@esco/ladder";
import { analyzeStructuredText } from "@esco/parser-l5x";
import { reviewFbdRoutineSource, type FbdReviewBlock, type FbdReviewParameter } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import { getTags } from "../project-edit";
import { virtualWindow } from "../windowing";
import type { ControllerCommunicationAction } from "../controller-session";
import { RungDiagram, type LadderDisplayOptions, type OperandMetadata } from "./LadderView";

/** Above this many rungs the editor renders only the visible scroll window. */
const LARGE_ROUTINE_LIMIT = 100;
const VIRTUAL_RUNG_HEIGHT = 154;
const VIRTUAL_RUNG_OVERSCAN = 8;
type OfflineEditLifecycleState = "none" | "test" | "assembled" | "finalized" | "canceled";

interface SuggestionMember {
  name: string;
  dimension?: number;
  dimensions?: number[];
}

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
  onCutRung: (rungId: string) => void;
  onPasteRung: () => void;
  canPaste: boolean;
  onDuplicateRung: (rungId: string) => void;
  /** Insert a new empty rung directly above/below the target rung. */
  onInsertRung?: (rungId: string, position: "above" | "below") => void;
  /** Paste the clipboard rung directly above/below the target rung. */
  onPasteRungRelative?: (rungId: string, position: "above" | "below") => void;
  /** Add another empty parallel leg to the rung's branch group. */
  onAddBranchLeg?: (rungId: string, branchId?: string) => void;
  /** Remove an empty parallel branch leg from the rung. */
  onRemoveBranchLeg?: (rungId: string, branchId: string) => void;
  /** Validate just this rung (offline rung verify). */
  onVerifyRung?: (rungId: string) => void;
  /** Open cross-reference results for the tags used on this rung. */
  onCrossReferenceRung?: (rungId: string) => void;
  /** Insert a new instruction immediately before/after an existing one. */
  onInsertInstruction?: (rungId: string, nodeId: string, position: "before" | "after") => void;
  /** Clear a simulated force on a tag. */
  onUnforceTag?: (tagName: string) => void;
  onSetRungComment: (rungId: string, comment: string, routineId?: string) => void;
  onEditOperand: (rungId: string, nodeId: string, index: number, value: string, routineId?: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  /** Reorder an instruction relative to another instruction on the same rung (drag-reorder). */
  onMoveInstruction?: (rungId: string, nodeId: string, targetNodeId: string, position: "before" | "after") => void;
  /** Open the Add Ladder Element picker for a specific empty branch leg. */
  onPickInstructionForBranch?: (rungId: string, branchId: string) => void;
  onCreateTag: (name: string, dataType: string) => void;
  /** Open the New Tag dialog prefilled from a missing operand (name + inferred type). */
  onCreateTagFromOperand?: (instructionType: string, baseName: string, operandIndex?: number) => void;
  /** Open the Add Ladder Element picker for the given rung. */
  onAddLadderElement?: (rungId: string) => void;
  onSelectRung: (rungId: string) => void;
  onSelectNode: (rungId: string, nodeId: string) => void;
  onAddParallelBranch: (rungId: string, branchId?: string) => void;
  onSetStructuredTextSource: (routineId: string, source: string) => void;
  onEditTagProperties?: (tagName: string) => void;
  onWatchTag?: (tagName: string) => void;
  onCrossReferenceTag?: (tagName: string) => void;
  onForceTag?: (tagName: string) => void;
  onToggleBit?: (tagName: string) => void;
  onTrendTag?: (tagName: string) => void;
  onInstructionHelp?: (instructionType: string, operand: string) => void;
  onOpenRoutine?: (routineId: string) => void;
  onCloseRoutine?: (routineId: string) => void;
  onControllerAction?: (action: ControllerCommunicationAction) => void;
  /** Session-local offline review state for imported pending online edits. */
  editState?: OfflineEditLifecycleState;
  /** True when the ESCO Virtual Controller is scanning and project edits are read-only. */
  editLocked?: boolean;
}

type LadderContextMenu =
  | {
      kind: "instruction";
      x: number;
      y: number;
      rungId: string;
      nodeId: string;
      branchId?: string;
      instructionType: string;
      operand: string;
      operandIndex: number;
    }
  | {
      kind: "rung";
      x: number;
      y: number;
      rungId: string;
      rungNumber: number;
    };

type ContextMenuReturnFocus = {
  element: HTMLElement | null;
  selector?: string;
};

type RoutineCommand =
  | { kind: "find"; value: string; message?: string }
  | { kind: "goto"; value: string; message?: string }
  | {
      kind: "operand";
      routineId: string;
      rungId: string;
      nodeId: string;
      instructionType: string;
      operandIndex: number;
      value: string;
      message?: string;
    }
  | { kind: "comment"; routineId: string; rungId: string; rungNumber: number; value: string; message?: string };

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
  onCloseRoutine,
}: {
  routines: Routine[];
  activeRoutineId?: string;
  fallbackRoutineId?: string;
  onOpenRoutine?: (routineId: string) => void;
  onCloseRoutine?: (routineId: string) => void;
}) {
  const currentRoutineId = activeRoutineId ?? fallbackRoutineId;
  return (
    <div className="esco-editor__tabs">
      {routines.map((candidate) => (
        <span
          key={candidate.id}
          className={`esco-editor__tab${currentRoutineId === candidate.id ? " is-active" : ""}`}
        >
          <button type="button" className="esco-editor__tab-main" onClick={() => onOpenRoutine?.(candidate.id)}>
            <span className="esco-editor__tab-icon" aria-hidden="true" />
            <span className="esco-editor__tab-title">MainTask.MainProgram.{candidate.name}</span>
          </button>
          <button
            type="button"
            className="esco-editor__tab-close"
            tabIndex={currentRoutineId === candidate.id ? 0 : -1}
            aria-label={`Close ${candidate.name}`}
            title="Close"
            onClick={(event) => {
              event.stopPropagation();
              onCloseRoutine?.(candidate.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onCloseRoutine?.(candidate.id);
            }}
          />
        </span>
      ))}
      <span className="esco-editor__tab-controls" aria-hidden="true">
        <span className="esco-editor__tab-control esco-editor__tab-control--list" />
        <span className="esco-editor__tab-control esco-editor__tab-control--close" />
      </span>
    </div>
  );
}

const ONLINE_EDIT_GUARD =
  "Online edit assemble/finalize runs on a controller; it stays blocked because no tested controller transport is configured.";
const ONLINE_EDIT_COMMANDS = [
  { label: "Test Edits", action: "test-edits" },
  { label: "Assemble Edits", action: "assemble-edits" },
  { label: "Finalize All Edits", action: "finalize-edits" },
  { label: "Cancel Edits", action: "cancel-edits" },
] as const satisfies readonly { label: string; action: ControllerCommunicationAction }[];

function onlineEditTitle(editState: OfflineEditLifecycleState): string {
  if (editState === "assembled") return "Offline Edits Assembled";
  return "Pending Test Edits";
}

function onlineEditLegend(editState: OfflineEditLifecycleState): string {
  if (editState === "assembled") return "assembled locally; finalize/cancel is review-only";
  return "marks rungs in this edit";
}

/** Classic online-edit state strip: surfaces pending test edits with guarded Studio-style controls. */
function RoutineOnlineEditBar({
  editState,
  onControllerAction,
}: {
  editState: OfflineEditLifecycleState;
  onControllerAction?: (action: ControllerCommunicationAction) => void;
}) {
  return (
    <div className="esco-editor__onlineedit-bar" aria-label="Pending online edit state" data-edit-state={editState}>
      <span className="esco-editor__onlineedit-title">{onlineEditTitle(editState)}</span>
      <span className="esco-editor__onlineedit-legend">
        <span className="esco-editor__onlineedit-marker" aria-hidden="true">e</span>
        {onlineEditLegend(editState)}
      </span>
      <span className="esco-editor__onlineedit-spacer" aria-hidden="true" />
      <div className="esco-editor__onlineedit-actions" aria-label="Online edit commands">
        {ONLINE_EDIT_COMMANDS.map((command) => (
          <button
            key={command.action}
            type="button"
            className="esco-editor__onlineedit-btn"
            disabled={!onControllerAction}
            onClick={() => onControllerAction?.(command.action)}
            title={ONLINE_EDIT_GUARD}
          >
            {command.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function commandTitle(command: RoutineCommand): string {
  if (command.kind === "find") return "Find In Routine";
  if (command.kind === "goto") return "Go To Rung";
  if (command.kind === "comment") return `Rung ${command.rungNumber} Comment`;
  return `${command.instructionType} Operand`;
}

function commandLabel(command: RoutineCommand): string {
  if (command.kind === "find") return "Find text";
  if (command.kind === "goto") return "Rung number";
  if (command.kind === "comment") return "Rung comment";
  return "Operand value";
}

function commandAction(command: RoutineCommand): string {
  if (command.kind === "find") return "Find Next";
  if (command.kind === "goto") return "Go";
  return "Apply";
}

function RoutineCommandBar({
  command,
  onChange,
  onApply,
  onCancel,
}: {
  command: RoutineCommand;
  onChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const focusKey =
    command.kind === "operand"
      ? `${command.kind}:${command.nodeId}:${command.operandIndex}`
      : command.kind === "comment"
        ? `${command.kind}:${command.rungId}`
        : command.kind;
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  return (
    <form
      className={`esco-routine-command esco-routine-command--${command.kind}`}
      aria-label={commandTitle(command)}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="esco-routine-command__label">
        <strong>{commandTitle(command)}</strong>
        {command.message ? <span className="esco-routine-command__message">{command.message}</span> : null}
      </div>
      <label className="esco-routine-command__field">
        <span>{commandLabel(command)}</span>
        {command.kind === "comment" ? (
          <textarea
            ref={(node) => {
              inputRef.current = node;
            }}
            aria-label="Rung comment"
            value={command.value}
            rows={2}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            ref={(node) => {
              inputRef.current = node;
            }}
            aria-label={commandLabel(command)}
            type={command.kind === "goto" ? "number" : "text"}
            value={command.value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </label>
      <div className="esco-routine-command__actions">
        <button type="submit" className="esco-btn esco-btn--primary">{commandAction(command)}</button>
        <button type="button" className="esco-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function RoutineLocalToolbar({
  selectedRungId,
  canPaste,
  editLocked = false,
  display,
  inspector,
  onToggleTagDescriptions,
  onToggleOperandMeta,
  onPlainOperandMode,
  onToggleInspector,
  onAddRung,
  onDeleteRung,
  onCopyRung,
  onCutRung,
  onPasteRung,
  onDuplicateRung,
  onAddParallelBranch,
  onFindInRoutine,
  onGoToRung,
}: {
  selectedRungId?: string;
  canPaste: boolean;
  editLocked?: boolean;
  display: { tagDescriptions: boolean; operandMeta: boolean };
  inspector: "branch" | "source" | null;
  onToggleTagDescriptions: () => void;
  onToggleOperandMeta: () => void;
  onPlainOperandMode: () => void;
  onToggleInspector: (mode: "branch" | "source") => void;
  onAddRung: () => void;
  onDeleteRung: (rungId: string) => void;
  onCopyRung: (rungId: string) => void;
  onCutRung: (rungId: string) => void;
  onPasteRung: () => void;
  onDuplicateRung: (rungId: string) => void;
  onAddParallelBranch: (rungId: string) => void;
  onFindInRoutine: () => void;
  onGoToRung: () => void;
}) {
  const withSelectedRung = (action: (rungId: string) => void) => () => {
    if (selectedRungId) action(selectedRungId);
  };
  const selected = Boolean(selectedRungId);
  const button = (
    label: string,
    icon: string,
    action?: () => void,
    options: { disabled?: boolean; pressed?: boolean; text?: boolean } = {},
  ) => (
    <button
      key={label}
      type="button"
      className={`esco-editor__tool-btn${options.pressed ? " is-pressed" : ""}${options.text ? " esco-editor__tool-btn--text" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={options.pressed || undefined}
      disabled={options.disabled}
      onClick={action}
    >
      <span className={`esco-editor__tool-icon esco-editor__tool-icon--${icon}`} aria-hidden="true">
        {options.text ? icon : ""}
      </span>
    </button>
  );

  return (
    <div className="esco-editor__local-toolbar" aria-label="Routine toolbar">
      <div className="esco-editor__tool-group">
        {button("Find in routine", "search", onFindInRoutine)}
        {button("Go to rung", "goto", onGoToRung)}
      </div>
      <div className="esco-editor__tool-group">
        {button("Add rung", "rung-add", onAddRung, { disabled: editLocked })}
        {button("Delete rung", "rung-delete", withSelectedRung(onDeleteRung), { disabled: !selected || editLocked })}
        {button("Copy rung", "copy", withSelectedRung(onCopyRung), { disabled: !selected })}
        {button("Cut rung", "cut", withSelectedRung(onCutRung), { disabled: !selected || editLocked })}
        {button("Paste rung", "paste", onPasteRung, { disabled: !canPaste })}
        {button("Duplicate rung", "duplicate", withSelectedRung(onDuplicateRung), { disabled: !selected || editLocked })}
        {button("Add parallel branch", "branch", withSelectedRung(onAddParallelBranch), { disabled: !selected || editLocked })}
      </div>
      <div className="esco-editor__tool-group">
        {button("Operand text mode", "abc", onPlainOperandMode, {
          pressed: !display.tagDescriptions && !display.operandMeta,
          text: true,
        })}
        {button("Tag description display", "tag", onToggleTagDescriptions, {
          pressed: display.tagDescriptions,
          text: true,
        })}
        {button("Operand inline display", "ab", onToggleOperandMeta, {
          pressed: display.operandMeta,
          text: true,
        })}
      </div>
      <div className="esco-editor__tool-group">
        {button("Show branch structure", "tree", () => onToggleInspector("branch"), { pressed: inspector === "branch" })}
        {button("Show instruction source", "angle", () => onToggleInspector("source"), { pressed: inspector === "source" })}
      </div>
    </div>
  );
}

/**
 * Studio-style rung inspection drawer. Shows either the branch/tree structure of
 * the selected rung or its serialized neutral instruction source (via the
 * @esco/ladder serializer), so the two display-mode toolbar buttons surface real
 * project state instead of decorative output.
 */
function RungInspector({
  mode,
  rung,
  onClose,
}: {
  mode: "branch" | "source";
  rung: LadderRung | undefined;
  onClose: () => void;
}) {
  const title = mode === "branch" ? "Branch Structure" : "Instruction Source";
  const copySource = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };
  return (
    <div className="esco-rung-inspector" aria-label={`Rung ${title}`} role="region">
      <header className="esco-rung-inspector__head">
        <strong>
          {title}
          {rung ? ` — Rung ${rung.number}` : ""}
        </strong>
        <button type="button" className="esco-rung-inspector__close" aria-label="Close inspector" title="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {!rung ? (
        <p className="esco-empty">Select a rung to inspect its {mode === "branch" ? "branch structure" : "instruction source"}.</p>
      ) : mode === "branch" ? (
        <div className="esco-rung-inspector__tree">
          {branchOutline(rung.root).map((row) => (
            <div
              className="esco-rung-inspector__row"
              key={row.id}
              style={{ paddingLeft: `${row.depth * 18 + 8}px` }}
            >
              <span className="esco-rung-inspector__glyph" aria-hidden="true" />
              <strong>{row.label}</strong>
              <code>{row.detail}</code>
            </div>
          ))}
        </div>
      ) : (
        <div className="esco-rung-inspector__source">
          <pre aria-label="Serialized rung source">{rungToText(rung) || "(empty rung)"}</pre>
          <button type="button" className="esco-btn" onClick={() => copySource(rungToText(rung))}>
            Copy source
          </button>
        </div>
      )}
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

function compactAttributes(attributes: Record<string, unknown> | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .filter(([, value]) => value != null && String(value).length > 0)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function fbdPosition(x?: number, y?: number): string {
  if (x == null && y == null) return "-";
  return `${x ?? "-"}, ${y ?? "-"}`;
}

function fbdParameterDirectionLabel(direction: string): string {
  return direction === "input" ? "In" : direction === "output" ? "Out" : direction === "inout" ? "InOut" : "Param";
}

type FbdParameterRow = {
  block: FbdReviewBlock;
  parameter: FbdReviewParameter;
};

function FbdRoutineReview({ source, query }: { source: string; query: string }) {
  const review = useMemo(() => reviewFbdRoutineSource(source), [source]);
  const term = query.trim().toLowerCase();
  const matches = (...parts: unknown[]) =>
    !term || parts.map((part) => String(part ?? "")).join(" ").toLowerCase().includes(term);
  const visibleSheets = review.sheets
    .map((sheet) => {
      const sheetText = [sheet.name, sheet.number, compactAttributes(sheet.attributes)].join(" ");
      const sheetMatches = matches(sheetText);
      const blocks = sheet.blocks.filter((block) =>
        sheetMatches ||
        matches(
          block.type,
          block.operand,
          block.id,
          compactAttributes(block.attributes),
          block.x,
          block.y,
        ),
      );
      const parameters = sheet.blocks.flatMap((block): FbdParameterRow[] =>
        block.parameters
          .map((parameter) => ({ block, parameter }))
          .filter(
            ({ block, parameter }) =>
              sheetMatches ||
              matches(
                block.type,
                block.id,
                parameter.direction,
                parameter.name,
                parameter.value,
                parameter.id,
                compactAttributes(parameter.attributes),
                parameter.x,
                parameter.y,
              ),
          ),
      );
      const inputRefs = sheet.inputRefs.filter((ref) =>
        sheetMatches || matches(ref.operand, ref.id, compactAttributes(ref.attributes), ref.x, ref.y),
      );
      const outputRefs = sheet.outputRefs.filter((ref) =>
        sheetMatches || matches(ref.operand, ref.id, compactAttributes(ref.attributes), ref.x, ref.y),
      );
      const wires = sheet.wires.filter((wire) =>
        sheetMatches ||
        matches(
          wire.id,
          wire.fromId,
          wire.toId,
          wire.fromOperand,
          wire.toOperand,
          compactAttributes(wire.attributes),
        ),
      );
      const textBoxes = sheet.textBoxes.filter((textBox) =>
        sheetMatches || matches(textBox.text, textBox.id, compactAttributes(textBox.attributes), textBox.x, textBox.y),
      );
      const unknownElements = sheet.unknownElements.filter((element) =>
        sheetMatches || matches(element.name, compactAttributes(element.attributes)),
      );
      return { sheet, blocks, parameters, inputRefs, outputRefs, wires, textBoxes, unknownElements };
    })
    .filter((sheet) =>
      !term ||
      sheet.blocks.length ||
      sheet.parameters.length ||
      sheet.inputRefs.length ||
      sheet.outputRefs.length ||
      sheet.wires.length ||
      sheet.textBoxes.length ||
      sheet.unknownElements.length,
    );

  return (
    <div className="esco-fbd-review" aria-label="Function Block Diagram review">
      <div className="esco-fbd-review__summary">
        <span className="esco-fbd-review__pill">Model-only review</span>
        <span>{review.parseable ? "XML parseable" : "Preserved source only"}</span>
        <span>{review.summary.sheetCount} sheet{review.summary.sheetCount === 1 ? "" : "s"}</span>
        <span>{review.summary.blockCount} block{review.summary.blockCount === 1 ? "" : "s"}</span>
        {review.summary.parameterCount ? (
          <span>{review.summary.parameterCount} parameter{review.summary.parameterCount === 1 ? "" : "s"}</span>
        ) : null}
        <span>{review.summary.inputRefCount} input ref{review.summary.inputRefCount === 1 ? "" : "s"}</span>
        <span>{review.summary.outputRefCount} output ref{review.summary.outputRefCount === 1 ? "" : "s"}</span>
        <span>{review.summary.wireCount} wire{review.summary.wireCount === 1 ? "" : "s"}</span>
        {review.summary.blockTypes.length ? (
          <span>
            Blocks {review.summary.blockTypes.slice(0, 4).map((row) => `${row.name} x${row.count}`).join(", ")}
          </span>
        ) : null}
        {review.summary.wireEndpointGapCount ? (
          <span>{review.summary.wireEndpointGapCount} wire endpoint gap{review.summary.wireEndpointGapCount === 1 ? "" : "s"}</span>
        ) : null}
        {review.summary.diagnosticWarningCount ? (
          <span>{review.summary.diagnosticWarningCount} semantic warning{review.summary.diagnosticWarningCount === 1 ? "" : "s"}</span>
        ) : null}
        <span>{review.summary.textCount} text note{review.summary.textCount === 1 ? "" : "s"}</span>
        {review.sheetSize ? <span>Sheet size {review.sheetSize}</span> : null}
      </div>
      <div className="esco-fbd-review__boundary">{review.boundary}</div>
      {review.warnings.length ? (
        <ul className="esco-fbd-review__warnings">
          {review.warnings.slice(0, 5).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
          {review.warnings.length > 5 ? <li>{review.warnings.length - 5} more review warning(s).</li> : null}
        </ul>
      ) : null}
      {review.diagnostics.length ? (
        <div className="esco-fbd-review__diagnostics" aria-label="Function Block Diagram semantic diagnostics">
          <strong>Semantic review diagnostics</strong>
          <ul className="esco-fbd-review__warnings">
            {review.diagnostics.slice(0, 8).map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.subject ?? index}`}>
                {diagnostic.severity}: {diagnostic.message}
              </li>
            ))}
            {review.diagnostics.length > 8 ? <li>{review.diagnostics.length - 8} more semantic diagnostic(s).</li> : null}
          </ul>
        </div>
      ) : null}
      {visibleSheets.length === 0 ? (
        <p className="esco-empty">No FBD sheet items match the current search.</p>
      ) : (
        visibleSheets.map(({ sheet, blocks, parameters, inputRefs, outputRefs, wires, textBoxes, unknownElements }) => (
          <section className="esco-fbd-sheet" key={`${sheet.number ?? "sheet"}-${sheet.name ?? ""}`}>
            <header className="esco-fbd-sheet__head">
              <strong>Sheet {sheet.number ?? "-"}</strong>
              {sheet.name ? <span>{sheet.name}</span> : null}
              {compactAttributes(sheet.attributes) ? <code>{compactAttributes(sheet.attributes)}</code> : null}
            </header>
            <div className="esco-fbd-sheet__grid">
              <div className="esco-fbd-sheet__panel">
                <h2>Blocks</h2>
                <table className="esco-fbd-table">
                  <thead>
                    <tr><th>Type</th><th>Operand</th><th>Position</th><th>ID</th><th>Attributes</th></tr>
                  </thead>
                  <tbody>
                    {blocks.length ? blocks.map((block, index) => (
                      <tr key={`${block.id ?? block.type}-${index}`}>
                        <td><strong>{block.type}</strong></td>
                        <td>{block.operand ?? "-"}</td>
                        <td>{fbdPosition(block.x, block.y)}</td>
                        <td>{block.id ?? "-"}</td>
                        <td><code>{compactAttributes(block.attributes) || "-"}</code></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5}>No blocks on this sheet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="esco-fbd-sheet__panel">
                <h2>Block Parameters</h2>
                <table className="esco-fbd-table">
                  <thead>
                    <tr><th>Block</th><th>Direction</th><th>Name</th><th>Value</th><th>Position</th><th>ID</th><th>Attributes</th></tr>
                  </thead>
                  <tbody>
                    {parameters.length ? parameters.map(({ block, parameter }, index) => {
                      const direction = fbdParameterDirectionLabel(parameter.direction);
                      const name = parameter.name ?? "?";
                      return (
                        <tr key={`${block.id ?? block.type}-${parameter.id ?? parameter.name ?? index}`}>
                          <td>{block.type}{block.id ? ` #${block.id}` : ""}</td>
                          <td>{direction}</td>
                          <td>{name}</td>
                          <td>{parameter.value ?? "-"}</td>
                          <td>{fbdPosition(parameter.x, parameter.y)}</td>
                          <td>{parameter.id ?? "-"}</td>
                          <td><code>{compactAttributes(parameter.attributes) || "-"}</code></td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={7}>No block parameters on this sheet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="esco-fbd-sheet__panel">
                <h2>References</h2>
                <table className="esco-fbd-table">
                  <thead>
                    <tr><th>Kind</th><th>Operand</th><th>Position</th><th>ID</th><th>Attributes</th></tr>
                  </thead>
                  <tbody>
                    {[...inputRefs.map((ref) => ({ ...ref, kind: "Input" })), ...outputRefs.map((ref) => ({ ...ref, kind: "Output" }))].length ? (
                      [...inputRefs.map((ref) => ({ ...ref, kind: "Input" })), ...outputRefs.map((ref) => ({ ...ref, kind: "Output" }))].map((ref, index) => (
                        <tr key={`${ref.kind}-${ref.id ?? ref.operand ?? index}`}>
                          <td>{ref.kind}</td>
                          <td>{ref.operand ?? "-"}</td>
                          <td>{fbdPosition(ref.x, ref.y)}</td>
                          <td>{ref.id ?? "-"}</td>
                          <td><code>{compactAttributes(ref.attributes) || "-"}</code></td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={5}>No input/output references on this sheet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="esco-fbd-sheet__panel">
                <h2>Wires</h2>
                <table className="esco-fbd-table">
                  <thead>
                    <tr><th>From</th><th>To</th><th>ID</th><th>Attributes</th></tr>
                  </thead>
                  <tbody>
                    {wires.length ? wires.map((wire, index) => (
                      <tr key={`${wire.id ?? "wire"}-${index}`}>
                        <td>{wire.fromOperand ?? wire.fromId ?? "-"}</td>
                        <td>{wire.toOperand ?? wire.toId ?? "-"}</td>
                        <td>{wire.id ?? "-"}</td>
                        <td><code>{compactAttributes(wire.attributes) || "-"}</code></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4}>No wires on this sheet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="esco-fbd-sheet__panel">
                <h2>Text / Unknown</h2>
                {textBoxes.length || unknownElements.length ? (
                  <ul className="esco-fbd-list">
                    {textBoxes.map((textBox, index) => (
                      <li key={`${textBox.id ?? "text"}-${index}`}>
                        <strong>Text</strong>
                        <span>{textBox.text || "-"}</span>
                        <code>{compactAttributes(textBox.attributes)}</code>
                      </li>
                    ))}
                    {unknownElements.map((element, index) => (
                      <li key={`${element.name}-${index}`}>
                        <strong>{element.name}</strong>
                        <span>Preserved unknown FBD element.</span>
                        <code>{compactAttributes(element.attributes)}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="esco-empty">No text or unknown elements on this sheet.</p>
                )}
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function NonLadderRoutineView({
  routine,
  onSetStructuredTextSource,
  editLocked = false,
}: {
  routine: Routine;
  onSetStructuredTextSource: (routineId: string, source: string) => void;
  editLocked?: boolean;
}) {
  const [query, setQuery] = useState("");
  const source = routineText(routine);
  const [draftSource, setDraftSource] = useState(source);
  const editable = routine.language === "structured-text";
  const lines = source ? source.split(/\r?\n/) : [];
  const draftLines = draftSource ? draftSource.split(/\r?\n/).length : 0;
  const dirty = editable && draftSource !== source;
  const canEditSource = editable && !editLocked;
  const stAnalysis = useMemo(
    () => (editable ? analyzeStructuredText(draftSource) : undefined),
    [draftSource, editable],
  );
  const stFindings = stAnalysis?.findings ?? [];
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
              ? "Structured Text source is editable, exports with the project, and runs a conservative Offline Simulation subset for assignments, branches, loops, CASE, JSR/SBR/RET, and positional/named registered instruction calls."
              : `${LANGUAGE_LABEL[routine.language]} imported routine is preserved read-only for review. It is not executed by Offline Simulation.`}
          </p>
        </div>
        <div className="esco-nonladder__badges">
          <span className="esco-detail__readonly">{editable ? (editLocked ? "Read-only while scanning" : "Editable ST") : "Read-only"}</span>
          <span className="esco-detail__readonly">
            {editable ? draftLines : lines.length} line{(editable ? draftLines : lines.length) === 1 ? "" : "s"}
          </span>
          {editable ? (
            <span className={`esco-detail__readonly${stFindings.length ? " esco-detail__readonly--warning" : ""}`}>
              {stFindings.length ? `${stFindings.length} ST warning${stFindings.length === 1 ? "" : "s"}` : "ST syntax OK"}
            </span>
          ) : null}
          {dirty ? <span className="esco-detail__readonly">Unsaved ST edit</span> : null}
          {!editable && term ? <span className="esco-detail__readonly">{visible.length} match{visible.length === 1 ? "" : "es"}</span> : null}
        </div>
      </header>
      <div className="esco-nonladder__toolbar">
        {editable ? (
          <span className="esco-nonladder__hint">
            {editLocked
              ? "ESCO Virtual Controller is scanning; switch to Program mode or go Offline before editing Structured Text."
              : "Apply saves through project-actions; simulation continues to skip ST routines."}
          </span>
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
              disabled={!dirty || editLocked}
              onClick={() => onSetStructuredTextSource(routine.id, draftSource)}
            >
              Apply ST
            </button>
          </>
        ) : null}
      </div>
      {editable ? (
        <div className={`esco-st-analysis${stFindings.length ? " has-warning" : " is-ok"}`} role="status" aria-live="polite">
          <strong>{stFindings.length ? "Structured Text structural warnings" : "Structured Text structural check passed"}</strong>
          {stFindings.length ? (
            <ul>
              {stFindings.slice(0, 5).map((finding, index) => (
                <li key={`${finding.line ?? "unknown"}-${index}`}>
                  {finding.line ? `Line ${finding.line}: ` : ""}
                  {finding.message}
                </li>
              ))}
              {stFindings.length > 5 ? <li>{stFindings.length - 5} more warning(s).</li> : null}
            </ul>
          ) : (
            <span>No unmatched blocks, parentheses, brackets, comments, or strings detected.</span>
          )}
        </div>
      ) : null}
      {editable ? (
        <textarea
          className="esco-st-editor"
          value={draftSource}
          spellCheck={false}
          aria-label={`${routine.name} Structured Text source`}
          placeholder="Enter Structured Text source..."
          readOnly={!canEditSource}
          onChange={(event) => setDraftSource(event.target.value)}
        />
      ) : source ? (
        routine.language === "function-block" ? (
          <FbdRoutineReview source={source} query={query} />
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
  const typeMembers = new Map<string, SuggestionMember[]>();
  for (const controller of project.controllers) {
    for (const udt of controller.dataTypes) {
      typeMembers.set(
        udt.name,
        udt.members.map((member) => ({
          name: member.name,
          ...(member.dimension && member.dimension > 0 ? { dimension: member.dimension } : {}),
          ...(member.dimensions?.length ? { dimensions: member.dimensions } : {}),
        })),
      );
    }
    for (const aoi of controller.addOnInstructions) {
      typeMembers.set(aoi.name, [
        ...aoi.parameters.map((parameter) => ({ name: parameter.name })),
        ...aoi.localTags.map((localTag) => ({
          name: localTag.name,
          ...(localTag.dimension && localTag.dimension > 0 ? { dimension: localTag.dimension } : {}),
          ...(localTag.dimensions?.length ? { dimensions: localTag.dimensions } : {}),
        })),
      ]);
    }
  }
  const tags = project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);

  for (const tag of tags) {
    suggestions.add(tag.name);
    const tagDimensions = arrayDimensionsOf(tag);
    if (tagDimensions.length > 0 && !isStructuredType(tag.dataType)) {
      const capped = tagDimensions.map((dimension) => Math.min(dimension, 8));
      for (const element of arrayElementNames(tag.name, capped).slice(0, 32)) suggestions.add(element);
    }
    const members: SuggestionMember[] = isStructuredType(tag.dataType)
      ? memberDefs(tag.dataType).map((member) => ({ name: member.name }))
      : typeMembers.get(tag.dataType) ?? [];
    for (const member of members) {
      suggestions.add(`${tag.name}.${member.name}`);
      const memberDimensions = arrayDimensionsOf(member);
      if (memberDimensions.length > 0) {
        const capped = memberDimensions.map((dimension) => Math.min(dimension, 8));
        for (const element of arrayElementNames(`${tag.name}.${member.name}`, capped).slice(0, 32)) {
          suggestions.add(element);
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

/**
 * Resolve an operand value to its project tag metadata (description, data type,
 * engineering units). Handles plain tags as well as member / array-element
 * operands by matching the operand suffix against the tag's per-element comments
 * and engineering units, exactly as Logix authors them in `<Comments>` /
 * `<EngineeringUnits>`.
 */
function operandMetadata(project: PlcProject, value: string): OperandMetadata | undefined {
  const trimmed = value.trim();
  const base = baseTagName(trimmed);
  if (!base) return undefined;
  const tag = getTags(project).find((candidate) => candidate.name === base);
  if (!tag) return undefined;
  const suffix = trimmed.slice(base.length);
  const norm = (operand: string) => operand.trim().toLowerCase();
  const key = norm(suffix);
  const description =
    tag.comments?.find((comment) => norm(comment.operand) === key)?.text ??
    (suffix ? undefined : tag.description) ??
    tag.description;
  const units =
    tag.engineeringUnits?.find((unit) => norm(unit.operand) === key)?.text ??
    tag.engineeringUnits?.find((unit) => !unit.operand.trim())?.text;
  return { description, dataType: tag.dataType, units };
}

interface BranchOutlineRow {
  id: string;
  depth: number;
  label: string;
  detail: string;
}

/** Flatten a rung's branch tree into indented rows for the branch-structure inspector. */
function branchOutline(branch: LadderBranch, depth = 0, path = "root"): BranchOutlineRow[] {
  const rows: BranchOutlineRow[] = [];
  const seriesText = branch.nodes
    .map((node) => `${node.instructionType}(${node.operands.map((operand) => operand.value).join(", ")})`)
    .join("  →  ");
  rows.push({
    id: `${path}-seg`,
    depth,
    label: branch.nodes.length ? "Series" : "Empty segment",
    detail: seriesText || "(no instructions)",
  });
  if (branch.parallelBranches?.length) {
    rows.push({ id: `${path}-par`, depth, label: "Parallel group", detail: `${branch.parallelBranches.length} leg(s)` });
    branch.parallelBranches.forEach((leg, index) => {
      rows.push(...branchOutline(leg, depth + 1, `${path}-leg${index}`));
    });
  }
  if (branch.next) {
    rows.push(...branchOutline(branch.next, depth, `${path}-next`));
  }
  return rows;
}

function findBranchById(branch: LadderBranch, branchId: string): LadderBranch | undefined {
  if (branch.id === branchId) return branch;
  for (const leg of branch.parallelBranches ?? []) {
    const found = findBranchById(leg, branchId);
    if (found) return found;
  }
  return branch.next ? findBranchById(branch.next, branchId) : undefined;
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The ordered series segment containing `nodeId`, anywhere in the branch tree. */
function seriesSiblingsOf(branch: LadderBranch, nodeId: string): LadderNode[] | undefined {
  if (branch.nodes.some((node) => node.id === nodeId)) return branch.nodes;
  for (const leg of branch.parallelBranches ?? []) {
    const found = seriesSiblingsOf(leg, nodeId);
    if (found) return found;
  }
  return branch.next ? seriesSiblingsOf(branch.next, nodeId) : undefined;
}

function findingMatchesRung(finding: ValidationFinding, rung: LadderRung): boolean {
  // An explicit "Rung <number>" reference (e.g. ladder-structure findings)
  // attributes straight to that rung within the already routine-scoped set —
  // this also surfaces structural findings (empty parallel leg) that quote no tag.
  if (new RegExp(`\\bRung ${rung.number}\\b`).test(finding.message)) return true;
  const text = rungText(rung);
  const quoted = [...finding.message.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return quoted.length > 0 ? quoted.some((part) => part && text.includes(part)) : false;
}

function isLadderRoutine(value: unknown): value is LadderRoutine {
  return !!value && typeof value === "object" && Array.isArray((value as { rungs?: unknown }).rungs);
}

function aoiHasExecutableRll(aoi: AddOnInstruction): boolean {
  if (aoi.protected) return false;
  return (aoi.routines ?? []).some((routine) => isLadderRoutine(routine.ladder));
}

function routineHasPendingTestEdits(project: PlcProject, routineId?: string): boolean {
  if (!routineId) return false;
  return project.controllers.some((controller) =>
    controller.programs.some((program) =>
      program.testEdits === true && program.routines.some((candidate) => candidate.id === routineId),
    ),
  );
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
  onCutRung,
  onPasteRung,
  canPaste,
  onDuplicateRung,
  onInsertRung,
  onPasteRungRelative,
  onAddBranchLeg,
  onRemoveBranchLeg,
  onVerifyRung,
  onCrossReferenceRung,
  onInsertInstruction,
  onUnforceTag,
  onSetRungComment,
  onEditOperand,
  onRemoveInstruction,
  onMoveInstruction,
  onPickInstructionForBranch,
  onCreateTagFromOperand,
  onAddLadderElement,
  onSelectRung,
  onSelectNode,
  onAddParallelBranch,
  onSetStructuredTextSource,
  onEditTagProperties,
  onWatchTag,
  onCrossReferenceTag,
  onForceTag,
  onToggleBit,
  onTrendTag,
  onInstructionHelp,
  onOpenRoutine,
  onCloseRoutine,
  onControllerAction,
  editState = "none",
  editLocked = false,
}: Props) {
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuReturnFocusRef = useRef<ContextMenuReturnFocus | null>(null);
  const [virtualMetrics, setVirtualMetrics] = useState({ scrollTop: 0, viewportHeight: 720 });
  const [contextMenu, setContextMenu] = useState<LadderContextMenu | null>(null);
  const [routineCommand, setRoutineCommand] = useState<RoutineCommand | null>(null);
  const [lastFindTerm, setLastFindTerm] = useState("");
  const [operandDisplay, setOperandDisplay] = useState({ tagDescriptions: false, operandMeta: false });
  const [rungInspector, setRungInspector] = useState<"branch" | "source" | null>(null);
  const suggestions = useMemo(() => operandSuggestions(project), [project]);
  // Base tag names known to the project (controller- and program-scoped). The
  // ladder flags an operand as undefined only when its base tag isn't in here,
  // so a freshly-created program tag clears the diagnostic immediately.
  const knownTagNames = useMemo(() => new Set(getTags(project).map((tag) => tag.name)), [project]);
  const displayOptions = useMemo<LadderDisplayOptions>(
    () => ({
      tagDescriptions: operandDisplay.tagDescriptions,
      operandMeta: operandDisplay.operandMeta,
      lookup: (value: string) => operandMetadata(project, value),
    }),
    [operandDisplay, project],
  );
  const importedRoutinePendingTestEdits = useMemo(
    () => routineHasPendingTestEdits(project, routine?.id),
    [project, routine?.id],
  );
  const routinePendingTestEdits = editState === "test" || editState === "assembled" || (editState === "none" && importedRoutinePendingTestEdits);
  const effectiveEditState: OfflineEditLifecycleState =
    editState === "none" && importedRoutinePendingTestEdits ? "test" : editState;
  const routineCommandRoutineId = activeRoutineId ?? routine?.id;
  useEffect(() => {
    setRoutineCommand(null);
    setContextMenu(null);
  }, [routineCommandRoutineId]);
  const knownInstructionTypes = useMemo(
    () => new Set(project.controllers.flatMap((controller) =>
      controller.addOnInstructions.map((aoi) => aoi.name.toUpperCase()),
    )),
    [project],
  );
  const modelOnlyInstructionTypes = useMemo(
    () => new Set(project.controllers.flatMap((controller) =>
      controller.addOnInstructions
        .filter((aoi) => !aoiHasExecutableRll(aoi))
        .map((aoi) => aoi.name.toUpperCase()),
    )),
    [project],
  );
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
  const scrollToRungIndex = (index: number) => {
    const surface = editorSurfaceRef.current;
    if (!surface) return;
    const nextScrollTop = Math.max(0, index * VIRTUAL_RUNG_HEIGHT);
    surface.scrollTop = nextScrollTop;
    setVirtualMetrics((current) => ({
      scrollTop: nextScrollTop,
      viewportHeight: surface.clientHeight || current.viewportHeight || 720,
    }));
  };
  const selectRungAtIndex = (index: number) => {
    const rung = ladder?.rungs[index];
    if (!rung) return;
    onSelectRung(rung.id);
    scrollToRungIndex(index);
  };
  const handleFindInRoutine = () => {
    if (!ladder) return;
    setRoutineCommand({ kind: "find", value: lastFindTerm });
  };
  const applyFindInRoutine = (command: Extract<RoutineCommand, { kind: "find" }>) => {
    if (!ladder) return;
    const term = command.value.trim().toLowerCase();
    if (!term) {
      setRoutineCommand({ ...command, message: "Enter text to search this routine." });
      return;
    }
    const startIndex = Math.max(0, ladder.rungs.findIndex((rung) => rung.id === selectedRungId));
    const ordered = [...ladder.rungs.slice(startIndex + 1), ...ladder.rungs.slice(0, startIndex + 1)];
    const found = ordered.find((rung) => rungText(rung).toLowerCase().includes(term));
    if (!found) {
      setRoutineCommand({ ...command, message: `No rung match found for "${command.value}".` });
      return;
    }
    setLastFindTerm(command.value);
    selectRungAtIndex(ladder.rungs.findIndex((rung) => rung.id === found.id));
    setRoutineCommand(null);
  };
  const handleGoToRung = () => {
    if (!ladder) return;
    const current = ladder.rungs.find((rung) => rung.id === selectedRungId)?.number ?? ladder.rungs[0]?.number ?? 0;
    setRoutineCommand({ kind: "goto", value: String(current) });
  };
  const applyGoToRung = (command: Extract<RoutineCommand, { kind: "goto" }>) => {
    if (!ladder) return;
    const requested = Number(command.value.trim());
    if (!Number.isFinite(requested)) {
      setRoutineCommand({ ...command, message: "Enter a valid rung number." });
      return;
    }
    const index = ladder.rungs.findIndex((rung) => rung.number === requested);
    if (index < 0) {
      setRoutineCommand({ ...command, message: `Rung ${command.value.trim()} was not found.` });
      return;
    }
    selectRungAtIndex(index);
    setRoutineCommand(null);
  };
  const applyRoutineCommand = () => {
    if (!routineCommand) return;
    if (routineCommand.kind === "find") {
      applyFindInRoutine(routineCommand);
      return;
    }
    if (routineCommand.kind === "goto") {
      applyGoToRung(routineCommand);
      return;
    }
    if (routineCommand.kind === "operand") {
      if (editLocked) {
        setRoutineCommand({ ...routineCommand, message: "Read-only while the ESCO Virtual Controller is scanning." });
        return;
      }
      onEditOperand(
        routineCommand.rungId,
        routineCommand.nodeId,
        routineCommand.operandIndex,
        routineCommand.value,
        routineCommand.routineId,
      );
      setRoutineCommand(null);
      return;
    }
    if (editLocked) {
      setRoutineCommand({ ...routineCommand, message: "Read-only while the ESCO Virtual Controller is scanning." });
      return;
    }
    onSetRungComment(routineCommand.rungId, routineCommand.value, routineCommand.routineId);
    setRoutineCommand(null);
  };
  const handleArrowNavigateNode = (rungId: string, nodeId: string, direction: "prev" | "next") => {
    const rung = ladder?.rungs.find((candidate) => candidate.id === rungId);
    if (!rung) return;
    const siblings = seriesSiblingsOf(rung.root, nodeId);
    if (!siblings) return;
    const index = siblings.findIndex((node) => node.id === nodeId);
    const neighbor = direction === "prev" ? siblings[index - 1] : siblings[index + 1];
    if (!neighbor) return;
    onSelectNode(rungId, neighbor.id);
    // The neighbour is already in the DOM (only its selected class changes), so
    // focus follows immediately to keep arrow navigation flowing.
    editorSurfaceRef.current
      ?.querySelector<HTMLElement>(`[data-node-id="${neighbor.id}"]`)
      ?.focus();
  };
  const editing = {
    onEditOperand,
    onRemoveInstruction,
    onMoveInstruction,
    onArrowNavigate: handleArrowNavigateNode,
    onPickInstructionForBranch,
    onRemoveBranchLeg,
    onSelectNode,
    selectedNodeId,
    operandSuggestions: suggestions,
    knownInstructionTypes,
    modelOnlyInstructionTypes,
    display: displayOptions,
    onOpenInstructionMenu: (
      request: { clientX: number; clientY: number; focusTarget?: HTMLElement | null },
      rungId: string,
      node: LadderNode,
      operandIndex = 0,
      branchId?: string,
    ) => {
      const normalizedOperandIndex =
        operandIndex >= 0 && operandIndex < Math.max(node.operands.length, 1) ? operandIndex : 0;
      contextMenuReturnFocusRef.current = {
        element: request.focusTarget ?? null,
        selector:
          request.focusTarget instanceof HTMLInputElement
            ? `[data-node-id="${cssAttributeValue(node.id)}"] input.esco-lad__operand[data-operand-index="${normalizedOperandIndex}"]`
            : `[data-node-id="${cssAttributeValue(node.id)}"]`,
      };
      setContextMenu({
        kind: "instruction",
        x: request.clientX,
        y: request.clientY,
        rungId,
        nodeId: node.id,
        branchId,
        instructionType: node.instructionType,
        operand: node.operands[normalizedOperandIndex]?.value ?? "",
        operandIndex: normalizedOperandIndex,
      });
    },
    isUndefinedTag: (value: string) => {
      const base = baseTagName(value);
      return base !== "" && !knownTagNames.has(base);
    },
  };

  const closeContextMenu = useCallback((restoreFocus = false) => {
    const restore = contextMenuReturnFocusRef.current;
    const focusTarget = () => {
      const target =
        restore?.element?.isConnected
          ? restore.element
          : restore?.selector
            ? editorSurfaceRef.current?.querySelector<HTMLElement>(restore.selector)
            : null;
      target?.focus({ preventScroll: true });
    };
    setContextMenu(null);
    if (restoreFocus) {
      focusTarget();
      window.setTimeout(focusTarget, 0);
      window.requestAnimationFrame(focusTarget);
      window.setTimeout(focusTarget, 16);
      window.setTimeout(focusTarget, 50);
    }
  }, []);
  const contextMenuRung =
    contextMenu && ladder ? ladder.rungs.find((candidate) => candidate.id === contextMenu.rungId) : undefined;
  const contextMenuBranch =
    contextMenu?.kind === "instruction" && contextMenuRung
      ? findBranchById(contextMenuRung.root, contextMenu.branchId ?? contextMenuRung.root.id)
      : undefined;

  const contextMenuItems = () =>
    Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>(".esco-context-menu__item:not(:disabled)") ?? []);

  const focusContextMenuItem = (index: number) => {
    const items = contextMenuItems();
    if (!items.length) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const handleContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = contextMenuItems();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusContextMenuItem(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusContextMenuItem(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusContextMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusContextMenuItem(items.length - 1);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const id = window.setTimeout(() => {
      const menu = contextMenuRef.current;
      if (!menu) return;
      menu.querySelectorAll<HTMLElement>(".esco-context-menu__item").forEach((item) => {
        item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
      });
      menu.querySelectorAll<HTMLElement>(".esco-context-menu__sep").forEach((separator) => {
        separator.setAttribute("role", "separator");
      });
      contextMenuItems()[0]?.focus();
    }, 0);
    const close = () => closeContextMenu(false);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu(true);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (!routineCommand) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoutineCommand(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routineCommand]);

  useEffect(() => {
    const surface = editorSurfaceRef.current;
    if (!surface) return;
    surface.scrollTop = 0;
    setVirtualMetrics({ scrollTop: 0, viewportHeight: surface.clientHeight || 720 });
  }, [routine?.id]);

  useEffect(() => {
    const surface = editorSurfaceRef.current;
    if (!surface) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      setVirtualMetrics((current) => {
        const next = {
          scrollTop: surface.scrollTop,
          viewportHeight: surface.clientHeight || current.viewportHeight || 720,
        };
        return next.scrollTop === current.scrollTop && next.viewportHeight === current.viewportHeight
          ? current
          : next;
      });
    };
    const scheduleMeasure = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    surface.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      surface.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [routine?.id, ladder?.rungs.length]);

  if (!routine) {
    return (
      <div className="esco-editor">
        <div className="esco-editor__empty" aria-label="No routine window open">
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
          onCloseRoutine={onCloseRoutine}
        />
        <NonLadderRoutineView routine={routine} onSetStructuredTextSource={onSetStructuredTextSource} editLocked={editLocked} />
      </div>
    );
  }

  const rungWindow = virtualWindow(ladder.rungs, {
    scrollTop: virtualMetrics.scrollTop,
    viewportHeight: virtualMetrics.viewportHeight,
    rowHeight: VIRTUAL_RUNG_HEIGHT,
    overscan: VIRTUAL_RUNG_OVERSCAN,
    minimumTotal: LARGE_ROUTINE_LIMIT,
  });

  return (
    <div className="esco-editor">
      <RoutineTabs
        routines={routines}
        activeRoutineId={activeRoutineId}
        fallbackRoutineId={routine.id}
        onOpenRoutine={onOpenRoutine}
        onCloseRoutine={onCloseRoutine}
      />
      <RoutineLocalToolbar
        selectedRungId={selectedRungId}
        canPaste={canPaste && !editLocked}
        editLocked={editLocked}
        display={operandDisplay}
        inspector={rungInspector}
        onToggleTagDescriptions={() =>
          setOperandDisplay((current) => ({ ...current, tagDescriptions: !current.tagDescriptions }))
        }
        onToggleOperandMeta={() =>
          setOperandDisplay((current) => ({ ...current, operandMeta: !current.operandMeta }))
        }
        onPlainOperandMode={() => setOperandDisplay({ tagDescriptions: false, operandMeta: false })}
        onToggleInspector={(mode) => setRungInspector((current) => (current === mode ? null : mode))}
        onAddRung={onAddRung}
        onDeleteRung={onDeleteRung}
        onCopyRung={onCopyRung}
        onCutRung={onCutRung}
        onPasteRung={onPasteRung}
        onDuplicateRung={onDuplicateRung}
        onAddParallelBranch={onAddParallelBranch}
        onFindInRoutine={handleFindInRoutine}
        onGoToRung={handleGoToRung}
      />
      {editLocked ? (
        <div className="esco-editor__edit-lock" role="status">
          ESCO Virtual Controller is scanning. Logic edits are read-only until Program mode or Offline.
        </div>
      ) : null}
      {rungInspector ? (
        <RungInspector
          mode={rungInspector}
          rung={ladder.rungs.find((candidate) => candidate.id === selectedRungId) ?? ladder.rungs[0]}
          onClose={() => setRungInspector(null)}
        />
      ) : null}
      {routineCommand ? (
        <RoutineCommandBar
          command={routineCommand}
          onChange={(value) => setRoutineCommand((current) => (current ? { ...current, value, message: undefined } : current))}
          onApply={applyRoutineCommand}
          onCancel={() => setRoutineCommand(null)}
        />
      ) : null}
      {routinePendingTestEdits ? <RoutineOnlineEditBar editState={effectiveEditState} onControllerAction={onControllerAction} /> : null}
      {rungWindow.active ? (
        <div className="esco-editor__largebanner">
          Virtualized large routine: showing rungs {rungWindow.startIndex + 1}-{rungWindow.endIndex} of {rungWindow.total}.
        </div>
      ) : null}

      <div className="esco-editor__surface" ref={editorSurfaceRef}>
        {ladder.rungs.length === 0 ? (
          <div className="esco-editor__norungs" aria-label="Empty ladder routine">
            <button
              type="button"
              className="esco-lad__rung esco-lad__rung--empty"
              onClick={onAddRung}
              disabled={editLocked}
              aria-label="Add first rung"
              title="Add first rung"
            >
              <div className="esco-lad__rung-head">
                <span className="esco-lad__rung-no">0</span>
              </div>
              <div className="esco-lad__diagram esco-lad__diagram--empty">
                <span className="esco-lad__rail esco-lad__rail--left" />
                <span className="esco-lad__series" aria-hidden="true">
                  <span className="esco-lad__row">
                    <span className="esco-lad__wire" />
                  </span>
                </span>
                <span className="esco-lad__rail esco-lad__rail--right" />
              </div>
            </button>
          </div>
        ) : (
          <>
          {rungWindow.beforePx > 0 ? (
            <div
              className="esco-editor__virtual-spacer"
              style={{ height: `${rungWindow.beforePx}px` }}
              aria-hidden="true"
            />
          ) : null}
          {rungWindow.items.map((rung) => (
            (() => {
              const rungFindings = findingsByRung.get(rung.id) ?? [];
              return (
            <div
              key={rung.id}
              className={`esco-lad__rung${selectedRungId === rung.id ? " is-selected" : ""}${
                rungFindings.length ? " has-finding" : ""
              }${routinePendingTestEdits ? " is-test-edit" : ""}`}
              tabIndex={0}
              aria-label={`Rung ${rung.number}`}
              data-rung-id={rung.id}
              onFocus={(event) => {
                if (event.target === event.currentTarget) onSelectRung(rung.id);
              }}
              onClick={() => onSelectRung(rung.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectRung(rung.id);
                  return;
                }
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  onSelectRung(rung.id);
                  contextMenuReturnFocusRef.current = {
                    element: event.currentTarget,
                    selector: `[data-rung-id="${cssAttributeValue(rung.id)}"]`,
                  };
                  setContextMenu({
                    kind: "rung",
                    x: rect.left + 36,
                    y: rect.top + 24,
                    rungId: rung.id,
                    rungNumber: rung.number,
                  });
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelectRung(rung.id);
                contextMenuReturnFocusRef.current = {
                  element: event.currentTarget,
                  selector: `[data-rung-id="${cssAttributeValue(rung.id)}"]`,
                };
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
                {routinePendingTestEdits ? <span className="esco-lad__edit-marker" title="Pending test edit">e</span> : null}
                {rungFindings.length > 0 ? (
                  <span
                    className={`esco-lad__finding esco-lad__finding--${rungFindings.some((finding) => finding.severity === "error") ? "error" : "warning"}`}
                    title={rungFindings.map((finding) => finding.message).join("\n")}
                  >
                    {rungFindings.length}
                  </span>
                ) : null}
              </div>
              <RungDiagram rung={rung} editing={editing} />
            </div>
              );
            })()
          ))}
          {rungWindow.afterPx > 0 ? (
            <div
              className="esco-editor__virtual-spacer"
              style={{ height: `${rungWindow.afterPx}px` }}
              aria-hidden="true"
            />
          ) : null}
          </>
        )}

      </div>
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="esco-context-menu"
          role="menu"
          aria-label={
            contextMenu.kind === "instruction"
              ? `${contextMenu.instructionType} ${contextMenu.operand}`.trim()
              : `Rung ${String(contextMenu.rungNumber).padStart(3, "0")}`
          }
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleContextMenuKeyDown}
        >
          {contextMenu.kind === "instruction" ? (
            (() => {
              const tagName = baseTagName(contextMenu.operand);
              const hasOperandTag = tagName !== "" && knownTagNames.has(tagName);
              return (
            <>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  setRoutineCommand({
                    kind: "operand",
                    routineId: routineCommandRoutineId ?? "",
                    rungId: contextMenu.rungId,
                    nodeId: contextMenu.nodeId,
                    instructionType: contextMenu.instructionType,
                    operandIndex: contextMenu.operandIndex,
                    value: contextMenu.operand,
                  });
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Edit Operand...
              </button>
              {tagName !== "" && !hasOperandTag && onCreateTagFromOperand ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onCreateTagFromOperand(contextMenu.instructionType, tagName, contextMenu.operandIndex);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Create Tag “{tagName}”...
                </button>
              ) : null}
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  onAddParallelBranch(contextMenu.rungId, contextMenu.branchId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Add Parallel Branch
              </button>
              {onAddBranchLeg ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked || !(contextMenuBranch?.parallelBranches?.length)}
                  onClick={() => {
                    onAddBranchLeg(contextMenu.rungId, contextMenu.branchId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Add Branch Leg
                </button>
              ) : null}
              {onInsertInstruction ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onInsertInstruction(contextMenu.rungId, contextMenu.nodeId, "before");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Insert Instruction Before...
                </button>
              ) : null}
              {onInsertInstruction ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onInsertInstruction(contextMenu.rungId, contextMenu.nodeId, "after");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Insert Instruction After...
                </button>
              ) : null}
              {onAddLadderElement ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onAddLadderElement(contextMenu.rungId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Add Ladder Element...
                </button>
              ) : null}
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked || !hasOperandTag || !onEditTagProperties}
                onClick={() => {
                  onEditTagProperties?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Edit Tag Properties...
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onWatchTag}
                onClick={() => {
                  onWatchTag?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Watch Tag
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onToggleBit}
                onClick={() => {
                  onToggleBit?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Toggle Bit
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onTrendTag}
                onClick={() => {
                  onTrendTag?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Trend
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onCrossReferenceTag}
                onClick={() => {
                  onCrossReferenceTag?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Cross Reference
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onForceTag}
                onClick={() => {
                  onForceTag?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Force Value
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!hasOperandTag || !onUnforceTag}
                onClick={() => {
                  onUnforceTag?.(tagName);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Unforce
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!onInstructionHelp}
                onClick={() => {
                  onInstructionHelp?.(contextMenu.instructionType, contextMenu.operand);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Instruction Help
              </button>
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item esco-context-menu__item--danger"
                disabled={editLocked}
                onClick={() => {
                  onRemoveInstruction(contextMenu.rungId, contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Delete Instruction
              </button>
            </>
              );
            })()
          ) : (
            <>
              {!onInsertRung ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onAddRung();
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Add Rung
                </button>
              ) : null}
              {onInsertRung ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onInsertRung(contextMenu.rungId, "above");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Insert Rung Above
                </button>
              ) : null}
              {onInsertRung ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onInsertRung(contextMenu.rungId, "below");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Insert Rung Below
                </button>
              ) : null}
              {onAddLadderElement ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={editLocked}
                  onClick={() => {
                    onAddLadderElement(contextMenu.rungId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Add Ladder Element...
                </button>
              ) : null}
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  const rung = ladder?.rungs.find((candidate) => candidate.id === contextMenu.rungId);
                  setRoutineCommand({
                    kind: "comment",
                    routineId: routineCommandRoutineId ?? "",
                    rungId: contextMenu.rungId,
                    rungNumber: contextMenu.rungNumber,
                    value: rung?.comment ?? "",
                  });
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Edit Rung Comment...
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  onDuplicateRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Duplicate Rung
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                onClick={() => {
                  onCopyRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Copy Rung
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  onCutRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Cut Rung
              </button>
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={!canPaste || editLocked}
                onClick={() => {
                  onPasteRung();
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Paste Rung
              </button>
              {onPasteRungRelative ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={!canPaste || editLocked}
                  onClick={() => {
                    onPasteRungRelative(contextMenu.rungId, "above");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Paste Rung Above
                </button>
              ) : null}
              {onPasteRungRelative ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={!canPaste || editLocked}
                  onClick={() => {
                    onPasteRungRelative(contextMenu.rungId, "below");
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Paste Rung Below
                </button>
              ) : null}
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item"
                disabled={editLocked}
                onClick={() => {
                  onAddParallelBranch(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Add Parallel Branch
              </button>
              {onAddBranchLeg ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  disabled={
                    editLocked ||
                    !(ladder?.rungs.find((candidate) => candidate.id === contextMenu.rungId)?.root.parallelBranches?.length)
                  }
                  onClick={() => {
                    onAddBranchLeg(contextMenu.rungId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Add Branch Leg
                </button>
              ) : null}
              {onVerifyRung ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  onClick={() => {
                    onVerifyRung(contextMenu.rungId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Verify Rung
                </button>
              ) : null}
              {onCrossReferenceRung ? (
                <button
                  type="button"
                  className="esco-context-menu__item"
                  onClick={() => {
                    onCrossReferenceRung(contextMenu.rungId);
                    setContextMenu(null);
                  }}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  Cross Reference Rung
                </button>
              ) : null}
              <div className="esco-context-menu__sep" />
              {ONLINE_EDIT_COMMANDS.map((command) => (
                <button
                  key={command.action}
                  type="button"
                  className="esco-context-menu__item"
                  disabled={!onControllerAction}
                  onClick={() => {
                    onControllerAction?.(command.action);
                    setContextMenu(null);
                  }}
                  title={ONLINE_EDIT_GUARD}
                >
                  <span className="esco-context-menu__icon" aria-hidden="true" />
                  {command.label}
                </button>
              ))}
              <div className="esco-context-menu__sep" />
              <button
                type="button"
                className="esco-context-menu__item esco-context-menu__item--danger"
                disabled={editLocked}
                onClick={() => {
                  onDeleteRung(contextMenu.rungId);
                  setContextMenu(null);
                }}
              >
                <span className="esco-context-menu__icon" aria-hidden="true" />
                Delete Rung
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
