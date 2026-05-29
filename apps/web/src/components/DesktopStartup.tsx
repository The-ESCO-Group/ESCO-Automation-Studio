interface Props {
  hasBackup: boolean;
  onOpenProject: () => void;
  onNewProject: () => void;
  onImportL5X: () => void;
  onRestoreBackup: () => void;
  onSignIn: () => void;
  onContinueOffline: () => void;
}

export function DesktopStartup({
  hasBackup,
  onOpenProject,
  onNewProject,
  onImportL5X,
  onRestoreBackup,
  onSignIn,
  onContinueOffline,
}: Props) {
  return (
    <div className="esco-desktop-startup" role="dialog" aria-modal="true" aria-labelledby="desktop-startup-title">
      <section className="esco-desktop-startup__window" aria-label="Desktop startup">
        <header className="esco-desktop-startup__header">
          <div className="esco-desktop-startup__brand">
            <span className="esco-desktop-startup__app-mark" aria-hidden="true">
              <span />
            </span>
            <span className="esco-desktop-startup__brand-text">
              <strong>ESCO Automation Studio</strong>
              <span>PLC ENGINEERING IDE</span>
            </span>
          </div>
        </header>

        <main className="esco-desktop-startup__body">
          <div className="esco-desktop-startup__wordmark" aria-label="Scintilla ESCO Group">
            <span className="esco-desktop-startup__flame" aria-hidden="true" />
            <span className="esco-desktop-startup__mark-copy">
              <span className="esco-desktop-startup__scintilla">SCINTILLA</span>
              <span className="esco-desktop-startup__mark-rule" aria-hidden="true" />
              <span className="esco-desktop-startup__esco">
                <span>ESCO</span>
                <span>GROUP</span>
              </span>
            </span>
          </div>

          <span className="esco-desktop-startup__divider" aria-hidden="true" />
          <p id="desktop-startup-title" className="esco-desktop-startup__prompt">
            Sign in to continue
          </p>

          <button type="button" className="esco-desktop-startup__signin" onClick={onSignIn}>
            <span className="esco-desktop-startup__ms-icon" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span>Sign in with Microsoft</span>
          </button>

          <button type="button" className="esco-desktop-startup__offline" onClick={onContinueOffline}>
            Continue offline
          </button>

          <nav className="esco-desktop-startup__actions" aria-label="Startup project actions">
            <button type="button" onClick={onOpenProject}>Open Project</button>
            <span aria-hidden="true">.</span>
            <button type="button" onClick={onNewProject}>New Project</button>
            <span aria-hidden="true">.</span>
            <button type="button" onClick={onImportL5X}>Import L5X</button>
            <span aria-hidden="true">.</span>
            <button
              type="button"
              className={hasBackup ? "" : "is-empty"}
              title={hasBackup ? "Restore autosaved work" : "No autosaved backup found"}
              onClick={onRestoreBackup}
            >
              Restore Backup
            </button>
          </nav>
        </main>

        <footer className="esco-desktop-startup__footer">
          <span>Workspace ready</span>
          <span>No controller connection active</span>
        </footer>
      </section>
    </div>
  );
}
