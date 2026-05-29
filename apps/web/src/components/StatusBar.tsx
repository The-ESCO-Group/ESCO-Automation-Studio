interface Props {
  projectOpen: boolean;
  controllerName?: string;
  programName?: string;
  routineName?: string;
  verificationLabel: string;
  verificationClass: string;
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
  connectionLabel = "Offline Simulation",
  connected = false,
}: Props) {
  return (
    <div className="esco-statusbar">
      <span>Controller: <strong>{projectOpen ? controllerName ?? "--" : "--"}</strong></span>
      <span className={`esco-statusbar__connection${connected ? " is-connected" : ""}`}>{connectionLabel}</span>
      <span>Program: <strong>{projectOpen ? programName ?? "--" : "--"}</strong></span>
      <span>Routine: <strong>{projectOpen ? routineName ?? "--" : "--"}</strong></span>
      <span className={`esco-statusbar__verify ${verificationClass}`}>{projectOpen ? verificationLabel : "Ready"}</span>
      <span>INS</span>
      <span>Ln 1, Col 1</span>
      <span>Zoom 100%</span>
    </div>
  );
}
