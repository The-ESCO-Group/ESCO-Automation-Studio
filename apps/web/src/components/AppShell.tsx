import type { ReactNode } from "react";

interface Props {
  startup?: boolean;
  topBar: ReactNode;
  ribbon: ReactNode;
  recovery?: ReactNode;
  toasts?: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  rightOpen?: boolean;
  onRightOpenChange?: (open: boolean) => void;
  bottomDock: ReactNode;
  statusBar: ReactNode;
}

/** Main IDE frame: app bar, ribbon, three-pane work area, dock, and status bar. */
export function AppShell({
  startup = false,
  topBar,
  ribbon,
  recovery,
  toasts,
  left,
  center,
  right,
  rightOpen = false,
  onRightOpenChange,
  bottomDock,
  statusBar,
}: Props) {
  if (startup) {
    return <div className="esco-app esco-app--startup">{toasts}</div>;
  }

  return (
    <div className="esco-app">
      {topBar}
      {ribbon}
      {toasts}
      {recovery}
      <div className={`esco-body${rightOpen ? " is-right-open" : ""}`}>
        <aside className="esco-left">{left}</aside>
        <div className="esco-main-stack">
          <main className="esco-center">{center}</main>
          <footer className="esco-bottom">{bottomDock}</footer>
        </div>
        {rightOpen ? (
          <aside className="esco-right is-open" aria-label="AI Copilot and inspector">
            <div className="esco-right__chrome">
              <span>AI Copilot</span>
              <button
                type="button"
                className="esco-right__close"
                onClick={() => onRightOpenChange?.(false)}
                aria-label="Close AI Copilot"
                title="Close AI Copilot"
              >
                ×
              </button>
            </div>
            <div className="esco-right__content">{right}</div>
          </aside>
        ) : null}
        <button
          type="button"
          className={`esco-inspector-handle${rightOpen ? " is-open" : ""}`}
          title={rightOpen ? "Hide AI Copilot" : "Show AI Copilot"}
          aria-label={rightOpen ? "Hide AI Copilot" : "Show AI Copilot"}
          onClick={() => onRightOpenChange?.(!rightOpen)}
        >
          AI
        </button>
      </div>
      {statusBar}
    </div>
  );
}
