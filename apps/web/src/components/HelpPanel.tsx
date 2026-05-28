const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl+Z", action: "Undo" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo" },
  { keys: "Enter (chat)", action: "Send prompt to the assistant" },
];

const LIMITATIONS = [
  "Offline only — no PLC / controller communication.",
  "No .ACD read, write, compile, or decompile.",
  "No L5X export yet (import is supported).",
  "Unsupported instructions are preserved read-only and not simulated.",
  "Scan-cycle simulation is an offline approximation, not exact Logix timing.",
  "No external AI key required — the assistant runs a local rule-based provider.",
];

/** Inspector Help tab: offline safety posture, shortcuts, and current limitations. */
export function HelpPanel() {
  return (
    <div className="esco-help">
      <div className="esco-help__heading">Safety</div>
      <p className="esco-help__notice">
        ESCO Automation Studio is an offline internal engineering tool. It reads and edits project
        models locally and never communicates with a controller. Generated changes are previews you
        review and apply through the controlled action layer — verify all logic in a sandbox project
        before any production use.
      </p>

      <div className="esco-help__heading">Shortcuts</div>
      <dl className="esco-props">
        {SHORTCUTS.map((s) => (
          <div className="esco-props__row" key={s.action}>
            <dt>{s.keys}</dt>
            <dd>{s.action}</dd>
          </div>
        ))}
      </dl>

      <div className="esco-help__heading">Current limitations</div>
      <ul className="esco-help__list">
        {LIMITATIONS.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
  );
}
