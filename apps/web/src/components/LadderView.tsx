import { createContext, useContext } from "react";
import { createDefaultRegistry } from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRung } from "@esco/ladder";

// One shared registry drives how each instruction is drawn — the UI never
// hardcodes instruction knowledge.
const registry = createDefaultRegistry();

export interface LadderEditingHandlers {
  onEditOperand: (rungId: string, nodeId: string, value: string) => void;
  onRemoveInstruction: (rungId: string, nodeId: string) => void;
  isUndefinedTag: (name: string) => boolean;
}

interface EditingContextValue extends LadderEditingHandlers {
  rungId: string;
}

const EditingContext = createContext<EditingContextValue | null>(null);

function glyphParts(node: LadderNode): {
  lhs: string;
  rhs: string;
  kind: string;
} {
  const definition = registry.get(node.instructionType);
  if (definition?.render.style === "coil") {
    return { lhs: "(", rhs: ")", kind: "coil" };
  }
  if (definition?.render.symbol.includes("/")) {
    return { lhs: "[/", rhs: "]", kind: "contact-open" };
  }
  return { lhs: "[", rhs: "]", kind: "contact-closed" };
}

function NodeGlyph({ node }: { node: LadderNode }) {
  const editing = useContext(EditingContext);
  const tag = node.operands[0]?.value ?? "";
  const { lhs, rhs, kind } = glyphParts(node);

  if (!editing) {
    return (
      <span className={`esco-lad__node esco-lad__node--${kind}`}>
        {`${lhs} ${tag} ${rhs}`}
      </span>
    );
  }

  const undefinedTag = tag.length > 0 && editing.isUndefinedTag(tag);
  return (
    <span className={`esco-lad__node esco-lad__node--${kind}`} title={node.instructionType}>
      <span className="esco-lad__bracket">{lhs}</span>
      <input
        className={`esco-lad__operand${undefinedTag ? " is-undefined" : ""}`}
        value={tag}
        placeholder="tag"
        size={Math.max(tag.length, 4)}
        spellCheck={false}
        onChange={(event) =>
          editing.onEditOperand(editing.rungId, node.id, event.target.value)
        }
      />
      <span className="esco-lad__bracket">{rhs}</span>
      <button
        type="button"
        className="esco-lad__remove"
        title="Remove instruction"
        onClick={() => editing.onRemoveInstruction(editing.rungId, node.id)}
      >
        ×
      </button>
    </span>
  );
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
