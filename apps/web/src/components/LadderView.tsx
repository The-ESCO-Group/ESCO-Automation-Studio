import {
  createContext,
  useContext,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createDefaultRegistry, isNumericLiteral, type InstructionDefinition } from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";

// One shared registry drives how each instruction is drawn — the UI never
// hardcodes instruction knowledge.
const registry = createDefaultRegistry();
const BOX_TITLE_CATEGORIES = new Set<InstructionDefinition["category"]>([
  "timer",
  "counter",
  "sequencer",
  "file",
  "message",
  "alarm",
  "motion",
  "process",
  "safety",
]);

/** Resolved metadata for one operand value, sourced from the project tag model. */
export interface OperandMetadata {
  description?: string;
  dataType?: string;
  units?: string;
}

/**
 * Optional ladder display toggles, mirroring Studio-style operand display.
 * `tagDescriptions` shows the operand's tag description / comment / engineering
 * units; `operandMeta` shows the operand data type inline. Both resolve through
 * `lookup`, which reads the project tag model.
 */
export interface LadderDisplayOptions {
  tagDescriptions: boolean;
  operandMeta: boolean;
  lookup?: (value: string) => OperandMetadata | undefined;
}

interface InstructionMenuRequest {
  clientX: number;
  clientY: number;
  focusTarget?: HTMLElement | null;
}

export interface LadderEditingHandlers {
  onEditOperand: (rungId: string, nodeId: string, index: number, value: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  /** Reorder an instruction relative to another on the same rung (drag-reorder). */
  onMoveInstruction?: (rungId: string, nodeId: string, targetNodeId: string, position: "before" | "after") => void;
  /** Move selection to the previous/next instruction in the same series (arrow-key nav). */
  onArrowNavigate?: (rungId: string, nodeId: string, direction: "prev" | "next") => void;
  onPickInstructionForBranch?: (rungId: string, branchId: string) => void;
  onRemoveBranchLeg?: (rungId: string, branchId: string) => void;
  isUndefinedTag: (name: string) => boolean;
  operandSuggestions?: string[];
  knownInstructionTypes?: Set<string>;
  modelOnlyInstructionTypes?: Set<string>;
  selectedNodeId?: string;
  display?: LadderDisplayOptions;
  onSelectNode?: (rungId: string, nodeId: string) => void;
  onOpenInstructionMenu?: (
    request: InstructionMenuRequest,
    rungId: string,
    node: LadderNode,
    operandIndex?: number,
    branchId?: string,
  ) => void;
}

interface EditingContextValue extends LadderEditingHandlers {
  rungId: string;
  branchId: string;
}

const EditingContext = createContext<EditingContextValue | null>(null);

function operandText(node: LadderNode, index: number): string {
  return node.operands[index]?.value ?? "";
}

/**
 * Studio-style operand annotation strip rendered under an operand field when the
 * "Tag description display" / "Operand inline display" toolbar toggles are on.
 * Reads resolved metadata from the editing context's display lookup.
 */
function OperandAnnotation({ editing, value }: { editing: EditingContextValue; value: string }) {
  const display = editing.display;
  if (!display || (!display.tagDescriptions && !display.operandMeta)) return null;
  const meta = display.lookup?.(value);
  if (!meta) return null;
  const showDesc = display.tagDescriptions && (meta.description || meta.units);
  const showMeta = display.operandMeta && meta.dataType;
  if (!showDesc && !showMeta) return null;
  return (
    <span className="esco-lad__operand-annotation" aria-hidden="false">
      {showMeta ? (
        <span className="esco-lad__operand-meta" title={`Data type: ${meta.dataType}`}>
          {meta.dataType}
        </span>
      ) : null}
      {showDesc ? (
        <span className="esco-lad__operand-desc" title={meta.description ?? meta.units ?? ""}>
          {meta.description ?? ""}
          {meta.units ? <span className="esco-lad__operand-units"> [{meta.units}]</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** An editable operand field; red when it names a tag that doesn't exist. */
function OperandInput({
  editing,
  node,
  index,
  value,
  placeholder,
}: {
  editing: EditingContextValue;
  node: LadderNode;
  index: number;
  value: string;
  placeholder: string;
}) {
  const undefinedTag =
    value.length > 0 && !isNumericLiteral(value) && editing.isUndefinedTag(value);
  const listId = `operand-suggestions-${editing.rungId}-${node.id}-${index}`;
  return (
    <>
      <input
        className={`esco-lad__operand${undefinedTag ? " is-undefined" : ""}${value ? "" : " is-empty"}`}
        value={value}
        placeholder=""
        aria-label={placeholder}
        title={value || placeholder}
        data-rung-id={editing.rungId}
        data-node-id={node.id}
        data-operand-index={index}
        size={Math.max(value.length, 1)}
        spellCheck={false}
        list={editing.operandSuggestions?.length ? listId : undefined}
        onFocus={(event) => {
          event.stopPropagation();
          editing.onSelectNode?.(editing.rungId, node.id);
        }}
        onChange={(event) =>
          editing.onEditOperand(editing.rungId, node.id, index, event.target.value)
        }
        onKeyDown={(event) => {
          openInstructionMenuFromKeyboard(event, editing, node, index);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          editing.onSelectNode?.(editing.rungId, node.id);
          editing.onOpenInstructionMenu?.(
            { clientX: event.clientX, clientY: event.clientY, focusTarget: event.currentTarget },
            editing.rungId,
            node,
            index,
            editing.branchId,
          );
        }}
      />
      {editing.operandSuggestions?.length ? (
        <datalist id={listId}>
          {editing.operandSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
      <OperandAnnotation editing={editing} value={value} />
    </>
  );
}

function RemoveButton({ editing, nodeId }: { editing: EditingContextValue; nodeId: string }) {
  return (
    <button
      type="button"
      className="esco-lad__remove"
      aria-label="Remove instruction"
      title="Remove instruction"
      onClick={(event) => {
        event.stopPropagation();
        editing.onRemoveInstruction(editing.rungId, nodeId);
      }}
    />
  );
}

function BranchInsertTarget({ branchId, removable }: { branchId: string; removable?: boolean }) {
  const editing = useContext(EditingContext);
  if (!editing?.onPickInstructionForBranch) return <span className="esco-lad__wire" />;
  const label = `Add ladder element to branch leg ${branchId}`;

  return (
    <span className="esco-lad__branch-empty">
      <button
        type="button"
        className="esco-lad__branch-target"
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          editing.onPickInstructionForBranch?.(editing.rungId, branchId);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          editing.onPickInstructionForBranch?.(editing.rungId, branchId);
        }}
      />
      {removable && editing.onRemoveBranchLeg ? (
        <button
          type="button"
          className="esco-lad__branch-remove"
          aria-label={`Remove empty branch leg ${branchId}`}
          title="Remove empty branch leg"
          onClick={(event) => {
            event.stopPropagation();
            editing.onRemoveBranchLeg?.(editing.rungId, branchId);
          }}
        >
          x
        </button>
      ) : null}
    </span>
  );
}

function nodeClass(base: string, editing: EditingContextValue | null, nodeId: string): string {
  return editing && editing.selectedNodeId === nodeId ? `${base} is-selected` : base;
}

const NODE_DRAG_MIME = "application/x-esco-node";

/** A grip that drags an instruction to a new position on the rung. */
function NodeDragHandle({ editing, node }: { editing: EditingContextValue; node: LadderNode }) {
  if (!editing.onMoveInstruction) return null;
  return (
    <span
      className="esco-lad__drag-handle"
      role="button"
      aria-label={`Drag ${node.instructionType} to reorder`}
      title="Drag to reorder (or Alt+←/→)"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(NODE_DRAG_MIME, node.id);
        event.dataTransfer.effectAllowed = "move";
        editing.onSelectNode?.(editing.rungId, node.id);
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** Drop-target props that reorder a dragged instruction before/after this node. */
function nodeDropProps(editing: EditingContextValue, node: LadderNode) {
  if (!editing.onMoveInstruction) return {};
  return {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      const draggedId = event.dataTransfer.getData(NODE_DRAG_MIME);
      if (!draggedId || draggedId === node.id) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      editing.onMoveInstruction?.(editing.rungId, draggedId, node.id, after ? "after" : "before");
    },
  };
}

/** Arrow Left/Right on a focused instruction moves selection along the series. */
function handleNodeArrowKey<T extends HTMLElement>(
  event: ReactKeyboardEvent<T>,
  editing: EditingContextValue,
  node: LadderNode,
): boolean {
  if (!editing.onArrowNavigate) return false;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  // Alt+Arrow is the global reorder accelerator; modified arrows are not nav.
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  event.preventDefault();
  editing.onArrowNavigate(editing.rungId, node.id, event.key === "ArrowLeft" ? "prev" : "next");
  return true;
}

function openInstructionMenuFromKeyboard<T extends HTMLElement>(
  event: ReactKeyboardEvent<T>,
  editing: EditingContextValue,
  node: LadderNode,
  operandIndex = 0,
) {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  editing.onSelectNode?.(editing.rungId, node.id);
  editing.onOpenInstructionMenu?.(
    {
      clientX: rect.left + Math.min(48, rect.width / 2),
      clientY: rect.top + Math.min(34, rect.height / 2),
      focusTarget: event.currentTarget,
    },
    editing.rungId,
    node,
    operandIndex,
    editing.branchId,
  );
  return true;
}

function boxTitleFor(
  node: LadderNode,
  def: InstructionDefinition | undefined,
  operandDefs: { name: string; label?: string }[],
): string {
  const firstValue = node.operands[0]?.value ?? "";
  if (!firstValue || !def || !BOX_TITLE_CATEGORIES.has(def.category)) return "";
  const firstLabel = (operandDefs[0]?.label ?? operandDefs[0]?.name ?? "").toLowerCase();
  if (firstLabel.startsWith("source") || firstLabel === "dest" || firstLabel === "routine") return "";
  return firstValue;
}

function BitInstructionSymbol({ type }: { type: string }) {
  const key = type.toUpperCase();
  const coilMark = key === "OTL" ? "L" : key === "OTU" ? "U" : key === "RES" ? "R" : "";
  const contact = key === "XIC" || key === "XIO";

  return (
    <span className="esco-lad__symbol esco-lad__symbol--studio" aria-hidden="true">
      <svg
        className={`esco-lad__bit-symbol esco-lad__bit-symbol--${key.toLowerCase()}`}
        viewBox="0 0 92 42"
        focusable="false"
      >
        {contact ? (
          <>
            <path d="M0 22 H28 M64 22 H92" />
            <path d="M35 8 V36 M57 8 V36" />
            {key === "XIO" ? <path d="M31 36 L61 8" /> : null}
          </>
        ) : (
          <>
            <path d="M0 21 H25 M67 21 H92" />
            <path d="M37 7 C25 14 25 28 37 35" />
            <path d="M55 7 C67 14 67 28 55 35" />
            {coilMark ? <text x="46" y="24">{coilMark}</text> : null}
          </>
        )}
      </svg>
    </span>
  );
}

/** XIC / XIO / OTE — a single-operand contact or coil. */
function ContactGlyph({ node }: { node: LadderNode }) {
  const editing = useContext(EditingContext);
  const def = registry.get(node.instructionType);
  const coil = def?.render.style === "coil";
  const open = def?.render.symbol.includes("/");
  const kind = coil ? "coil" : open ? "contact-open" : "contact-closed";
  const typeClass = `esco-lad__node--${node.instructionType.toLowerCase()}`;
  const value = operandText(node, 0);

  if (!editing) {
    return (
      <span className={`esco-lad__node esco-lad__node--${kind} ${typeClass}`}>
        <span className="esco-lad__caption">
          <span className="esco-lad__mnemonic">{node.instructionType}</span>
          <span className="esco-lad__operand esco-lad__operand--readonly">{value}</span>
        </span>
        <BitInstructionSymbol type={node.instructionType} />
      </span>
    );
  }
  return (
    <span
      className={nodeClass(`esco-lad__node esco-lad__node--${kind} ${typeClass}`, editing, node.id)}
      title={node.instructionType}
      data-node-id={node.id}
      tabIndex={0}
      role="group"
      aria-label={`${node.instructionType} instruction`}
      {...nodeDropProps(editing, node)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) editing.onSelectNode?.(editing.rungId, node.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        editing.onSelectNode?.(editing.rungId, node.id);
      }}
      onKeyDown={(event) => {
        if (handleNodeArrowKey(event, editing, node)) return;
        if (openInstructionMenuFromKeyboard(event, editing, node)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editing.onSelectNode?.(editing.rungId, node.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        editing.onSelectNode?.(editing.rungId, node.id);
        editing.onOpenInstructionMenu?.(
          { clientX: event.clientX, clientY: event.clientY, focusTarget: event.currentTarget },
          editing.rungId,
          node,
          0,
          editing.branchId,
        );
      }}
    >
      <span className="esco-lad__caption">
        <span className="esco-lad__mnemonic">{node.instructionType}</span>
        <OperandInput editing={editing} node={node} index={0} value={value} placeholder="tag" />
      </span>
      <BitInstructionSymbol type={node.instructionType} />
      <NodeDragHandle editing={editing} node={node} />
      <RemoveButton editing={editing} nodeId={node.id} />
    </span>
  );
}

/** TON / CTU / MOV / EQU / GRT / LES — a multi-operand box. */
function BoxGlyph({ node }: { node: LadderNode }) {
  const editing = useContext(EditingContext);
  const def = registry.get(node.instructionType);
  const dynamicKnown = !def && !!editing?.knownInstructionTypes?.has(node.instructionType.toUpperCase());
  const dynamicModelOnly = !def && !!editing?.modelOnlyInstructionTypes?.has(node.instructionType.toUpperCase());
  const supported = !!def || dynamicKnown || dynamicModelOnly;
  const declaredOperands = def?.operands ?? [];
  const operandDefs = declaredOperands.length
    ? declaredOperands
    : node.operands.map((_, i) => ({ name: `op${i}`, label: `op${i}` }));
  const modelOnly = !!def?.modelOnly || dynamicModelOnly;
  const boxBase = `esco-lad__box${supported ? "" : " esco-lad__box--unsupported"}${
    modelOnly ? " esco-lad__box--model-only" : ""
  }`;
  const title = modelOnly
    ? `${node.instructionType} (model-only / preserved, not simulated)`
    : supported
      ? node.instructionType
      : `${node.instructionType} (unknown unsupported, read-only)`;
  const boxTitle = boxTitleFor(node, def, operandDefs);

  if (!editing) {
    return (
      <span className={`${boxBase} esco-lad__box--readonly`} title={title}>
        {boxTitle ? <span className="esco-lad__box-title">{boxTitle}</span> : null}
        <span className="esco-lad__box-name">{node.instructionType}</span>
        {operandDefs.map((operandDef, index) => (
          <span className="esco-lad__box-operand" key={operandDef.name}>
            <label className="esco-lad__box-label">{operandDef.label ?? operandDef.name}</label>
            <span className="esco-lad__operand esco-lad__operand--readonly">{operandText(node, index) || "?"}</span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span
      className={nodeClass(boxBase, editing, node.id)}
      title={title}
      data-node-id={node.id}
      tabIndex={0}
      role="group"
      aria-label={`${node.instructionType} instruction`}
      {...nodeDropProps(editing, node)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) editing.onSelectNode?.(editing.rungId, node.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        editing.onSelectNode?.(editing.rungId, node.id);
      }}
      onKeyDown={(event) => {
        if (handleNodeArrowKey(event, editing, node)) return;
        if (openInstructionMenuFromKeyboard(event, editing, node)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editing.onSelectNode?.(editing.rungId, node.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        editing.onSelectNode?.(editing.rungId, node.id);
        editing.onOpenInstructionMenu?.(
          { clientX: event.clientX, clientY: event.clientY, focusTarget: event.currentTarget },
          editing.rungId,
          node,
          0,
          editing.branchId,
        );
      }}
    >
      {boxTitle ? <span className="esco-lad__box-title">{boxTitle}</span> : null}
      <span className="esco-lad__box-name">{node.instructionType}</span>
      {operandDefs.map((operandDef, index) => (
        <span className="esco-lad__box-operand" key={operandDef.name}>
          <label className="esco-lad__box-label">{operandDef.label ?? operandDef.name}</label>
          <OperandInput
            editing={editing}
            node={node}
            index={index}
            value={operandText(node, index)}
            placeholder={operandDef.name}
          />
        </span>
      ))}
      <NodeDragHandle editing={editing} node={node} />
      <RemoveButton editing={editing} nodeId={node.id} />
    </span>
  );
}

function NodeGlyph({ node }: { node: LadderNode }) {
  const style = registry.get(node.instructionType)?.render.style;
  if (style === "contact" || style === "coil") {
    return <ContactGlyph node={node} />;
  }
  return <BoxGlyph node={node} />;
}

/** A branch segment: its series nodes, with any parallel paths stacked under it. */
function Segment({ branch, isParallelLeg = false }: { branch: LadderBranch; isParallelLeg?: boolean }) {
  const editing = useContext(EditingContext);
  const scopedEditing = editing ? { ...editing, branchId: branch.id } : null;
  const hasParallel = !!branch.parallelBranches?.length;
  const series = branch.nodes.length > 0 || !hasParallel ? (
    <EditingContext.Provider value={scopedEditing}>
      <span className="esco-lad__row">
        {branch.nodes.length > 0 ? (
          branch.nodes.map((node) => <NodeGlyph key={node.id} node={node} />)
        ) : (
          <BranchInsertTarget branchId={branch.id} removable={isParallelLeg} />
        )}
      </span>
    </EditingContext.Provider>
  ) : null;

  if (!hasParallel) {
    return series;
  }

  return (
    <span className="esco-lad__parallel">
      {series}
      {branch.parallelBranches!.map((parallel) => (
        <span className="esco-lad__row" key={parallel.id}>
          <BranchView branch={parallel} isParallelLeg />
        </span>
      ))}
    </span>
  );
}

/** A branch rendered left-to-right: this segment, then its series continuation. */
function BranchView({ branch, isParallelLeg = false }: { branch: LadderBranch; isParallelLeg?: boolean }) {
  if (branch.nodes.length === 0 && !branch.parallelBranches?.length && branch.next) {
    return <BranchView branch={branch.next} />;
  }

  return (
    <span className="esco-lad__series">
      <Segment branch={branch} isParallelLeg={isParallelLeg} />
      {branch.next ? <BranchView branch={branch.next} /> : null}
    </span>
  );
}

function branchHasInstruction(branch: LadderBranch): boolean {
  return (
    branch.nodes.length > 0 ||
    !!branch.parallelBranches?.some(branchHasInstruction) ||
    (!!branch.next && branchHasInstruction(branch.next))
  );
}

/** Render a single rung's power-flow diagram, optionally editable. */
export function RungDiagram({
  rung,
  editing,
}: {
  rung: LadderRung;
  editing?: LadderEditingHandlers;
}) {
  const context: EditingContextValue | null = editing
    ? { rungId: rung.id, branchId: rung.root.id, ...editing }
    : null;
  const blank = !branchHasInstruction(rung.root);

  return (
    <EditingContext.Provider value={context}>
      <div className={`esco-lad__diagram${blank ? " esco-lad__diagram--blank" : ""}`}>
        {rung.comment ? <span className="esco-lad__rung-comment">{rung.comment}</span> : null}
        <span className="esco-lad__rail esco-lad__rail--left" />
        <BranchView branch={rung.root} />
        <span className="esco-lad__rail esco-lad__rail--right" />
        <span className="esco-lad__rung-cap" aria-hidden="true" />
      </div>
    </EditingContext.Provider>
  );
}
