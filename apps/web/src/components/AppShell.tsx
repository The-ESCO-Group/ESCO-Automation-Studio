import type { ReactNode } from "react";

export interface ActivityRailItem {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onClick: () => void;
}

interface Props {
  topBar: ReactNode;
  ribbon: ReactNode;
  recovery?: ReactNode;
  toasts?: ReactNode;
  activityItems: ActivityRailItem[];
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  bottomDock: ReactNode;
  statusBar: ReactNode;
}

/** Main IDE frame: app bar, ribbon, three-pane work area, dock, and status bar. */
export function AppShell({
  topBar,
  ribbon,
  recovery,
  toasts,
  activityItems,
  left,
  center,
  right,
  bottomDock,
  statusBar,
}: Props) {
  return (
    <div className="esco-app">
      {topBar}
      {ribbon}
      {toasts}
      {recovery}
      <div className="esco-body">
        <nav className="esco-activity-rail" aria-label="Workspace views">
          {activityItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`esco-activity-rail__button${item.active ? " is-active" : ""}`}
              title={item.label}
              aria-label={item.label}
              onClick={item.onClick}
            >
              <span aria-hidden="true">{item.icon}</span>
            </button>
          ))}
        </nav>
        <aside className="esco-left">{left}</aside>
        <div className="esco-main-stack">
          <main className="esco-center">{center}</main>
          <footer className="esco-bottom">{bottomDock}</footer>
        </div>
        <aside className="esco-right">{right}</aside>
      </div>
      {statusBar}
    </div>
  );
}
