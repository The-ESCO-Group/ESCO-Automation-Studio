import { useMemo, useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  compareProjects,
  compareReportCsv,
  compareReportJson,
  type ProjectComparison,
  type RoutineMatch,
  type RoutineRef,
} from "@esco/compare";
import { downloadTextFile, slugify } from "../file-io";

interface Props {
  project: PlcProject;
  comparison: { name: string; project: PlcProject } | null;
  onChooseFile: () => void;
}

const STATUS_LABEL: Record<RoutineMatch["status"], string> = {
  identical: "Identical",
  "operand-changed": "Operands changed",
  "structure-changed": "Structure changed",
};

function refLabel(ref: RoutineRef): string {
  return `${ref.programName} / ${ref.routineName}`;
}

/** A changed pair: header row that expands to a side-by-side normalized diff. */
function ChangedRow({ match }: { match: RoutineMatch }) {
  const [open, setOpen] = useState(false);
  const rows = Math.max(match.leftRungTexts.length, match.rightRungTexts.length);
  return (
    <li className="esco-cmp__item esco-cmp__item--changed">
      <button type="button" className="esco-cmp__row" onClick={() => setOpen((v) => !v)}>
        <span className="esco-cmp__caret">{open ? "▾" : "▸"}</span>
        <span className="esco-cmp__name">{refLabel(match.left)}</span>
        {refLabel(match.left) !== refLabel(match.right) ? (
          <span className="esco-cmp__name esco-cmp__name--right">→ {refLabel(match.right)}</span>
        ) : null}
        <span className={`esco-cmp__badge esco-cmp__badge--${match.status}`}>
          {STATUS_LABEL[match.status]}
        </span>
        <span className="esco-cmp__matched-by">matched by {match.matchedBy}</span>
      </button>
      {open ? (
        <div className="esco-cmp__detail">
          <div className="esco-cmp__sidebyside">
            <div className="esco-cmp__col">
              <h4>Current</h4>
              {Array.from({ length: rows }).map((_, i) => (
                <code
                  key={i}
                  className={`esco-cmp__rung${
                    match.leftRungTexts[i] !== match.rightRungTexts[i] ? " is-diff" : ""
                  }`}
                >
                  {match.leftRungTexts[i] ?? "—"}
                </code>
              ))}
            </div>
            <div className="esco-cmp__col">
              <h4>Comparison</h4>
              {Array.from({ length: rows }).map((_, i) => (
                <code
                  key={i}
                  className={`esco-cmp__rung${
                    match.leftRungTexts[i] !== match.rightRungTexts[i] ? " is-diff" : ""
                  }`}
                >
                  {match.rightRungTexts[i] ?? "—"}
                </code>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Offline project comparison by logic structure (not just names). */
export function CompareView({ project, comparison, onChooseFile }: Props) {
  const result = useMemo(
    () => (comparison ? compareProjects(project, comparison.project) : null),
    [project, comparison],
  );

  const exportReport = (format: "json" | "csv", data: ProjectComparison) => {
    const base = `${slugify(project.name)}-vs-${slugify(comparison?.name ?? "comparison")}-compare`;
    if (format === "json") {
      downloadTextFile(`${base}.json`, compareReportJson(data));
    } else {
      downloadTextFile(`${base}.csv`, compareReportCsv(data));
    }
  };

  return (
    <div className="esco-cmp">
      <header className="esco-cmp__header">
        <div>
          <h1 className="esco-cmp__title">Compare Projects</h1>
          <p className="esco-cmp__subtitle">
            Match routines by logic structure (fingerprint), then by name — across renamed programs
            and routines. Offline; nothing is sent anywhere.
          </p>
        </div>
        <div className="esco-cmp__actions">
          <button type="button" className="esco-btn esco-btn--primary" onClick={onChooseFile}>
            Choose comparison file…
          </button>
          {result ? (
            <>
              <button type="button" className="esco-btn" onClick={() => exportReport("json", result)}>
                Export JSON
              </button>
              <button type="button" className="esco-btn" onClick={() => exportReport("csv", result)}>
                Export CSV
              </button>
            </>
          ) : null}
        </div>
      </header>

      {!comparison || !result ? (
        <div className="esco-cmp__empty">
          <p>
            Load a second <code>.plcproj.json</code> or <code>.L5X</code> file to compare against the
            current project (<strong>{project.name}</strong>).
          </p>
        </div>
      ) : (
        <>
          <div className="esco-cmp__bar">
            <span className="esco-cmp__current">
              <strong>{project.name}</strong> vs <strong>{comparison.name}</strong>
            </span>
            <span className="esco-cmp__chip esco-cmp__chip--match">{result.summary.matched} identical</span>
            <span className="esco-cmp__chip esco-cmp__chip--changed">{result.summary.changed} changed</span>
            <span className="esco-cmp__chip esco-cmp__chip--left">{result.summary.onlyInLeft} only in current</span>
            <span className="esco-cmp__chip esco-cmp__chip--right">{result.summary.onlyInRight} only in comparison</span>
          </div>

          {result.warnings.length > 0 ? (
            <ul className="esco-cmp__warnings">
              {result.warnings.map((warning, i) => (
                <li key={i}>⚠ {warning}</li>
              ))}
            </ul>
          ) : null}

          <section className="esco-cmp__section">
            <h2>Changed routines ({result.changed.length})</h2>
            {result.changed.length > 0 ? (
              <ul className="esco-cmp__list">
                {result.changed.map((match) => (
                  <ChangedRow key={`${match.left.routineId}:${match.right.routineId}`} match={match} />
                ))}
              </ul>
            ) : (
              <p className="esco-empty">No matched routines differ.</p>
            )}
          </section>

          <section className="esco-cmp__section">
            <h2>Only in current ({result.onlyInLeft.length})</h2>
            <ul className="esco-cmp__list">
              {result.onlyInLeft.map((ref) => (
                <li key={ref.routineId} className="esco-cmp__item">
                  {refLabel(ref)}
                </li>
              ))}
            </ul>
          </section>

          <section className="esco-cmp__section">
            <h2>Only in comparison ({result.onlyInRight.length})</h2>
            <ul className="esco-cmp__list">
              {result.onlyInRight.map((ref) => (
                <li key={ref.routineId} className="esco-cmp__item">
                  {refLabel(ref)}
                </li>
              ))}
            </ul>
          </section>

          <section className="esco-cmp__section">
            <h2>Identical routines ({result.matches.length})</h2>
            <ul className="esco-cmp__list">
              {result.matches.map((match) => (
                <li key={`${match.left.routineId}:${match.right.routineId}`} className="esco-cmp__item">
                  {refLabel(match.left)}
                  {refLabel(match.left) !== refLabel(match.right) ? ` ≡ ${refLabel(match.right)}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
