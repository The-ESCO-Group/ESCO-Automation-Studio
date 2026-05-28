import { useState } from "react";
import type { ValidationFinding } from "@esco/validator";
import type { WatchRow } from "../simulation";

interface Props {
  findings: ValidationFinding[];
  tags: WatchRow[];
  running: boolean;
  onToggleTag: (name: string) => void;
  onScanOnce: () => void;
  onReset: () => void;
  onToggleRun: () => void;
}

type Tab = "errors" | "watch";

export function BottomPanel({
  findings,
  tags,
  running,
  onToggleTag,
  onScanOnce,
  onReset,
  onToggleRun,
}: Props) {
  const [tab, setTab] = useState<Tab>("watch");

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
        ) : (
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
              <p className="esco-empty">No BOOL tags in the project.</p>
            ) : (
              <table className="esco-watch">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => (
                    <tr key={tag.name}>
                      <td>{tag.name}</td>
                      <td>{tag.dataType}</td>
                      <td>{tag.role}</td>
                      <td>
                        <span className={`esco-watch__value${tag.value ? " is-on" : ""}`}>
                          {tag.value ? "true" : "false"}
                        </span>
                      </td>
                      <td>
                        {tag.role === "input" ? (
                          <button
                            type="button"
                            className={`esco-btn esco-btn--toggle${tag.value ? " is-on" : ""}`}
                            onClick={() => onToggleTag(tag.name)}
                          >
                            Toggle
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
