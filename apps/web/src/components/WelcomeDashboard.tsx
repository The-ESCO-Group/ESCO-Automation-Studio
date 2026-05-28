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
}

const FEATURES = [
  "Editable ladder logic (semantic AST)",
  "Offline scan-cycle simulation",
  "Studio 5000 L5X import",
  "Project export / import (.plcproj.json)",
  "Local, rule-based AI assistant",
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
}: Props) {
  const cards: Card[] = [
    { title: "Open Demo Routine", description: "Edit the seal-in motor starter ladder.", action: onOpenDemo, primary: true },
    { title: "Import L5X", description: "Load a Studio 5000 export into the project.", action: onImportL5X },
    { title: "Export Project", description: "Save the project as .plcproj.json.", action: onExport },
    { title: "AI Assistant", description: "Explain logic and generate rungs (offline).", action: onOpenAi },
    { title: "Cross Reference", description: "See where each tag is used.", action: onOpenCrossRef },
    { title: "Watch / Simulation", description: "Toggle inputs and run the scan.", action: onOpenWatch },
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
    </div>
  );
}
