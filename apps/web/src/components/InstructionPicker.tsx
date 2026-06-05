import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultRegistry,
  instructionFidelity,
  instructionFidelityLabel,
  supportLevel,
  supportLevelLabel,
  type InstructionDefinition,
  type InstructionFidelityStatus,
} from "@esco/instructions";

/**
 * Add Ladder Element — a searchable instruction picker, the ESCO analogue of the
 * Studio "instruction toolbar dropdown". It lists every instruction the shared
 * registry knows about (so the picker never drifts from what the editor can
 * render/validate/simulate), lets the engineer search by mnemonic, name,
 * category or description, previews the operands and help text, and inserts the
 * chosen instruction onto the current rung through the real project-action layer.
 */

// One shared registry, mirroring how LadderView sources its instruction metadata.
const registry = createDefaultRegistry();

const CATEGORY_LABELS: Record<InstructionDefinition["category"], string> = {
  bit: "Bit",
  timer: "Timer",
  counter: "Counter",
  compare: "Compare",
  math: "Compute / Math",
  move: "Move / Logical",
  "program-control": "Program Control",
  sequencer: "Sequencer",
  shift: "Shift",
  file: "File / Array",
  message: "Message",
  alarm: "Alarm",
  motion: "Motion",
  process: "Process",
  safety: "Safety",
};

interface PickerEntry {
  type: string;
  displayName: string;
  category: InstructionDefinition["category"];
  categoryLabel: string;
  description: string;
  def: InstructionDefinition;
  fidelityStatus: InstructionFidelityStatus;
  fidelityLabel: string;
  supportLabel: string;
  limitations: string[];
  haystack: string;
}

const fidelityClass = (status: InstructionFidelityStatus): string => `is-${status}`;

const ALL_ENTRIES: PickerEntry[] = registry
  .all()
  .map((def) => {
    const categoryLabel = CATEGORY_LABELS[def.category] ?? def.category;
    const fidelity = instructionFidelity(def);
    const fidelityLabel = instructionFidelityLabel(fidelity.status);
    const supportLabel = supportLevelLabel(supportLevel(def));
    const limitations = fidelity.limitations ?? [];
    return {
      type: def.type,
      displayName: def.displayName,
      category: def.category,
      categoryLabel,
      description: def.description,
      def,
      fidelityStatus: fidelity.status,
      fidelityLabel,
      supportLabel,
      limitations,
      haystack: [
        def.type,
        def.displayName,
        categoryLabel,
        def.category,
        def.description,
        fidelity.status,
        fidelityLabel,
        supportLabel,
        ...limitations,
      ].join(" ").toLowerCase(),
    };
  })
  .sort((left, right) =>
    left.categoryLabel === right.categoryLabel
      ? left.type.localeCompare(right.type)
      : left.categoryLabel.localeCompare(right.categoryLabel),
  );

interface Props {
  open: boolean;
  /** Label of the rung the instruction will be appended to (e.g. "Rung 003"). */
  targetLabel?: string;
  onClose: () => void;
  onInsert: (instructionType: string) => void;
}

export function InstructionPicker({ open, targetLabel, onClose, onInsert }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Auto-scroll the active row into view only for keyboard navigation; scrolling
  // on a mouse click would move the list out from under the cursor mid-double-click.
  const keyboardNav = useRef(false);

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return ALL_ENTRIES;
    return ALL_ENTRIES.filter((entry) => terms.every((term) => entry.haystack.includes(term)));
  }, [query]);

  // Reset the search whenever the dialog opens, and focus the search box.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Keep the active row in view as the user arrows through results.
  useEffect(() => {
    if (!open || !keyboardNav.current) return;
    keyboardNav.current = false;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  const active = results[Math.min(activeIndex, results.length - 1)];

  const insert = (entry: PickerEntry | undefined) => {
    if (!entry) return;
    onInsert(entry.type);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardNav.current = true;
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardNav.current = true;
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      insert(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="esco-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="esco-modal__panel esco-instr-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Add Ladder Element"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="esco-modal__header">
          <h2>Add Ladder Element{targetLabel ? ` — ${targetLabel}` : ""}</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Add Ladder Element" onClick={onClose} />
        </header>

        <div className="esco-instr-picker__search">
          <input
            ref={inputRef}
            type="search"
            className="esco-instr-picker__input"
            aria-label="Search instructions"
            placeholder="Search by mnemonic, name, category, or description…"
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="esco-instr-picker__count">{results.length} instructions</span>
        </div>

        <div className="esco-instr-picker__body">
          <ul className="esco-instr-picker__list" ref={listRef} role="listbox" aria-label="Instructions">
            {results.length === 0 ? (
              <li className="esco-instr-picker__empty">No instructions match “{query}”.</li>
            ) : (
              results.map((entry, index) => {
                const showCategory = index === 0 || results[index - 1]!.categoryLabel !== entry.categoryLabel;
                return (
                  <li key={entry.type}>
                    {showCategory ? (
                      <div className="esco-instr-picker__group">{entry.categoryLabel}</div>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      data-index={index}
                      className={`esco-instr-picker__item${index === activeIndex ? " is-active" : ""}`}
                      onClick={() => setActiveIndex(index)}
                      onDoubleClick={() => insert(entry)}
                    >
                      <span className="esco-instr-picker__mnemonic">{entry.type}</span>
                      <span className="esco-instr-picker__item-main">
                        <span className="esco-instr-picker__name">{entry.displayName}</span>
                        <span className={`esco-instr-picker__badge ${fidelityClass(entry.fidelityStatus)}`}>
                          {entry.fidelityLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <aside className="esco-instr-picker__preview" aria-label="Instruction details">
            {active ? (
              <>
                <div className="esco-instr-picker__preview-head">
                  <strong>{active.type}</strong>
                  <span>{active.displayName}</span>
                  <small>{active.categoryLabel}</small>
                  <span className={`esco-instr-picker__badge ${fidelityClass(active.fidelityStatus)}`}>
                    {active.fidelityLabel}
                  </span>
                </div>
                <p className="esco-instr-picker__desc">{active.description}</p>
                <div className="esco-instr-picker__fidelity" aria-label="Instruction fidelity">
                  <span className="esco-instr-picker__operands-label">Fidelity</span>
                  <strong>{active.supportLabel}</strong>
                  <p>{instructionFidelity(active.def).summary}</p>
                  {active.limitations.length ? (
                    <ul>
                      {active.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="esco-instr-picker__operands">
                  <span className="esco-instr-picker__operands-label">Operands</span>
                  {active.def.operands.length === 0 ? (
                    <em>None</em>
                  ) : (
                    <ol>
                      {active.def.operands.map((operand) => (
                        <li key={operand.name}>
                          <code>{operand.label || operand.name}</code>
                          {operand.allowedTypes?.length ? (
                            <span className="esco-instr-picker__operand-type">
                              {operand.allowedTypes.join(" / ")}
                            </span>
                          ) : null}
                          {operand.required ? null : <span className="esco-instr-picker__operand-opt">optional</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <p className="esco-instr-picker__support">{active.supportLabel}</p>
              </>
            ) : null}
          </aside>
        </div>

        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button
              type="button"
              className="esco-btn esco-btn--primary"
              disabled={!active}
              onClick={() => insert(active)}
            >
              Insert
            </button>
            <button type="button" className="esco-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
