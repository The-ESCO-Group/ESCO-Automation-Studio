import { createContext, useContext } from "react";
import { createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";

// One shared registry drives how each instruction is drawn — the UI never
// hardcodes instruction knowledge.
const registry = createDefaultRegistry();

export interface LadderEditingHandlers {
  onEditOperand: (rungId: string, nodeId: string, index: number, value: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  isUndefinedTag: (name: string) => boolean;
}

interface EditingContextValue extends LadderEditingHandlers {
  rungId: string;
}

const EditingContext = createContext<EditingContextValue | null>(null);

function operandText(node: LadderNode, index: number): string {
  return node.operands[index]?.value ?? "";
}

/** An editable operand field; red when it names a tag that doesn't exist. */
function OperandInput({
  editing,
  nodeId,
  index,
  value,
  placeholder,
}: {
  editing: EditingContextValue;
  nodeId: string;
  index: number;
  value: string;
  placeholder: string;
}) {
  const undefinedTag =
    value.length > 0 && !isNumericLiteral(value) && editing.isUndefinedTag(value);
  return (
    <input
      className={`esco-lad__operand${undefinedTag ? " is-undefined" : ""}`}
      value={value}
      placeholder={placeholder}
      size={Math.max(value.length, placeholder.length)}
      spellCheck={false}
      onChange={(event) =>
        editing.onEditOperand(editing.rungId, nodeId, index, event.target.value)
      }
    />
  );
}

function RemoveButton({ editing, nodeId }: { editing: EditingContextValue; nodeId: string }) {
  return (
    <button
      type="button"
      className="esco-lad__remove"
      title="Remove instruction"
      onClick={() => editing.onRemoveInstruction(editing.rungId, nodeId)}
    >
      ×
    </button>
  );
}

/** XIC / XIO / OTE — a single-operand contact or coil. */
function ContactGlyph({ node }: { node: LadderNode }) {
  const editing = useContext(EditingContext);
  const def = registry.get(node.instructionType);
  const coil = def?.render.style === "coil";
  const open = def?.render.symbol.includes("/");
  const [lhs, rhs] = coil ? ["(", ")"] : open ? ["[/", "]"] : ["[", "]"];
  const kind = coil ? "coil" : open ? "contact-open" : "contact-closed";
  const value = operandText(node, 0);

  if (!editing) {
    return <span className={`esco-lad__node esco-lad__node--${kind}`}>{`${lhs} ${value} ${rhs}`}</span>;
  }
  return (
    <span className={`esco-lad__node esco-lad__node--${kind}`} title={node.instructionType}>
      <span className="esco-lad__bracket">{lhs}</span>
      <OperandInput editing={editing} nodeId={node.id} index={0} value={value} placeholder="tag" />
      <span className="esco-lad__bracket">{rhs}</span>
      <RemoveButton editing={editing} nodeId={node.id} />
    </span>
  );
}

/** TON / CTU / MOV / EQU / GRT / LES — a multi-operand box. */
function BoxGlyph({ node }: { node: LadderNode }) {
  const editing = useContext(EditingContext);
  const def = registry.get(node.instructionType);
  const operandDefs = def?.operands ?? node.operands.map((_, i) => ({ name: `op${i}`, label: `op${i}` }));

  if (!editing) {
    const text = node.operands.map((operand) => operand.value || "?").join(", ");
    return <span className="esco-lad__box esco-lad__box--readonly">{`${node.instructionType}(${text})`}</span>;
  }
  return (
    <span className="esco-lad__box" title={node.instructionType}>
      <span className="esco-lad__box-name">{node.instructionType}</span>
      {operandDefs.map((operandDef, index) => (
        <span className="esco-lad__box-operand" key={operandDef.name}>
          <label className="esco-lad__box-label">{operandDef.label ?? operandDef.name}</label>
          <OperandInput
            editing={editing}
            nodeId={node.id}
            index={index}
            value={operandText(node, index)}
            placeholder={operandDef.name}
          />
        </span>
      ))}
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
function Segment({ branch }: { branch: LadderBranch }) {
  const series = (
    <span className="esco-lad__row">
      {branch.nodes.length > 0 ? (
        branch.nodes.map((node) => <NodeGlyph key={node.id} node={node} />)
      ) : (
        <span className="esco-lad__wire" />
      )}
    </span>
  );

  if (!branch.parallelBranches || branch.parallelBranches.length === 0) {
    return series;
  }

  return (
    <span className="esco-lad__parallel">
      {series}
      {branch.parallelBranches.map((parallel) => (
        <span className="esco-lad__row" key={parallel.id}>
          <BranchView branch={parallel} />
        </span>
      ))}
    </span>
  );
}

/** A branch rendered left-to-right: this segment, then its series continuation. */
function BranchView({ branch }: { branch: LadderBranch }) {
  return (
    <span className="esco-lad__series">
      <Segment branch={branch} />
      {branch.next ? <BranchView branch={branch.next} /> : null}
    </span>
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
    ? { rungId: rung.id, ...editing }
    : null;

  return (
    <EditingContext.Provider value={context}>
      <div className="esco-lad__diagram">
        <span className="esco-lad__rail" />
        <BranchView branch={rung.root} />
        <span className="esco-lad__rail" />
      </div>
    </EditingContext.Provider>
  );
}
