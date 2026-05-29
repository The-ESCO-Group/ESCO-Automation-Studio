import type { ControllerSessionApi } from "../controller-session";

interface Props {
  controller: ControllerSessionApi;
  onToast: (kind: "info" | "success" | "warning" | "error", message: string) => void;
}

const STATE_CLASS: Record<string, string> = {
  "offline-simulation": "is-sim",
  "model-only": "is-model-only",
  disconnected: "is-disconnected",
  "connecting-disabled": "is-blocked",
  connecting: "is-connecting",
  "connected-unavailable": "is-blocked",
  "connected-readonly": "is-connected",
  "connected-monitor": "is-connected",
  faulted: "is-error",
  "safety-blocked": "is-blocked",
};

/**
 * Controller connection panel. Surfaces the connection state machine and the
 * guarded upload/download/online-edit commands. Every real action is visible as
 * a safe blocked placeholder: there is no tested controller transport in this
 * build, so the safety gate keeps the session in Offline Simulation /
 * Model-only / Unavailable / Safety Blocked. Nothing here ever writes to a
 * controller.
 */
export function ControllerPanel({ controller, onToast }: Props) {
  const { snapshot, audit, commands, goOnlineSimulation, requestRealReadonly, goOffline, monitor, runCommand } =
    controller;

  const run = (command: (typeof commands)[number]["command"]) => {
    const result = runCommand(command);
    if (result.outcome === "blocked") {
      onToast("warning", `${command.label} is blocked: ${result.message}`);
    } else {
      onToast("success", result.message);
    }
  };

  return (
    <div className="esco-controller">
      <div className="esco-dockbar">
        <span className="esco-controller__state">
          Connection:{" "}
          <strong className={`esco-conn-badge ${STATE_CLASS[snapshot.state] ?? ""}`}>{snapshot.stateLabel}</strong>
          <span className="esco-dockbar__muted"> via {snapshot.transportName}</span>
        </span>
        <div className="esco-dockbar__actions">
          <button type="button" className="esco-btn" onClick={goOnlineSimulation}>
            Go Online (Simulation)
          </button>
          <button type="button" className="esco-btn" onClick={requestRealReadonly} title="Check whether a verified hardware link is available">
            Check Hardware Link
          </button>
          <button type="button" className="esco-btn" onClick={monitor} disabled={!snapshot.connected}>
            Monitor
          </button>
          <button type="button" className="esco-btn" onClick={goOffline}>
            Go Offline
          </button>
        </div>
      </div>

      <p className="esco-controller__notice">
        This build has <strong>no tested controller transport</strong>. Hardware Go Online, upload, download,
        and online edits are intentionally blocked. Offline Simulation and model-only review never communicate
        with a controller.
      </p>

      <div className="esco-controller__commands">
        {commands.map(({ command, blocked, explanation }) => (
          <div key={command.kind} className={`esco-controller__cmd${blocked ? " is-blocked" : ""}`}>
            <div className="esco-controller__cmdhead">
              <span className="esco-controller__cmdlabel">{command.label}</span>
              {blocked ? <span className="esco-pill esco-pill--blocked">Blocked</span> : <span className="esco-pill">Available</span>}
            </div>
            <p className="esco-controller__cmddesc">{command.description}</p>
            <div className="esco-controller__cmdfoot">
              <button
                type="button"
                className={`esco-btn${blocked ? " esco-btn--blocked" : " esco-btn--primary"}`}
                title={explanation}
                onClick={() => run(command)}
              >
                {blocked ? "Show safety block" : command.label}
              </button>
              {blocked ? <span className="esco-controller__why">{explanation}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="esco-controller__audit">
        <h4>Connection audit ({audit.length})</h4>
        {audit.length === 0 ? (
          <p className="esco-empty">No connection events yet. Go Online or attempt a guarded command.</p>
        ) : (
          <table className="esco-diagnostics__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>State</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {audit
                .slice()
                .reverse()
                .map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.at).toLocaleTimeString()}</td>
                    <td>{event.type}</td>
                    <td>{event.state}</td>
                    <td>{event.summary}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
