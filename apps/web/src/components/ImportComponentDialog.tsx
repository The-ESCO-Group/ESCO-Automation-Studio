import { useMemo, useState } from "react";
import type {
  ComponentImportPlan,
  ComponentImportResolutionMap,
  ComponentImportResolutionOption,
} from "@esco/project-actions";

interface Props {
  fileName: string;
  /** Plan computed from the file with no resolutions yet (used for the initial render). */
  initialPlan: ComponentImportPlan;
  /** Re-run the offline preview with the engineer's current choices. Must be pure. */
  recompute: (resolutions: ComponentImportResolutionMap) => ComponentImportPlan;
  onCancel: () => void;
  onApply: (resolutions: ComponentImportResolutionMap) => void;
}

const OPTION_LABELS: Record<ComponentImportResolutionOption, string> = {
  import: "Import as-is",
  overwrite: "Overwrite existing",
  rename: "Rename",
  skip: "Skip",
};

/** The option a row resolves to when the engineer has made no explicit choice. */
function defaultOption(conflict: boolean): ComponentImportResolutionOption {
  return conflict ? "rename" : "import";
}

/**
 * Conflict-resolution dialog for the offline "Import Add-On Instruction / Data
 * Type / Trend" commands. Lists every component found in the file and, for any
 * whose name collides with an existing controller component, lets the engineer
 * choose overwrite / rename / skip before anything is merged.
 */
export function ImportComponentDialog({ fileName, initialPlan, recompute, onCancel, onApply }: Props) {
  const [resolutions, setResolutions] = useState<ComponentImportResolutionMap>({});
  const plan = useMemo(() => recompute(resolutions), [recompute, resolutions]);
  const active = plan.ok ? plan : initialPlan;

  const setOption = (id: string, option: ComponentImportResolutionOption) => {
    setResolutions((prev) => {
      const next = { ...prev };
      if (option === "rename") next[id] = { option, renameTo: prev[id]?.renameTo };
      else next[id] = { option };
      return next;
    });
  };

  const setRenameTo = (id: string, renameTo: string) => {
    setResolutions((prev) => ({ ...prev, [id]: { option: "rename", renameTo } }));
  };

  const importing = active.createCount + active.renameCount + active.overwriteCount;
  const canApply = active.ok && importing > 0;
  const targetLabel = active.targetLabel ?? active.controllerName ?? "this target";

  return (
    <div className="esco-modal" role="dialog" aria-modal="true" aria-labelledby="esco-import-title">
      <section className="esco-modal__panel esco-tagcsv">
        <header className="esco-modal__header">
          <div>
            <span className="esco-modal__eyebrow">{active.kindLabel} import</span>
            <h2 id="esco-import-title">Review components from {fileName}</h2>
          </div>
          <button type="button" className="esco-icon-btn" aria-label="Close component import" onClick={onCancel} />
        </header>

        <div className="esco-tagcsv__summary">
          <span className="is-ok">{active.createCount} new</span>
          <span className="is-info">{active.renameCount} renamed</span>
          <span className={active.overwriteCount ? "is-info" : "is-muted"}>{active.overwriteCount} overwrite</span>
          <span className={active.skipCount ? "is-muted" : "is-muted"}>{active.skipCount} skipped</span>
          <span className={active.errorCount ? "is-error" : "is-muted"}>{active.errorCount} errors</span>
        </div>

        {active.conflictCount > 0 ? (
          <ul className="esco-tagcsv__warnings">
            <li>
              {active.conflictCount} component{active.conflictCount === 1 ? "" : "s"} already exist in{" "}
              {targetLabel}. Choose one of the available resolutions for each.
            </li>
          </ul>
        ) : null}

        <div className="esco-tagcsv__tablewrap">
          <table className="esco-detail__table esco-tagcsv__table">
            <thead>
              <tr>
                <th>Source name</th>
                <th>Status</th>
                <th>Resolution</th>
                <th>Final name</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {active.items.length === 0 ? (
                <tr>
                  <td colSpan={5}>{active.error ?? "No components found in this file."}</td>
                </tr>
              ) : (
                active.items.map((row) => {
                  const chosen = resolutions[row.id]?.option ?? defaultOption(row.conflict);
                  return (
                    <tr key={row.id} className={`esco-tagcsv__row--${row.status}`}>
                      <td>{row.sourceName}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.availableOptions.length === 0 ? (
                          "—"
                        ) : (
                          <div className="esco-import__resolution">
                            <select
                              aria-label={`Resolution for ${row.sourceName}`}
                              value={chosen}
                              onChange={(event) =>
                                setOption(row.id, event.target.value as ComponentImportResolutionOption)
                              }
                            >
                              {row.availableOptions.map((option) => (
                                <option key={option} value={option}>
                                  {OPTION_LABELS[option]}
                                </option>
                              ))}
                            </select>
                            {chosen === "rename" ? (
                              <input
                                type="text"
                                aria-label={`Rename ${row.sourceName} to`}
                                placeholder={row.finalName}
                                value={resolutions[row.id]?.renameTo ?? ""}
                                onChange={(event) => setRenameTo(row.id, event.target.value)}
                              />
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td>{row.status === "skip" ? "—" : row.finalName}</td>
                      <td>{row.message ?? (row.conflict ? `Conflicts with "${row.existingName}".` : "—")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="esco-modal__footer">
          <span>
            {canApply
              ? `Ready to import ${importing} component${importing === 1 ? "" : "s"} into ${targetLabel}. Validation runs after import.`
              : "Nothing selected to import. Choose at least one component, or cancel."}
          </span>
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="esco-btn esco-btn--primary"
              disabled={!canApply}
              onClick={() => onApply(resolutions)}
            >
              Import components
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
