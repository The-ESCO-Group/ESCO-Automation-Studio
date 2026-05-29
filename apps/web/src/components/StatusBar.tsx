interface Props {
  projectOpen: boolean;
  controllerName?: string;
  programName?: string;
  routineName?: string;
  verificationLabel: string;
  verificationClass: string;
  errorCount?: number;
  warningCount?: number;
  running?: boolean;
  selectedRungLabel?: string;
  /** Live connection state label from the controller session (e.g. "Offline Simulation"). */
  connectionLabel?: string;
  /** True only when a real controller link is established (never in this build). */
  connected?: boolean;
}

/** Bottom IDE status bar. All connection language stays offline/simulation-safe. */
export function StatusBar({
  projectOpen,
  controllerName,
  programName,
  routineName,
  verificationLabel,
  verificationClass,
  errorCount = 0,
  warningCount = 0,
  running = false,
  selectedRungLabel,
  connectionLabel = "Offline Simulation",
  connected = false,
}: Props) {
  return (
    <div className="esco-statusbar">
      <span className="esco-statusbar__project">
        <strong>{projectOpen ? controllerName ?? "--" : "--"}</strong>
      </span>
      <span className={`esco-statusbar__run${running ? " is-running" : ""}`}>
        {running ? "RUN" : "IDLE"}
      </span>
      <span className={`esco-statusbar__verify ${verificationClass}`}>
        {projectOpen ? verificationLabel : "Ready"}
      </span>
      <span className="esco-statusbar__error">{errorCount} error{errorCount === 1 ? "" : "s"}</span>
      <span className="esco-statusbar__warning">{warningCount} warning{warningCount === 1 ? "" : "s"}</span>
      <span>{running ? "Sim scan active" : "Sim scan idle"}</span>
      <span>{selectedRungLabel ?? "Rung --"}</span>
      <span>Zoom 100%</span>
      <span className={`esco-statusbar__connection${connected ? " is-connected" : ""}`}>{connectionLabel}</span>
      <span className="esco-statusbar__spacer" />
      <span>{programName ?? "--"}</span>
      <span>{routineName ?? "--"}</span>
      <span className="esco-statusbar__ready">Ready</span>
    </div>
  );
}
