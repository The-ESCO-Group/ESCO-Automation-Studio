import type { PlcProject } from "@esco/core";
import type { AssistantPlan, ApplyResult } from "@esco/ai-assistant";
import { collectTagReferences } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { Forces, TraceEntry, WatchRow } from "../simulation";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { CrossRefPanel } from "./CrossRefPanel";

export type DockTab = "errors" | "watch" | "trace" | "ai" | "xref";

interface Props {
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
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
  selectedRoutineId?: string;
  selectedTagName?: string;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
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
  selectedRoutineId,
  selectedTagName,
  onApplyPlan,
  onOpenRoutine,
}: Props) {
  const setTab = onTabChange;
  const xrefCount = selectedTagName ? collectTagReferences(project, selectedTagName).length : 0;
  const forceCount = Object.keys(forces).length;

  return (
    <div className="esco-dock">
      <div className="esco-dock__tabs">
        <button
          type="button"
          className={`esco-dock__tab${tab === "errors" ? " is-active" : ""}`}
          onClick={() => setTab("errors")}
        >
          Errors ({findings.length})
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
          className={`esco-dock__tab${tab === "trace" ? " is-active" : ""}`}
          onClick={() => setTab("trace")}
        >
          Trace ({trace.length})
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "ai" ? " is-active" : ""}`}
          onClick={() => setTab("ai")}
        >
          AI Assistant
        </button>
        <button
          type="button"
          className={`esco-dock__tab${tab === "xref" ? " is-active" : ""}`}
          onClick={() => setTab("xref")}
        >
          Cross Ref{selectedTagName ? ` (${xrefCount})` : ""}
        </button>
      </div>

      <div className="esco-dock__body">
        {tab === "errors" ? (
          findings.length === 0 ? (
            <p className="esco-empty">No validation findings.</p>
          ) : (
            <ul className="esco-findings">
              {findings.map((finding, index) => (
                <li
                  key={`${finding.ruleId}-${index}`}
                  className={`esco-finding esco-finding--${finding.severity}`}
                >
                  <span className="esco-finding__severity">{finding.severity}</span>
                  <span className="esco-finding__message">{finding.message}</span>
                  {finding.target ? (
                    <span className="esco-finding__target">{finding.target}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )
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
                    <th>Type</th>
                    <th>Role</th>
                    <th>Value</th>
                    <th>Force</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((row) => {
                    const forced = row.name in forces;
                    return (
                      <tr key={row.name} className={forced ? "is-forced" : undefined}>
                        <td>{row.name}</td>
                        <td>{row.dataType}</td>
                        <td>{row.role}</td>
                        <td>
                          <WatchValue
                            row={row}
                            forced={forced}
                            onToggleTag={onToggleTag}
                            onSetNumber={onSetNumber}
                          />
                        </td>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
        ) : tab === "ai" ? (
          <AiAssistantPanel
            project={project}
            selectedRoutineId={selectedRoutineId}
            onApply={onApplyPlan}
          />
        ) : (
          <CrossRefPanel
            project={project}
            selectedTagName={selectedTagName}
            onOpenRoutine={onOpenRoutine}
          />
        )}
      </div>
    </div>
  );
}
