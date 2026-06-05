import { type KeyboardEvent, type ReactNode } from "react";

interface Props {
  projectOpen: boolean;
  controllerName?: string;
  verificationLabel: string;
  verificationClass: string;
  errorCount?: number;
  warningCount?: number;
  running?: boolean;
  selectedRungLabel?: string;
  path?: string;
  /** Live connection state label from the controller session (e.g. "Offline Simulation"). */
  connectionLabel?: string;
  /** True only when a real controller link is established (never in this build). */
  connected?: boolean;
  /** ESCO Virtual Controller state label (e.g. "Online (Virtual)"), when a session is active. */
  virtualStateLabel?: string;
  /** ESCO Virtual Controller mode label (e.g. "Program", "Run"). */
  virtualModeLabel?: string;
  /** True when the ESCO Virtual Controller session is online. */
  virtualOnline?: boolean;
  /** Offline edit-review state of the open routine. */
  editState?: "none" | "test" | "assembled" | "finalized" | "canceled";
  onOpenController?: () => void;
  onOpenDiagnostics?: () => void;
  onBrowsePath?: () => void;
}

/** Bottom IDE status bar. All connection language stays offline/simulation-safe. */
function rungNumberLabel(selectedRungLabel?: string): string {
  if (!selectedRungLabel) return "--";
  const raw = selectedRungLabel.replace(/^Rung\s+/, "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : raw || "--";
}

function runOnKeyboard(event: KeyboardEvent<HTMLElement>, action?: () => void) {
  if (!action || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  action();
}

function editStateLabel(editState: NonNullable<Props["editState"]>): string | undefined {
  if (editState === "test") return "Pending Test";
  if (editState === "assembled") return "Assembled";
  if (editState === "finalized") return "Finalized";
  if (editState === "canceled") return "Canceled";
  return undefined;
}

function StatusSegment({
  className,
  children,
  title,
  onClick,
}: {
  className: string;
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <span
      className={className}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(event) => runOnKeyboard(event, onClick)}
    >
      {children}
    </span>
  );
}

export function StatusBar({
  projectOpen,
  controllerName,
  verificationLabel,
  verificationClass,
  errorCount = 0,
  warningCount = 0,
  running = false,
  selectedRungLabel,
  path = "No hardware path selected",
  connectionLabel = "Offline Simulation",
  connected = false,
  virtualStateLabel,
  virtualModeLabel,
  virtualOnline = false,
  editState = "none",
  onOpenController,
  onOpenDiagnostics,
  onBrowsePath,
}: Props) {
  const rung = rungNumberLabel(selectedRungLabel);
  const controllerMode = !projectOpen ? "--" : connected ? "Run" : running ? "Offline Run" : "Offline";
  const connectionText = projectOpen ? connectionLabel : "No Project";
  const issueText =
    errorCount > 0
      ? `${errorCount} Error${errorCount === 1 ? "" : "s"}`
      : warningCount > 0
        ? `${warningCount} Warning${warningCount === 1 ? "" : "s"}`
        : "0 Errors";
  const connectionTitle = controllerName
    ? `${controllerName}: ${connectionText}`
    : connectionText;
  const editsLabel = editStateLabel(editState);

  return (
    <div className="esco-statusbar">
      <StatusSegment
        className={`esco-statusbar__connection${connected ? " is-connected" : ""}`}
        title={connectionTitle}
        onClick={projectOpen ? onOpenController : undefined}
      >
        {connectionText}
      </StatusSegment>
      <span className="esco-statusbar__spacer" />
      <StatusSegment
        className={`esco-statusbar__run${running || connected ? " is-running" : ""}`}
        title="Open controller status"
        onClick={projectOpen ? onOpenController : undefined}
      >
        Controller Mode: {controllerMode}
      </StatusSegment>
      {projectOpen && virtualStateLabel ? (
        <StatusSegment
          className={`esco-statusbar__vctrl${virtualOnline ? " is-online" : ""}`}
          title="ESCO Virtual Controller session"
          onClick={onOpenController}
        >
          Virtual: {virtualStateLabel}
          {virtualModeLabel ? ` · ${virtualModeLabel}` : ""}
        </StatusSegment>
      ) : null}
      <StatusSegment className="esco-statusbar__rung" title={selectedRungLabel ?? "No rung selected"}>
        Rung: {rung}
      </StatusSegment>
      {projectOpen && editsLabel ? (
        <StatusSegment
          className={`esco-statusbar__edits is-${editState}`}
          title="Offline online-edit review state for the open routine"
        >
          Edits: {editsLabel}
        </StatusSegment>
      ) : null}
      <StatusSegment
        className={`esco-statusbar__verify ${verificationClass}`}
        title="Open diagnostics"
        onClick={projectOpen ? onOpenDiagnostics : undefined}
      >
        {verificationLabel} ({issueText})
      </StatusSegment>
      <StatusSegment className="esco-statusbar__language" title="Ladder Diagram editor">
        Language: Ladder Diagram (LD)
      </StatusSegment>
      <StatusSegment
        className="esco-statusbar__path"
        title="Hardware path browse is unsupported in this build; virtual paths are simulation-only."
        onClick={projectOpen ? onBrowsePath : undefined}
      >
        Path: {path}
      </StatusSegment>
    </div>
  );
}
