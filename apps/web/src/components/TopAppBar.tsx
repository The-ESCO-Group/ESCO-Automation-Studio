interface Props {
  projectName: string;
  projectOpen: boolean;
  dirty: boolean;
  lastExportedAt: string | null;
  openRoutineName?: string;
  validationLabel: string;
  validationClass: string;
  userLabel: string;
  userInitials: string;
  onHome: () => void;
  onOpenSettings: () => void;
}

function exportedLabel(lastExportedAt: string | null): string {
  if (!lastExportedAt) return "Saved";
  return `Exported ${new Date(lastExportedAt).toLocaleTimeString()}`;
}

/** Premium light IDE top bar with project context and offline simulation status. */
export function TopAppBar({
  projectName,
  projectOpen,
  dirty,
  lastExportedAt,
  openRoutineName,
  validationLabel,
  validationClass,
  userLabel,
  userInitials,
  onHome,
  onOpenSettings,
}: Props) {
  return (
    <header className="esco-titlebar">
      <div className="esco-titlebar__brand">
        <button type="button" className="esco-titlebar__home" title="Dashboard" onClick={onHome}>
          <span className="esco-titlebar__logo" aria-hidden="true">E</span>
          <span className="esco-titlebar__name">ESCO AUTOMATION STUDIO</span>
        </button>
      </div>

      <div className="esco-titlebar__context">
        <label className="esco-project-select" title="Project">
          <span className="esco-project-select__icon" aria-hidden="true">⌂</span>
          <select className="esco-titlebar__project" value={projectName} onChange={() => undefined}>
            <option value={projectName}>{projectName}</option>
          </select>
        </label>
        <span className="esco-badge esco-badge--offline" title="No PLC/controller communication">
          Disconnected
        </span>
        {projectOpen ? (
          <>
            <span
              className={`esco-titlebar__saved ${dirty ? "is-dirty" : "is-saved"}`}
              title={
                dirty
                  ? "Unsaved changes are autosaved locally; export to save to a file"
                  : lastExportedAt
                    ? `Exported at ${new Date(lastExportedAt).toLocaleTimeString()}`
                    : "No unsaved changes"
              }
            >
              {dirty ? "Unsaved" : exportedLabel(lastExportedAt)}
            </span>
            {openRoutineName ? <span className="esco-titlebar__routine">{openRoutineName}</span> : null}
            <span className={`esco-titlebar__validation ${validationClass}`} title="Verification status">
              {validationLabel}
            </span>
          </>
        ) : null}
      </div>

      <div className="esco-titlebar__right">
        <label className="esco-search" title="Search">
          <span aria-hidden="true">⌕</span>
          <input placeholder="Search (Ctrl+K)" spellCheck={false} />
        </label>
        <button type="button" className="esco-icon-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
        <button type="button" className="esco-icon-btn" title="Notifications" aria-label="Notifications">
          !
        </button>
        <button type="button" className="esco-user esco-user--button" title="Profile setup" onClick={onOpenSettings}>
          <span className="esco-user__avatar" aria-hidden="true">{userInitials}</span>
          <span className="esco-user__meta">
            <span className="esco-user__role">{userLabel}</span>
          </span>
        </button>
      </div>
    </header>
  );
}
