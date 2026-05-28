import type { PlcProject } from "@esco/core";
import type { AssistantPlan, ApplyResult } from "@esco/ai-assistant";
import { collectTagReferences } from "@esco/project-actions";
import type { ValidationFinding } from "@esco/validator";
import type { WatchRow } from "../simulation";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { CrossRefPanel } from "./CrossRefPanel";

export type DockTab = "errors" | "watch" | "ai" | "xref";

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
  project: PlcProject;
  selectedRoutineId?: string;
  selectedTagName?: string;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
  onOpenRoutine: (routineId: string) => void;
}

/** The Value-column content for one watched tag, by kind. */
function WatchValue({
  row,
  onToggleTag,
  onSetNumber,
}: {
  row: WatchRow;
  onToggleTag: (name: string) => void;
  onSetNumber: (name: string, value: number) => void;
}) {
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
        <input
          className="esco-watch__number"
          type="number"
          value={Number(row.value ?? 0)}
          onChange={(event) => onSetNumber(row.name, Number(event.target.value) || 0)}
        />
      );
    }
    return <span className="esco-watch__value">{String(row.value ?? 0)}</span>;
  }

  // BOOL
  const on = row.value === true;
  return (
    <span className="esco-watch__bool">
      <span className={`esco-watch__value${on ? " is-on" : ""}`}>{on ? "true" : "false"}</span>
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
  project,
  selectedRoutineId,
  selectedTagName,
  onApplyPlan,
  onOpenRoutine,
}: Props) {
  const setTab = onTabChange;
  const xrefCount = selectedTagName ? collectTagReferences(project, selectedTagName).length : 0;

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
          Watch ({tags.length})
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
              <span className="esco-simbar__status">{running ? "Running" : "Stopped"}</span>
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
                  </tr>
                </thead>
                <tbody>
                  {tags.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.dataType}</td>
                      <td>{row.role}</td>
                      <td>
                        <WatchValue row={row} onToggleTag={onToggleTag} onSetNumber={onSetNumber} />
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
