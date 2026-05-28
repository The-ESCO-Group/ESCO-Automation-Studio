import { useState } from "react";
import type { DockTab } from "./BottomPanel";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  canCopy: boolean;
  canEditLadder: boolean;
  canClose: boolean;
  onHome: () => void;
  onClose: () => void;
  onTags: () => void;
  onCompare: () => void;
  onExport: () => void;
  onExportL5X: () => void;
  onExportTagsCsv: () => void;
  onImportProject: () => void;
  onImportL5X: () => void;
  onImportTagsCsv: () => void;
  onNew: () => void;
  onAddRung: () => void;
  onAddInstruction: (type: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onFind: () => void;
  onProperties: () => void;
  onProjectProperties: () => void;
  onControllerProperties: () => void;
  onOpenCopilot: () => void;
  onDockTab: (tab: DockTab) => void;
  onToast: (message: string) => void;
  onVerify: () => void;
}

const TABS = ["Home", "Edit", "View", "Project", "Logic", "Build", "Online", "Tools", "Window", "Help"] as const;
type RibbonTab = (typeof TABS)[number];

interface RibbonButton {
  label: string;
  icon: string;
  group: string;
  title?: string;
  disabled?: boolean;
  emphasis?: "primary" | "safe" | "danger";
  action: () => void;
}

const UNSAFE_ONLINE_MESSAGE = "Real PLC communication is not supported. Offline simulation only.";

/** Studio-style command ribbon. Tabs expose real command sets, not inert placeholders. */
export function RibbonToolbar({
  canUndo,
  canRedo,
  canPaste,
  canCopy,
  canEditLadder,
  canClose,
  onHome,
  onClose,
  onTags,
  onCompare,
  onExport,
  onExportL5X,
  onExportTagsCsv,
  onImportProject,
  onImportL5X,
  onImportTagsCsv,
  onNew,
  onAddRung,
  onAddInstruction,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onFind,
  onProperties,
  onProjectProperties,
  onControllerProperties,
  onOpenCopilot,
  onDockTab,
  onToast,
  onVerify,
}: Props) {
  const [activeTab, setActiveTab] = useState<RibbonTab>("Home");

  const placeholder = (label: string) => () => onToast(`${label} is not implemented yet. Offline simulation only.`);
  const onlineUnsupported = () => onToast(UNSAFE_ONLINE_MESSAGE);
  const alreadyVisible = (label: string) => () => onToast(`${label} is already visible.`);
  const addInstruction = (type: string) => () => onAddInstruction(type);

  const fileCommands: RibbonButton[] = [
    { label: "New", icon: "+", group: "File", title: "New blank project", action: onNew },
    { label: "Open", icon: "□", group: "File", title: "Open .plcproj.json", action: onImportProject },
    { label: "Import L5X", icon: "L5X", group: "File", title: "Import an offline L5X export", action: onImportL5X },
    { label: "Save", icon: "▣", group: "File", title: "Export project JSON", action: onExport },
    { label: "Save As", icon: "▤", group: "File", title: "Export project JSON with a filename", action: onExport },
    { label: "Close", icon: "×", group: "File", disabled: !canClose, title: "Close the current project", action: onClose },
  ];

  const editCommands: RibbonButton[] = [
    { label: "Undo", icon: "↶", group: "Edit", disabled: !canUndo, action: onUndo },
    { label: "Redo", icon: "↷", group: "Edit", disabled: !canRedo, action: onRedo },
    { label: "Cut", icon: "✂", group: "Clipboard", disabled: !canCopy, title: "Cut selected rung", action: onCut },
    { label: "Copy", icon: "⧉", group: "Clipboard", disabled: !canCopy, title: "Copy selected rung", action: onCopy },
    { label: "Paste", icon: "▥", group: "Clipboard", disabled: !canPaste, action: onPaste },
    { label: "Find", icon: "⌕", group: "Search", title: "Find in project", action: onFind },
    { label: "Replace", icon: "⇄", group: "Search", action: placeholder("Replace") },
  ];

  const dockCommands: RibbonButton[] = [
    { label: "Diagnostics", icon: "!", group: "Dock", action: () => onDockTab("diagnostics") },
    { label: "Search Results", icon: "⌕", group: "Dock", action: () => onDockTab("search") },
    { label: "References", icon: "⌬", group: "Dock", action: () => onDockTab("references") },
    { label: "Build", icon: "▲", group: "Dock", action: () => onDockTab("build") },
    { label: "Watch", icon: "◉", group: "Monitor", action: () => onDockTab("watch") },
    { label: "Trend", icon: "⌁", group: "Monitor", action: () => onDockTab("trend") },
    { label: "Trace", icon: "⟲", group: "Monitor", action: () => onDockTab("trace") },
    { label: "Forces", icon: "⊙", group: "Monitor", action: () => onDockTab("forces") },
  ];

  const logicCommands: RibbonButton[] = [
    { label: "Add Rung", icon: "+", group: "Rung", disabled: !canEditLadder, action: onAddRung },
    { label: "XIC", icon: "XIC", group: "Instruction", disabled: !canCopy, action: addInstruction("XIC") },
    { label: "XIO", icon: "XIO", group: "Instruction", disabled: !canCopy, action: addInstruction("XIO") },
    { label: "OTE", icon: "OTE", group: "Instruction", disabled: !canCopy, action: addInstruction("OTE") },
    { label: "TON", icon: "TON", group: "Instruction", disabled: !canCopy, action: addInstruction("TON") },
    { label: "Verify", icon: "✓", group: "Validation", emphasis: "primary", action: onVerify },
    { label: "Cross Reference", icon: "⌬", group: "Validation", action: () => onDockTab("references") },
  ];

  const projectCommands: RibbonButton[] = [
    ...fileCommands,
    { label: "Export L5X", icon: "LX", group: "Export", title: "Generate an offline review-only .L5X", action: onExportL5X },
    { label: "Tags", icon: "#", group: "Manage", action: onTags },
    { label: "Project Properties", icon: "☷", group: "Manage", action: onProjectProperties },
    { label: "Controller Properties", icon: "CPU", group: "Manage", action: onControllerProperties },
    { label: "Compare", icon: "⇔", group: "Reports", action: onCompare },
  ];

  const onlineCommands: RibbonButton[] = [
    { label: "Go Online", icon: "◇", group: "Controller", disabled: true, title: UNSAFE_ONLINE_MESSAGE, action: onlineUnsupported },
    { label: "Download", icon: "⇣", group: "Controller", disabled: true, title: UNSAFE_ONLINE_MESSAGE, action: onlineUnsupported },
    { label: "Upload", icon: "⇡", group: "Controller", disabled: true, title: UNSAFE_ONLINE_MESSAGE, action: onlineUnsupported },
    { label: "Online Edits", icon: "✎", group: "Controller", disabled: true, title: UNSAFE_ONLINE_MESSAGE, action: onlineUnsupported },
    { label: "Go Offline", icon: "○", group: "Simulation", action: () => onToast("Offline Simulation is active.") },
    { label: "Monitor", icon: "◌", group: "Simulation", action: () => onDockTab("watch") },
    { label: "Data Monitor", icon: "▦", group: "Simulation", action: () => onDockTab("watch") },
    { label: "Forces", icon: "⊙", group: "Simulation", action: () => onDockTab("forces") },
    { label: "Trend", icon: "⌁", group: "Simulation", action: () => onDockTab("trend") },
  ];

  const toolsCommands: RibbonButton[] = [
    { label: "Export Tags", icon: "CSV", group: "Tags", title: "Export tags as CSV", action: onExportTagsCsv },
    { label: "Import Tags", icon: "CSV", group: "Tags", title: "Preview and import tag CSV", action: onImportTagsCsv },
    { label: "Compare", icon: "⇔", group: "Analysis", action: onCompare },
    { label: "Cross Reference", icon: "⌬", group: "Analysis", action: () => onDockTab("references") },
    { label: "Properties", icon: "☷", group: "Inspect", title: "Show properties of the selection", action: onProperties },
    { label: "Logger", icon: "≡", group: "Inspect", action: () => onDockTab("logger") },
    { label: "Task Monitor", icon: "▧", group: "Inspect", action: () => onDockTab("task-monitor") },
  ];

  const buttonsByTab: Record<RibbonTab, RibbonButton[]> = {
    Home: [
      ...fileCommands.filter((button) => button.label !== "Import L5X"),
      { label: "Export L5X", icon: "LX", group: "Export", title: "Generate an offline review-only .L5X", action: onExportL5X },
      ...editCommands.filter((button) => ["Undo", "Redo", "Cut", "Copy", "Paste", "Find"].includes(button.label)),
      { label: "Verify", icon: "✓", group: "Actions", emphasis: "primary", action: onVerify },
      { label: "Build", icon: "▲", group: "Actions", action: () => onDockTab("build") },
      { label: "Forces", icon: "⊙", group: "Views", action: () => onDockTab("forces") },
      { label: "Data Monitor", icon: "▦", group: "Views", action: () => onDockTab("watch") },
      { label: "Cross Reference", icon: "⌬", group: "Tools", action: () => onDockTab("references") },
      { label: "Compare", icon: "⇔", group: "Tools", action: onCompare },
    ],
    Edit: editCommands,
    View: [
      { label: "Dashboard", icon: "⌂", group: "Workspace", action: onHome },
      { label: "Project Explorer", icon: "▤", group: "Workspace", action: alreadyVisible("Project Explorer") },
      { label: "AI Copilot", icon: "AI", group: "Workspace", action: onOpenCopilot },
      ...dockCommands,
      { label: "Logger", icon: "≡", group: "Dock", action: () => onDockTab("logger") },
      { label: "Task Monitor", icon: "▧", group: "Dock", action: () => onDockTab("task-monitor") },
    ],
    Project: projectCommands,
    Logic: logicCommands,
    Build: [
      { label: "Verify", icon: "✓", group: "Build", emphasis: "primary", action: onVerify },
      { label: "Build", icon: "▲", group: "Build", action: () => onDockTab("build") },
      { label: "Diagnostics", icon: "!", group: "Build", action: () => onDockTab("diagnostics") },
      { label: "Export L5X", icon: "LX", group: "Output", title: "Generate an offline review-only .L5X", action: onExportL5X },
      { label: "Compare", icon: "⇔", group: "Output", action: onCompare },
      { label: "Download", icon: "⇣", group: "Controller", disabled: true, title: UNSAFE_ONLINE_MESSAGE, action: onlineUnsupported },
    ],
    Online: onlineCommands,
    Tools: toolsCommands,
    Window: [
      { label: "Dashboard", icon: "⌂", group: "Workspace", action: onHome },
      { label: "Tags", icon: "#", group: "Workspace", action: onTags },
      { label: "Compare", icon: "⇔", group: "Workspace", action: onCompare },
      { label: "AI Copilot", icon: "AI", group: "Workspace", action: onOpenCopilot },
      ...dockCommands,
    ],
    Help: [
      { label: "Safety Notice", icon: "!", group: "Help", action: () => onToast(UNSAFE_ONLINE_MESSAGE) },
      { label: "About", icon: "i", group: "Help", action: () => onToast("ESCO Automation Studio runs in Offline Simulation by default.") },
      { label: "Shortcuts", icon: "⌘", group: "Help", action: () => onToast("Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y redo.") },
      { label: "Documentation", icon: "?", group: "Help", action: placeholder("Documentation") },
    ],
  };

  const buttons = buttonsByTab[activeTab];
  const groups = [...new Set(buttons.map((button) => button.group))];

  return (
    <section className="esco-ribbon" aria-label="Ribbon toolbar">
      <div className="esco-ribbon__tabs" role="tablist" aria-label="Ribbon tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`esco-ribbon__tab${activeTab === tab ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="esco-ribbon__body" aria-label={`${activeTab} commands`}>
        <div className="esco-titlebar__actions esco-ribbon__compat-actions" aria-label="Common commands">
          <button type="button" className="esco-btn" onClick={onUndo} disabled={!canUndo}>Undo</button>
          <button type="button" className="esco-btn" onClick={onRedo} disabled={!canRedo}>Redo</button>
          <button type="button" className="esco-btn" onClick={onHome}>Dashboard</button>
          <button type="button" className="esco-btn" onClick={onTags}>Tags</button>
          <button type="button" className="esco-btn" onClick={onCompare}>Compare</button>
          <button type="button" className="esco-btn" onClick={onExport}>Export Project</button>
          <button type="button" className="esco-btn" onClick={onExportL5X}>Export L5X</button>
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
                    key={`${group}-${button.label}`}
                    type="button"
                    className={`esco-ribbon__button${
                      button.emphasis ? ` esco-ribbon__button--${button.emphasis}` : ""
                    }`}
                    title={button.title ?? button.label}
                    disabled={button.disabled}
                    onClick={button.action}
                  >
                    <span
                      className={`esco-ribbon__icon${button.icon.length > 2 ? " esco-ribbon__icon--text" : ""}`}
                      aria-hidden="true"
                    >
                      {button.icon}
                    </span>
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
