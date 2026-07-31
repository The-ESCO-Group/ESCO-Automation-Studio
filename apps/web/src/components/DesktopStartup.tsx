import { useEffect, useState } from "react";

interface Props {
  hasBackup: boolean;
  onOpenProject: () => void;
  onNewProject: () => void;
  onImportL5X: () => void;
  onRestoreBackup: () => void;
  onContinueOffline: () => void;
}

export function DesktopStartup({
  onNewProject,
}: Props) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const holdAtZeroMs = 320;
    const fillMs = 1900;
    const startedAt = window.performance.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Math.max(0, window.performance.now() - startedAt - holdAtZeroMs);
      const ratio = Math.min(1, elapsed / fillMs);
      setProgress(Math.round(ratio * 100));
    }, 80);
    const launchTimer = window.setTimeout(() => {
      onNewProject();
    }, 2300);
    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(launchTimer);
    };
  }, [onNewProject]);

  return (
    <div className="esco-desktop-startup esco-desktop-startup--figma" role="dialog" aria-modal="true" aria-labelledby="desktop-startup-title">
      <section className="esco-desktop-startup__window" aria-label="Desktop startup" data-tauri-drag-region>
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

          <div className="esco-desktop-startup__progress" aria-label="Workspace loading progress">
            <p id="desktop-startup-title" className="esco-desktop-startup__prompt">
              INITIALIZING WORKSPACE
            </p>
            <div
              className="esco-desktop-startup__progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="esco-desktop-startup__progress-value">{progress}%</span>
          </div>
        </main>

        <footer className="esco-desktop-startup__footer">
          <span>Loading workspace...</span>
          <span>No controller connection active</span>
        </footer>
      </section>
    </div>
  );
}
