import { useMemo } from "react";
import type { PlcProject } from "@esco/core";
import type { ValidationFinding } from "@esco/validator";
import { buildModelSummary } from "../model-summary";

interface Props {
  project: PlcProject;
  findings: ValidationFinding[];
  openRoutineName?: string;
}

/** Read-only project rollup: identity, counts, health, and unsupported instructions. */
export function ModelSummaryPanel({ project, findings, openRoutineName }: Props) {
  const summary = useMemo(() => buildModelSummary(project, findings), [project, findings]);
  const c = summary.counts;
  const countRows: { label: string; value: number }[] = [
    { label: "Programs", value: c.programs },
    { label: "Routines", value: c.routines },
    { label: "Rungs", value: c.rungs },
    { label: "Tasks", value: c.tasks },
    { label: "Controller tags", value: c.controllerTags },
    { label: "Program tags", value: c.programTags },
    { label: "Add-On Instructions", value: c.aois },
    { label: "User-defined types", value: c.udts },
    { label: "I/O modules", value: c.ioModules },
  ];

  return (
    <div className="esco-model">
      <div className="esco-model__heading">Model Summary</div>

      <dl className="esco-props">
        <div className="esco-props__row">
          <dt>Project</dt>
          <dd>{summary.projectName}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Controller</dt>
          <dd>{summary.controllerName ?? "—"}</dd>
        </div>
        <div className="esco-props__row">
          <dt>Processor</dt>
          <dd>{summary.processorType ?? "—"}</dd>
        </div>
        {openRoutineName ? (
          <div className="esco-props__row">
            <dt>Open routine</dt>
            <dd>{openRoutineName}</dd>
          </div>
        ) : null}
        <div className="esco-props__row">
          <dt>Execution</dt>
          <dd>Continuous scan (offline simulation)</dd>
        </div>
      </dl>

      <div className="esco-model__heading">Contents</div>
      <div className="esco-model__grid">
        {countRows.map((row) => (
          <div className="esco-model__stat" key={row.label}>
            <span className="esco-model__stat-value">{row.value}</span>
            <span className="esco-model__stat-label">{row.label}</span>
          </div>
        ))}
      </div>

      <div className="esco-model__heading">Health</div>
      <div className="esco-model__health">
        <span className={`esco-model__pill${summary.errorCount ? " is-error" : " is-ok"}`}>
          {summary.errorCount} error{summary.errorCount === 1 ? "" : "s"}
        </span>
        <span className={`esco-model__pill${summary.warningCount ? " is-warn" : " is-ok"}`}>
          {summary.warningCount} warning{summary.warningCount === 1 ? "" : "s"}
        </span>
        <span className={`esco-model__pill${summary.unsupportedTotal ? " is-warn" : " is-ok"}`}>
          {summary.unsupportedTotal} unsupported instruction{summary.unsupportedTotal === 1 ? "" : "s"}
        </span>
      </div>

      {summary.unsupportedInstructions.length > 0 ? (
        <>
          <div className="esco-model__heading">Unsupported instructions (read-only)</div>
          <ul className="esco-model__unsupported">
            {summary.unsupportedInstructions.map((u) => (
              <li key={u.type}>
                <code>{u.type}</code> × {u.count}
              </li>
            ))}
          </ul>
          <p className="esco-model__note">
            These instructions were imported and are preserved read-only. The simulator does not
            execute them.
          </p>
        </>
      ) : null}
    </div>
  );
}
