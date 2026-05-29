import type { PlcProject } from "@esco/core";
import { collectTagReferences } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { Forces, TraceEntry, TrendSample, WatchRow } from "../simulation";
import type { SearchHit } from "../search";
import type { ActivityEntry } from "../activity";
import type { ControllerSessionApi } from "../controller-session";
import { CrossRefPanel } from "./CrossRefPanel";
import { ControllerPanel } from "./ControllerPanel";

export type DockTab =
  | "diagnostics"
  | "search"
  | "references"
  | "build"
  | "watch"
  | "trend"
  | "trace"
  | "forces"
  | "logger"
  | "task-monitor"
  | "controller";

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
  trendSamples: TrendSample[];
  scanIntervalMs: number;
  onClearTrend: () => void;
  project: PlcProject;
  selectedTagName?: string;
  onOpenRoutine: (routineId: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchHits?: SearchHit[];
  activity?: ActivityEntry[];
  onClearActivity?: () => void;
  controller?: ControllerSessionApi;
  onToast?: (kind: "info" | "success" | "warning" | "error", message: string) => void;
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

function formatTrendValue(value: TrendSample["values"][string] | undefined): string {
  if (value == null) return "-";
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

function trendStats(samples: TrendSample[], tagName: string) {
  const values = samples.map((sample) => sample.values[tagName]).filter((value) => value != null);
  const latest = values[values.length - 1];
  const numeric = values.every((value) => typeof value === "number");
  let changes = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== values[i - 1]) changes += 1;
  }
  if (numeric) {
    const nums = values as number[];
    return {
      latest: formatTrendValue(latest),
      min: nums.length ? String(Math.min(...nums)) : "-",
      max: nums.length ? String(Math.max(...nums)) : "-",
      changes,
    };
  }
  return { latest: formatTrendValue(latest), min: "-", max: "-", changes };
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
  trendSamples,
  scanIntervalMs,
  onClearTrend,
  project,
  selectedTagName,
  onOpenRoutine,
  searchQuery = "",
  onSearchChange,
  searchHits = [],
  activity = [],
  onClearActivity,
  controller,
  onToast,
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
  const trendNames = tags
    .filter((row) => row.kind !== "struct")
    .slice(0, 10)
    .map((row) => row.name);
  const latestTrend = trendSamples[trendSamples.length - 1];
  const controllers = project.controllers;
  const programsById = new Map(
    controllers.flatMap((controller) => controller.programs.map((program) => [program.id, program.name])),
  );
  const routineCount = controllers
    .flatMap((controller) => controller.programs)
    .reduce((count, program) => count + program.routines.length, 0);
  const taskCount = controllers.reduce((count, controller) => count + controller.tasks.length, 0);

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
        <button
          type="button"
          className={`esco-dock__tab${tab === "logger" ? " is-active" : ""}`}
          onClick={() => setTab("logger")}
        >
          Logger
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "task-monitor" ? " is-active" : ""}`}
          onClick={() => setTab("task-monitor")}
        >
          Task Monitor
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "controller" ? " is-active" : ""}`}
          onClick={() => setTab("controller")}
        >
          Controller
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
                  findings.map((finding, index) => {
                    const targetParts = finding.target?.split("/") ?? [];
                    const routineName = targetParts[targetParts.length - 1];
                    const routine = project.controllers
                      .flatMap((controller) => controller.programs)
                      .flatMap((program) => program.routines)
                      .find((candidate) => candidate.name === routineName);
                    return (
                    <tr key={`${finding.ruleId}-${index}`} className={`esco-finding--${finding.severity}`}>
                      <td>{finding.severity}</td>
                      <td>{finding.ruleId}</td>
                      <td>{finding.message}</td>
                      <td>
                        {routine ? (
                          <button type="button" className="esco-link" onClick={() => onOpenRoutine(routine.id)}>
                            {finding.target}
                          </button>
                        ) : (
                          finding.target ?? "-"
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "search" ? (
          <div className="esco-search">
            <div className="esco-search__bar" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}>
              <input
                className="esco-ai__input"
                type="search"
                style={{ flex: 1 }}
                value={searchQuery}
                placeholder="Find tags, routines, or rung text…"
                onChange={(event) => onSearchChange?.(event.target.value)}
              />
              <span className="esco-search__count" style={{ fontSize: 12, opacity: 0.7 }}>
                {searchHits.length} result{searchHits.length === 1 ? "" : "s"}
              </span>
            </div>
            {searchHits.length === 0 ? (
              <p className="esco-empty">
                {searchQuery ? "No matches." : "Type to search the project — tag names, routine names, and rung text."}
              </p>
            ) : (
              <table className="esco-diagnostics__table">
                <thead>
                  <tr><th>Type</th><th>Match</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {searchHits.map((hit, index) => (
                    <tr key={`${hit.kind}-${index}`}>
                      <td>{hit.kind}</td>
                      <td>
                        {hit.routineId ? (
                          <button
                            type="button"
                            className="esco-btn esco-btn--quick"
                            onClick={() => onOpenRoutine(hit.routineId!)}
                            title="Open routine"
                          >
                            {hit.label}
                          </button>
                        ) : (
                          hit.label
                        )}
                      </td>
                      <td>{hit.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
            <div className="esco-dockbar">
              <span>
                Trend buffer: {trendSamples.length} sample{trendSamples.length === 1 ? "" : "s"}
                {" · "}offline scan period {scanIntervalMs} ms
                {latestTrend ? ` · latest ${new Date(latestTrend.at).toLocaleTimeString()}` : ""}
              </span>
              <div className="esco-dockbar__actions">
                <button type="button" className="esco-btn" onClick={onScanOnce}>
                  Capture Scan
                </button>
                <button type="button" className="esco-btn" disabled={trendSamples.length === 0} onClick={onClearTrend}>
                  Clear Buffer
                </button>
              </div>
            </div>
            {trendSamples.length === 0 ? (
              <p className="esco-empty">No trend samples yet. Capture a scan or run Offline Simulation to fill the buffer.</p>
            ) : (
              <>
                <table className="esco-watch esco-trend__stats">
                  <thead><tr><th>Tag</th><th>Latest</th><th>Min</th><th>Max</th><th>Changes</th></tr></thead>
                  <tbody>
                    {trendNames.map((name) => {
                      const stats = trendStats(trendSamples, name);
                      return (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{stats.latest}</td>
                          <td>{stats.min}</td>
                          <td>{stats.max}</td>
                          <td>{stats.changes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <table className="esco-watch esco-trend__samples">
                  <thead>
                    <tr>
                      <th>Time</th>
                      {trendNames.slice(0, 6).map((name) => <th key={name}>{name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {trendSamples.slice(-12).reverse().map((sample) => (
                      <tr key={sample.id}>
                        <td>{new Date(sample.at).toLocaleTimeString()}</td>
                        {trendNames.slice(0, 6).map((name) => (
                          <td key={name}>{formatTrendValue(sample.values[name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
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
        ) : tab === "logger" ? (
          <div className="esco-logger">
            <div className="esco-dockbar">
              <span>Activity logger: {activity.length} event{activity.length === 1 ? "" : "s"} this session</span>
              <div className="esco-dockbar__actions">
                <button type="button" className="esco-btn" disabled={activity.length === 0} onClick={onClearActivity}>
                  Clear Log
                </button>
              </div>
            </div>
            {activity.length === 0 ? (
              <p className="esco-empty">No activity recorded yet. Imports, exports, verifies, comparisons, and AI-applied actions appear here.</p>
            ) : (
              <table className="esco-diagnostics__table">
                <thead><tr><th>Time</th><th>Type</th><th>Message</th></tr></thead>
                <tbody>
                  {activity.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.at).toLocaleTimeString()}</td>
                      <td>{entry.kind}</td>
                      <td>{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : tab === "task-monitor" ? (
          <div className="esco-taskmon">
            <div className="esco-dockbar">
              <span>
                Offline task monitor: {taskCount} task{taskCount === 1 ? "" : "s"} · {routineCount} routine{routineCount === 1 ? "" : "s"} · simulation {running ? "running" : "stopped"}
              </span>
              <span className="esco-dockbar__muted">No controller execution metrics are read.</span>
            </div>
            <table className="esco-diagnostics__table">
              <thead><tr><th>Controller</th><th>Task</th><th>Type</th><th>Period</th><th>Priority</th><th>Watchdog</th><th>Programs</th><th>Inhibited</th></tr></thead>
              <tbody>
                {taskCount === 0 ? (
                  <tr>
                    <td colSpan={8}>No tasks imported for this project.</td>
                  </tr>
                ) : controllers.flatMap((controller) =>
                  controller.tasks.map((task) => (
                    <tr key={task.id}>
                      <td>{controller.name}</td>
                      <td>{task.name}</td>
                      <td>{task.type}</td>
                      <td>{task.periodMs != null ? `${task.periodMs} ms` : "-"}</td>
                      <td>{task.priority ?? "-"}</td>
                      <td>{task.watchdogMs != null ? `${task.watchdogMs} ms` : "-"}</td>
                      <td>
                        {task.scheduledProgramIds
                          .map((id) => programsById.get(id) ?? id)
                          .join(", ") || "-"}
                      </td>
                      <td>{task.inhibited ? "yes" : "no"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "controller" ? (
          controller ? (
            <ControllerPanel controller={controller} onToast={onToast ?? (() => {})} />
          ) : (
            <p className="esco-empty">Controller connection is unavailable.</p>
          )
        ) : (
          <p className="esco-empty">Select a dock tab.</p>
        )}
      </div>
    </div>
  );
}
