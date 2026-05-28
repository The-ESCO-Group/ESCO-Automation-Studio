import type { PlcProject } from "@esco/core";
import { collectTagReferences } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { Forces, TraceEntry, WatchRow } from "../simulation";
import { CrossRefPanel } from "./CrossRefPanel";

export type DockTab =
  | "diagnostics"
  | "search"
  | "references"
  | "build"
  | "watch"
  | "trend"
  | "trace"
  | "forces";

interface Props {
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  empty?: boolean;
  findings: ValidationFinding[];
  tags: WatchRow[];
  running: boolean;
  onToggleTag: (name: string) => void;
  onSetNumber: (name: string, value: number) => void;
  onScanOnce: () => void;
  onReset: () => void;
  onToggleRun: () => void;
  forces: Forces;
  onToggleForce: (name: string) => void;
  onClearForces: () => void;
  trace: TraceEntry[];
  project: PlcProject;
  selectedTagName?: string;
  onOpenRoutine: (routineId: string) => void;
}

/** The Value-column content for one watched tag, by kind. */
function WatchValue({
  row,
  forced,
  onToggleTag,
  onSetNumber,
}: {
  row: WatchRow;
  forced: boolean;
  onToggleTag: (name: string) => void;
  onSetNumber: (name: string, value: number) => void;
}) {
  const forcedMark = forced ? <span className="esco-watch__forced" title="Forced value">⏚</span> : null;
  if (row.kind === "struct") {
    return (
      <span className="esco-watch__members">
        {row.members?.map((member) => (
          <span
            key={member.name}
            className={`esco-watch__member${member.value === true ? " is-on" : ""}`}
          >
            {member.name}=
            {member.type === "BOOL" ? (member.value ? "true" : "false") : String(member.value)}
          </span>
        ))}
      </span>
    );
  }

  if (row.kind === "number") {
    if (row.role === "input") {
      return (
        <span className="esco-watch__bool">
          <input
            className="esco-watch__number"
            type="number"
            value={Number(row.value ?? 0)}
            onChange={(event) => onSetNumber(row.name, Number(event.target.value) || 0)}
          />
          {forcedMark}
        </span>
      );
    }
    return (
      <span className="esco-watch__bool">
        <span className="esco-watch__value">{String(row.value ?? 0)}</span>
        {forcedMark}
      </span>
    );
  }

  // BOOL
  const on = row.value === true;
  return (
    <span className="esco-watch__bool">
      <span className={`esco-watch__value${on ? " is-on" : ""}`}>{on ? "true" : "false"}</span>
      {forcedMark}
      {row.role === "input" ? (
        <button
          type="button"
          className={`esco-btn esco-btn--toggle${on ? " is-on" : ""}`}
          onClick={() => onToggleTag(row.name)}
        >
          Toggle
        </button>
      ) : null}
    </span>
  );
}

export function BottomPanel({
  tab,
  onTabChange,
  empty = false,
  findings,
  tags,
  running,
  onToggleTag,
  onSetNumber,
  onScanOnce,
  onReset,
  onToggleRun,
  forces,
  onToggleForce,
  onClearForces,
  trace,
  project,
  selectedTagName,
  onOpenRoutine,
}: Props) {
  const setTab = onTabChange;
  const xrefCount = selectedTagName ? collectTagReferences(project, selectedTagName).length : 0;
  const forceCount = Object.keys(forces).length;
  const forcedRows = tags.filter((row) => row.name in forces);
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const messageCount = findings.filter((finding) => finding.severity === "info").length;
  const tagDescriptions = new Map(
    project.controllers
      .flatMap((controller) => [
        ...controller.controllerTags,
        ...controller.programs.flatMap((program) => program.programTags),
      ])
      .map((tag) => [tag.name, tag.description ?? ""]),
  );

  if (empty) {
    return (
      <div className="esco-empty-dock">
        <section className="esco-empty-dock__pane esco-empty-dock__pane--diagnostics">
          <div className="esco-dock__tabs">
            {["Diagnostics", "Search Results", "References", "Build", "Watch", "Trend"].map((label, index) => (
              <button
                key={label}
                type="button"
                className={`esco-dock__tab${index === 0 ? " is-active" : ""}`}
                disabled={index !== 0}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="esco-empty-diagnostics">
            <table className="esco-diagnostics__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Message</th>
                  <th>Location</th>
                  <th>Time</th>
                </tr>
              </thead>
            </table>
            <div className="esco-empty-diagnostics__message">
              <span className="esco-empty-diagnostics__check">✓</span>
              <strong>No diagnostics</strong>
              <span>Build and runtime messages will appear here.</span>
            </div>
          </div>
        </section>
        <section className="esco-empty-dock__pane esco-empty-dock__pane--watch">
          <div className="esco-dock__tabs">
            <button type="button" className="esco-dock__tab is-active" disabled>Watch</button>
            <button type="button" className="esco-dock__tab" disabled>Add Watch</button>
            <button type="button" className="esco-dock__tab esco-dock__tab--icon" disabled>+</button>
          </div>
          <div className="esco-empty-watch">
            <table className="esco-watch">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Force</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 5 }).map((__, cell) => (
                      <td key={cell}><span className="esco-skeleton" /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="esco-dock">
      <div className="esco-dock__tabs">
        <button
          type="button"
          className={`esco-dock__tab${tab === "diagnostics" ? " is-active" : ""}`}
          onClick={() => setTab("diagnostics")}
        >
          Diagnostics<span className="esco-sr-only"> Errors</span>
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "search" ? " is-active" : ""}`}
          onClick={() => setTab("search")}
        >
          Search Results
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "references" ? " is-active" : ""}`}
          onClick={() => setTab("references")}
        >
          References<span className="esco-sr-only"> Cross Ref</span>{selectedTagName ? ` (${xrefCount})` : ""}
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "build" ? " is-active" : ""}`}
          onClick={() => setTab("build")}
        >
          Build
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "watch" ? " is-active" : ""}`}
          onClick={() => setTab("watch")}
        >
          Watch ({tags.length}){forceCount ? ` · ${forceCount} forced` : ""}
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "trend" ? " is-active" : ""}`}
          onClick={() => setTab("trend")}
        >
          Trend
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "trace" ? " is-active" : ""}`}
          onClick={() => setTab("trace")}
        >
          Trace ({trace.length})
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "forces" ? " is-active" : ""}`}
          onClick={() => setTab("forces")}
        >
          Forces ({forceCount})
        </button>
      </div>

      <div className="esco-dock__body">
        {tab === "diagnostics" ? (
          <div className="esco-diagnostics">
            <div className="esco-diagnostics__summary">
              <span className="is-error">{errorCount} Errors</span>
              <span className="is-warn">{warningCount} Warnings</span>
              <span className="is-info">{messageCount || (findings.length === 0 ? 1 : 0)} Messages</span>
            </div>
            <table className="esco-diagnostics__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Message</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {findings.length === 0 ? (
                  <tr>
                    <td>Info</td>
                    <td>Validator</td>
                    <td>No validation findings.</td>
                    <td>-</td>
                  </tr>
                ) : (
                  findings.map((finding, index) => (
                    <tr key={`${finding.ruleId}-${index}`} className={`esco-finding--${finding.severity}`}>
                      <td>{finding.severity}</td>
                      <td>{finding.ruleId}</td>
                      <td>{finding.message}</td>
                      <td>{finding.target ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "search" ? (
          <p className="esco-empty">Search results will appear here after using Find.</p>
        ) : tab === "references" ? (
          <CrossRefPanel
            project={project}
            selectedTagName={selectedTagName}
            onOpenRoutine={onOpenRoutine}
          />
        ) : tab === "build" ? (
          <div className="esco-build">
            <p className="esco-empty">Offline build view. Use Verify to inspect validation status.</p>
          </div>
        ) : tab === "watch" ? (
          <div className="esco-sim">
            <div className="esco-simbar">
              <button type="button" className="esco-btn esco-btn--primary" onClick={onScanOnce}>
                Scan Once
              </button>
              <button type="button" className="esco-btn" onClick={onToggleRun}>
                {running ? "Stop" : "Run"}
              </button>
              <button type="button" className="esco-btn" onClick={onReset}>
                Reset Values
              </button>
              {forceCount > 0 ? (
                <button type="button" className="esco-btn esco-btn--danger" onClick={onClearForces}>
                  Clear Forces ({forceCount})
                </button>
              ) : null}
              <span className="esco-simbar__status">{running ? "Running" : "Stopped"}</span>
              {forceCount > 0 ? (
                <span className="esco-simbar__note">Forces are offline-only simulation overrides.</span>
              ) : null}
            </div>

            {tags.length === 0 ? (
              <p className="esco-empty">No tags in the project.</p>
            ) : (
              <table className="esco-watch">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Value</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Force</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((row) => {
                    const forced = row.name in forces;
                    return (
                      <tr key={row.name} className={forced ? "is-forced" : undefined}>
                        <td>{row.name}</td>
                        <td>
                          <WatchValue
                            row={row}
                            forced={forced}
                            onToggleTag={onToggleTag}
                            onSetNumber={onSetNumber}
                          />
                        </td>
                        <td>{row.dataType}</td>
                        <td>{row.role}</td>
                        <td>
                          {row.kind === "struct" ? (
                            <span className="esco-watch__value">—</span>
                          ) : (
                            <button
                              type="button"
                              className={`esco-btn esco-btn--toggle${forced ? " is-on" : ""}`}
                              title={forced ? "Remove force" : "Force this value (simulation only)"}
                              onClick={() => onToggleForce(row.name)}
                            >
                              {forced ? "Forced" : "Force"}
                            </button>
                          )}
                        </td>
                        <td>{tagDescriptions.get(row.name) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : tab === "trend" ? (
          <div className="esco-trend">
            <p className="esco-empty">Trend data is not captured yet. Watch values remain available in Offline Simulation.</p>
          </div>
        ) : tab === "trace" ? (
          <div className="esco-trace">
            <p className="esco-trace__note">
              Last scan trace — per-instruction power flow (offline approximate simulation).
            </p>
            {trace.length === 0 ? (
              <p className="esco-empty">No trace yet. Press “Scan Once” to capture a scan.</p>
            ) : (
              <table className="esco-tracetable">
                <thead>
                  <tr>
                    <th>Rung</th>
                    <th>Instruction</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Writes</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.map((entry, index) => (
                    <tr key={index} className={entry.conditionOut ? "is-true" : "is-false"}>
                      <td>{entry.rung}</td>
                      <td>
                        {entry.instruction}({entry.operands.join(", ")})
                      </td>
                      <td>{entry.conditionIn ? "T" : "F"}</td>
                      <td>{entry.conditionOut ? "T" : "F"}</td>
                      <td>
                        {entry.writes.map((w) => `${w.path}=${String(w.value)}`).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : tab === "forces" ? (
          <div className="esco-forces">
            <div className="esco-forces__bar">
              <span className="esco-forces__note">
                Forces are offline simulation overrides — they pin a tag's value and never reach a
                controller.
              </span>
              {forceCount > 0 ? (
                <button type="button" className="esco-btn esco-btn--danger" onClick={onClearForces}>
                  Clear Forces ({forceCount})
                </button>
              ) : null}
            </div>
            {forcedRows.length === 0 ? (
              <p className="esco-empty">No forces active. Use “Force” in the Watch tab to pin a value.</p>
            ) : (
              <table className="esco-watch">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Type</th>
                    <th>Forced value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {forcedRows.map((row) => (
                    <tr key={row.name} className="is-forced">
                      <td>{row.name}</td>
                      <td>{row.dataType}</td>
                      <td>
                        <span className="esco-watch__value">{String(forces[row.name])}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="esco-btn esco-btn--toggle is-on"
                          title="Remove force"
                          onClick={() => onToggleForce(row.name)}
                        >
                          Forced
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <p className="esco-empty">Select a dock tab.</p>
        )}
      </div>
    </div>
  );
}
