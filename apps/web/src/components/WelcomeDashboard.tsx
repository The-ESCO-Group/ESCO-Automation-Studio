import type { ImportSummary } from "@esco/parser-l5x";
import type { RecentProjectEntry } from "../recent-projects";

interface Props {
  onCreateRoutine: () => void;
  onImportProject: () => void;
  onImportL5X: () => void;
  onExport: () => void;
  onOpenAi: () => void;
  onOpenCrossRef: () => void;
  onOpenWatch: () => void;
  onOpenTags: () => void;
  onOpenCompare: () => void;
  projectOpen: boolean;
  recentProjects: RecentProjectEntry[];
  lastImport?: { name: string; summary: ImportSummary } | null;
}

const WELCOME_TOOLS = ["←", "→", "▣", "⊢", "⊣", "+", "─", "┬", "┴", "↔", "▦", "□", "⌬", "⌘"];

export function WelcomeDashboard({
  onCreateRoutine,
  onImportProject,
  onImportL5X,
  onExport,
  onOpenAi,
  onOpenCrossRef,
  onOpenWatch,
  onOpenTags,
  onOpenCompare,
  projectOpen,
  recentProjects,
  lastImport,
}: Props) {
  return (
    <div className="esco-welcome">
      <div className="esco-welcome__tabs">
        <button type="button" className="esco-welcome__tab is-active">Welcome</button>
        <button type="button" className="esco-welcome__tab esco-welcome__tab--add" disabled>+</button>
      </div>
      <div className="esco-welcome__toolbar" aria-label="Welcome editor toolbar">
        {WELCOME_TOOLS.map((tool, index) => (
          <button key={`${tool}-${index}`} type="button" className="esco-welcome__tool" disabled>
            {tool}
          </button>
        ))}
        <span className="esco-welcome__zoom">100%</span>
      </div>
      <div className="esco-welcome__canvas">
        <div className="esco-welcome__empty-card">
          <div className="esco-welcome__ladder-icon" aria-hidden="true">
            <span />
            <span />
          </div>
          <h1>No routine open</h1>
          <p>Open a project or create a new routine to get started.</p>
          <button type="button" className="esco-btn esco-btn--primary" onClick={onCreateRoutine}>
            Create New Routine
          </button>
          <div className="esco-welcome__primary-actions">
            <button type="button" className="esco-btn" onClick={onImportProject}>
              Open Project
            </button>
            <button type="button" className="esco-btn" onClick={onImportL5X}>
              Import L5X
            </button>
          </div>
        </div>

        <section className="esco-welcome__quick-panel" aria-label="Project shortcuts">
          <div className="esco-welcome__quick-head">
            <strong>Workstation</strong>
            <span>Offline Simulation</span>
          </div>
          <div className="esco-welcome__quick-grid">
            <button type="button" className="esco-btn" disabled={!projectOpen} onClick={onExport}>
              Save As
            </button>
            <button type="button" className="esco-btn" disabled={!projectOpen} onClick={onOpenTags}>
              Tags
            </button>
            <button type="button" className="esco-btn" disabled={!projectOpen} onClick={onOpenCompare}>
              Compare
            </button>
            <button type="button" className="esco-btn" onClick={onOpenWatch}>
              Watch
            </button>
            <button type="button" className="esco-btn" onClick={onOpenCrossRef}>
              References
            </button>
            <button type="button" className="esco-btn" onClick={onOpenAi}>
              AI Copilot
            </button>
          </div>
          {lastImport ? (
            <p className="esco-welcome__last-import">
              Last L5X import: {lastImport.name} ({lastImport.summary.routines} routine
              {lastImport.summary.routines === 1 ? "" : "s"}, {lastImport.summary.tags} tag
              {lastImport.summary.tags === 1 ? "" : "s"}).
            </p>
          ) : null}
        </section>

        {recentProjects.length > 0 ? (
          <section className="esco-welcome__recent" aria-label="Recent projects">
            <div className="esco-welcome__quick-head">
              <strong>Recent Projects</strong>
              <span>metadata only</span>
            </div>
            <ul>
              {recentProjects.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{entry.fileName ?? entry.source}</small>
                  </span>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleDateString()}</time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
