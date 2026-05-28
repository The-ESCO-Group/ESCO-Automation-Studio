import type { ImportSummary } from "@esco/parser-l5x";

interface Card {
  title: string;
  description: string;
  action: () => void;
  primary?: boolean;
}

interface Props {
  onOpenDemo: () => void;
  onImportL5X: () => void;
  onExport: () => void;
  onOpenAi: () => void;
  onOpenCrossRef: () => void;
  onOpenWatch: () => void;
  onOpenTags: () => void;
  onOpenCompare: () => void;
  lastImport?: { name: string; summary: ImportSummary } | null;
}

const FEATURES = [
  "Editable ladder logic (semantic AST)",
  "Branch editing (parallel / seal-in)",
  "Offline scan-cycle simulation",
  "Studio 5000 L5X import",
  "Project export / import (.plcproj.json)",
  "Routine & project compare",
  "AI assistant (offline, LLM-ready)",
  "Tag cross-reference & validation",
];

const LIMITATIONS = [
  "Offline only — no PLC/controller communication",
  "No .ACD compile/decompile editing",
  "No L5X export yet",
  "Unsupported instructions are preserved read-only",
];

export function WelcomeDashboard({
  onOpenDemo,
  onImportL5X,
  onExport,
  onOpenAi,
  onOpenCrossRef,
  onOpenWatch,
  onOpenTags,
  onOpenCompare,
  lastImport,
}: Props) {
  const cards: Card[] = [
    { title: "Open Demo Routine", description: "Edit the seal-in motor starter ladder.", action: onOpenDemo, primary: true },
    { title: "Import L5X", description: "Load a Studio 5000 export into the project.", action: onImportL5X },
    { title: "Export Project", description: "Save the project as .plcproj.json.", action: onExport },
    { title: "Compare Projects", description: "Diff routines by logic, not just names.", action: onOpenCompare },
    { title: "AI Assistant", description: "Explain logic and generate rungs (offline).", action: onOpenAi },
    { title: "Cross Reference", description: "See where each tag is used.", action: onOpenCrossRef },
    { title: "Watch / Simulation", description: "Toggle inputs and run the scan.", action: onOpenWatch },
    { title: "Tag Table", description: "View, create, and manage tags.", action: onOpenTags },
  ];

  return (
    <div className="esco-welcome">
      <header className="esco-welcome__header">
        <h1 className="esco-welcome__title">ESCO Automation Studio</h1>
        <p className="esco-welcome__subtitle">
          A Studio 5000-style PLC engineering IDE — editable ladder, simulation, validation, and
          L5X import.
        </p>
        <p className="esco-welcome__notice">Offline simulation only. No PLC / controller communication.</p>
      </header>

      <div className="esco-welcome__cards">
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            className={`esco-card${card.primary ? " esco-card--primary" : ""}`}
            onClick={card.action}
          >
            <span className="esco-card__title">{card.title}</span>
            <span className="esco-card__desc">{card.description}</span>
          </button>
        ))}
      </div>

      <div className="esco-welcome__columns">
        <section className="esco-welcome__col">
          <h2>What it does</h2>
          <ul>
            {FEATURES.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>
        <section className="esco-welcome__col">
          <h2>Current limitations</h2>
          <ul>
            {LIMITATIONS.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      </div>

      {lastImport ? (
        <section className="esco-welcome__import">
          <h2>Last L5X import — {lastImport.name}</h2>
          <div className="esco-welcome__import-stats">
            <span>{lastImport.summary.programs} programs</span>
            <span>{lastImport.summary.routines} routines</span>
            <span>{lastImport.summary.rungs} rungs</span>
            <span>{lastImport.summary.tags} tags</span>
            <span>
              {lastImport.summary.unsupportedInstructions.length} unsupported
              {lastImport.summary.unsupportedInstructions.length
                ? `: ${lastImport.summary.unsupportedInstructions.join(", ")}`
                : ""}
            </span>
            <span>{lastImport.summary.warnings.length} warnings</span>
          </div>
          {lastImport.summary.warnings.length > 0 ? (
            <ul className="esco-welcome__import-warnings">
              {lastImport.summary.warnings.map((warning, index) => (
                <li key={index}>⚠ {warning}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
