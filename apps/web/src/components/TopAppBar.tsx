import { controlDesktopWindow, type DesktopWindowAction } from "../desktop-runtime";

interface Props {
  projectName: string;
  projectOpen: boolean;
  dirty: boolean;
  lastExportedAt: string | null;
  openRoutineName?: string;
  validationLabel: string;
  validationClass: string;
  connectionLabel: string;
  connected: boolean;
  controllerCatalog?: string;
  controllerRevision?: string;
  userLabel: string;
  userInitials: string;
  onHome: () => void;
  onOpenSettings: () => void;
  onOpenController: () => void;
  onOpenDiagnostics: () => void;
}

const WINDOW_CONTROLS: ReadonlyArray<{
  action: DesktopWindowAction;
  className: string;
  label: string;
}> = [
  { action: "minimize", className: "esco-window-control--minimize", label: "Minimize" },
  { action: "toggle-maximize", className: "esco-window-control--maximize", label: "Maximize" },
  { action: "close", className: "esco-window-control--close", label: "Close" },
];

function titleLabel(
  projectName: string,
  projectOpen: boolean,
  dirty: boolean,
  controllerRevision?: string,
): string {
  if (!projectOpen) return "ESCO Automation Studio";
  const revision = controllerRevision?.trim() || "36.11";
  return `ESCO Automation Studio - ${projectName} [Offline Model FW ${revision}]${dirty ? "*" : ""}`;
}

function projectTabLabel(projectName: string, projectOpen: boolean): string {
  return projectOpen ? projectName : "ESCO Automation Studio";
}

/** Classic PLC-programmer title bar with project context and offline simulation status. */
export function TopAppBar({
  projectName,
  projectOpen,
  dirty,
  lastExportedAt,
  openRoutineName,
  validationLabel,
  validationClass,
  connectionLabel,
  connected,
  controllerCatalog,
  controllerRevision,
  userLabel,
  userInitials,
  onHome,
  onOpenSettings,
  onOpenController,
  onOpenDiagnostics,
}: Props) {
  const caption = titleLabel(projectName, projectOpen, dirty, controllerRevision);
  const tabLabel = projectTabLabel(projectName, projectOpen);
  const saveTitle = dirty
    ? "Unsaved edits are pending"
    : lastExportedAt
      ? `Last saved/exported ${lastExportedAt}`
      : "No saved export timestamp yet";
  const controllerTitle = controllerCatalog
    ? `${controllerCatalog}: ${connectionLabel}`
    : connectionLabel;

  return (
    <header className="esco-titlebar" data-tauri-drag-region>
      <div className="esco-titlebar__tabstrip" role="tablist" aria-label="Workspace tabs">
        <button type="button" className="esco-shell-tab esco-shell-tab--home" role="tab" aria-selected="false" onClick={onHome}>
          <span className="esco-shell-tab__home-icon" aria-hidden="true" />
          <span className="esco-shell-tab__label">Home</span>
          <span className="esco-shell-tab__close" aria-hidden="true" />
        </button>
        <button type="button" className="esco-shell-tab is-active" role="tab" aria-selected="true" title={caption}>
          <span className="esco-shell-tab__project-icon" aria-hidden="true" />
          <span className="esco-shell-tab__label">{tabLabel}</span>
          <span className="esco-shell-tab__close" aria-hidden="true" />
        </button>
      </div>

      <div className="esco-titlebar__caption" data-tauri-drag-region>
        <div className="esco-titlebar__brand">
          <button type="button" className="esco-titlebar__home" title={caption} onClick={onHome}>
            <span className="esco-titlebar__logo" aria-hidden="true">PLC</span>
            <span className="esco-titlebar__name">{caption}</span>
          </button>
        </div>

        <div className="esco-titlebar__right">
          <div className="esco-titlebar__command-strip" aria-label="Title bar command status">
            <button
              type="button"
              className={`esco-titlebar__command-chip${connected ? " is-connected" : ""}`}
              title={controllerTitle}
              onClick={onOpenController}
            >
              {connectionLabel}
            </button>
            <button
              type="button"
              className={`esco-titlebar__command-chip ${validationClass}`}
              title="Open diagnostics"
              onClick={onOpenDiagnostics}
            >
              {validationLabel}
            </button>
            {openRoutineName ? (
              <span className="esco-titlebar__command-chip" title={`Open routine: ${openRoutineName}`}>
                {openRoutineName}
              </span>
            ) : null}
            <span className={`esco-titlebar__command-chip${dirty ? " is-dirty" : " is-saved"}`} title={saveTitle}>
              {dirty ? "Unsaved" : "Saved"}
            </span>
            <button
              type="button"
              className="esco-titlebar__user-chip"
              title={`Settings for ${userLabel}`}
              aria-label={`Open settings for ${userLabel}`}
              onClick={onOpenSettings}
            >
              {userInitials}
            </button>
          </div>
          <div className="esco-window-controls" aria-label="Window controls">
            {WINDOW_CONTROLS.map((control) => (
              <button
                key={control.action}
                type="button"
                className={`esco-window-control ${control.className}`}
                aria-label={control.label}
                title={control.label}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void controlDesktopWindow(control.action).catch(() => undefined);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
