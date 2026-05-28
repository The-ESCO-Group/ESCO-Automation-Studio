interface Props {
  projectOpen: boolean;
  controllerName?: string;
  programName?: string;
  routineName?: string;
  verificationLabel: string;
  verificationClass: string;
}

/** Bottom IDE status bar. All connection language stays offline/simulation-safe. */
export function StatusBar({
  projectOpen,
  controllerName,
  programName,
  routineName,
  verificationLabel,
  verificationClass,
}: Props) {
  return (
    <div className="esco-statusbar">
      <span>Controller: <strong>{projectOpen ? controllerName ?? "--" : "--"}</strong></span>
      <span className="esco-statusbar__connection">Disconnected</span>
      <span>Program: <strong>{projectOpen ? programName ?? "--" : "--"}</strong></span>
      <span>Routine: <strong>{projectOpen ? routineName ?? "--" : "--"}</strong></span>
      <span className={`esco-statusbar__verify ${verificationClass}`}>{projectOpen ? verificationLabel : "Ready"}</span>
      <span>INS</span>
      <span>Ln 1, Col 1</span>
      <span>Zoom 100%</span>
    </div>
  );
}
