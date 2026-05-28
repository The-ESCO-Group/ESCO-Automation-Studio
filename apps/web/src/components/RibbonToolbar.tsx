import type { DockTab } from "./BottomPanel";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  canCopy: boolean;
  onHome: () => void;
  onTags: () => void;
  onCompare: () => void;
  onExport: () => void;
  onImportProject: () => void;
  onImportL5X: () => void;
  onNew: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onFind: () => void;
  onProperties: () => void;
  onDockTab: (tab: DockTab) => void;
  onToast: (message: string) => void;
  onVerify: () => void;
}

const TABS = ["Home", "Edit", "View", "Project", "Logic", "Build", "Online", "Tools", "Window", "Help"];

interface RibbonButton {
  label: string;
  icon: string;
  group: string;
  title?: string;
  disabled?: boolean;
  action: () => void;
}

/** Studio-style command ribbon. Buttons are offline-safe UI commands. */
export function RibbonToolbar({
  canUndo,
  canRedo,
  canPaste,
  canCopy,
  onHome,
  onTags,
  onCompare,
  onExport,
  onImportProject,
  onImportL5X,
  onNew,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onFind,
  onProperties,
  onDockTab,
  onToast,
  onVerify,
}: Props) {
  const placeholder = (label: string) => () => onToast(`${label} is a UI placeholder in Offline Simulation.`);
  const buttons: RibbonButton[] = [
    { label: "New", icon: "+", group: "File", title: "New blank project", action: onNew },
    { label: "Open", icon: "□", group: "File", action: onImportProject },
    { label: "Save", icon: "▣", group: "File", action: onExport },
    { label: "Save All", icon: "▤", group: "File", action: onExport },
    { label: "Print", icon: "⌘", group: "File", action: placeholder("Print") },
    { label: "Undo", icon: "↶", group: "Edit", disabled: !canUndo, action: onUndo },
    { label: "Redo", icon: "↷", group: "Edit", disabled: !canRedo, action: onRedo },
    { label: "Cut", icon: "✂", group: "Edit", disabled: !canCopy, title: "Cut selected rung", action: onCut },
    { label: "Copy", icon: "⧉", group: "Edit", disabled: !canCopy, title: "Copy selected rung", action: onCopy },
    { label: "Paste", icon: "▥", group: "Edit", disabled: !canPaste, action: onPaste },
    { label: "Find", icon: "⌕", group: "Edit", title: "Find in project (tags, routines, rung text)", action: onFind },
    { label: "Replace", icon: "⇄", group: "Edit", action: placeholder("Replace") },
    { label: "Verify", icon: "✓", group: "Actions", action: onVerify },
    { label: "Build", icon: "▲", group: "Actions", action: () => onDockTab("build") },
    {
      label: "Go Online",
      icon: "◇",
      group: "Actions",
      disabled: true,
      title: "Real PLC communication is not implemented.",
      action: placeholder("Go Online"),
    },
    { label: "Go Offline", icon: "○", group: "Actions", action: () => onToast("Offline Simulation is active.") },
    { label: "Monitor", icon: "◌", group: "Views", action: () => onDockTab("watch") },
    { label: "Forces", icon: "⊙", group: "Views", action: () => onDockTab("forces") },
    { label: "Trend", icon: "⌁", group: "Views", action: () => onDockTab("trend") },
    { label: "Data Monitor", icon: "▦", group: "Views", action: () => onDockTab("watch") },
    { label: "Compare", icon: "⇔", group: "Tools", action: onCompare },
    { label: "Cross Reference", icon: "⌬", group: "Tools", action: () => onDockTab("references") },
    { label: "Properties", icon: "☷", group: "Tools", title: "Show properties of the selection", action: onProperties },
    { label: "Logger", icon: "≡", group: "Views", action: placeholder("Logger") },
    { label: "Task Monitor", icon: "▧", group: "Views", action: placeholder("Task Monitor") },
  ];

  const groups = [...new Set(buttons.map((button) => button.group))];

  return (
    <section className="esco-ribbon" aria-label="Ribbon toolbar">
      <div className="esco-ribbon__tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`esco-ribbon__tab${tab === "Home" ? " is-active" : ""}`}
            onClick={tab === "Home" ? onHome : placeholder(`${tab} tab`)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="esco-ribbon__body">
        <div className="esco-titlebar__actions esco-ribbon__compat-actions" aria-label="Common commands">
          <button type="button" className="esco-btn" onClick={onUndo} disabled={!canUndo}>Undo</button>
          <button type="button" className="esco-btn" onClick={onRedo} disabled={!canRedo}>Redo</button>
          <button type="button" className="esco-btn" onClick={onHome}>Dashboard</button>
          <button type="button" className="esco-btn" onClick={onTags}>Tags</button>
          <button type="button" className="esco-btn" onClick={onCompare}>Compare</button>
          <button type="button" className="esco-btn" onClick={onExport}>Export Project</button>
          <button type="button" className="esco-btn" onClick={onImportProject}>Import Project</button>
          <button type="button" className="esco-btn esco-btn--l5x" onClick={onImportL5X}>Import L5X</button>
        </div>

        {groups.map((group) => (
          <div className="esco-ribbon__group" key={group}>
            <div className="esco-ribbon__buttons">
              {buttons
                .filter((button) => button.group === group)
                .map((button) => (
                  <button
                    key={button.label}
                    type="button"
                    className="esco-ribbon__button"
                    title={button.title ?? button.label}
                    disabled={button.disabled}
                    onClick={button.action}
                  >
                    <span className="esco-ribbon__icon" aria-hidden="true">{button.icon}</span>
                    <span className="esco-ribbon__label">{button.label}</span>
                  </button>
                ))}
            </div>
            <span className="esco-ribbon__group-label">{group}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
