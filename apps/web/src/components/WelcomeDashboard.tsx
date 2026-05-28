import type { ImportSummary } from "@esco/parser-l5x";

interface Props {
  onCreateRoutine: () => void;
  onImportL5X: () => void;
  onExport: () => void;
  onOpenAi: () => void;
  onOpenCrossRef: () => void;
  onOpenWatch: () => void;
  onOpenTags: () => void;
  onOpenCompare: () => void;
  lastImport?: { name: string; summary: ImportSummary } | null;
}

const WELCOME_TOOLS = ["←", "→", "▣", "⊢", "⊣", "+", "─", "┬", "┴", "↔", "▦", "□", "⌬", "⌘"];

export function WelcomeDashboard({
  onCreateRoutine,
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
        </div>
      </div>
    </div>
  );
}
