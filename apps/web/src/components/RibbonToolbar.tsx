import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ControllerCommandKind, ControllerMode } from "@esco/controller-comm";
import type { ControllerCommunicationAction } from "../controller-session";
import {
  escoControllerCommandDisplayLabel,
  escoControllerCommandUnavailableTitle,
} from "../escoCapabilityMap";
import type { DockTab } from "./BottomPanel";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  canCopy: boolean;
  canCut?: boolean;
  canEditLadder: boolean;
  canClose: boolean;
  communicationPath?: string;
  onlineStateLabel?: string;
  forceCount?: number;
  pendingTestEditCount?: number;
  onHome: () => void;
  onClose: () => void;
  onTags: () => void;
  onHmi: () => void;
  onCompare: () => void;
  onProjectHistory: () => void;
  onSimulationLab: () => void;
  onEscoOnline: () => void;
  onEscoOnlineSetPath: () => void;
  onEscoOnlineGoOffline: () => void;
  onGit: () => void;
  onMainWindow: () => void;
  onExport: () => void;
  onSaveAs: () => void;
  onExportL5X: () => void;
  onExportTagsCsv: () => void;
  onImportProject: () => void;
  onImportL5X: () => void;
  onBuildRuntime: () => void;
  onExportRuntime: () => void;
  onImportRuntime: () => void;
  onSoftControllerDownloadRuntime: () => void;
  onOpenSoftControllerUpload: () => void;
  onExportSnapshot: () => void;
  onImportSnapshot: () => void;
  onExportLibrary: () => void;
  onExportExchange: () => void;
  onImportExchange: () => void;
  onExportPackage: () => void;
  onImportPackage: () => void;
  onValidateEscoArtifact: () => void;
  onImportTagsCsv: () => void;
  onNew: () => void;
  onAddRung: () => void;
  onAddInstruction: (type: string) => void;
  onAddBranch: () => void;
  onAddBranchLeg: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onFind: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  canFindNavigate: boolean;
  onProperties: () => void;
  onProjectProperties: () => void;
  onControllerProperties: () => void;
  onDockTab: (tab: DockTab) => void;
  onControllerAction: (action: ControllerCommunicationAction) => void;
  onVirtualSelectPath: () => void;
  onVirtualGoOnline: () => void;
  onVirtualMonitor: () => void;
  onVirtualDownload: () => void;
  onVirtualUpload: () => void;
  onVirtualGoOffline: () => void;
  onVirtualSetMode: (mode: ControllerMode) => void;
  onVirtualClearFaults: () => void;
  onHelpContents: () => void;
  onAbout: () => void;
  onToast: (message: string) => void;
  onVerify: () => void;
}

const MENUS = ["File", "Edit", "View", "Search", "Logic", "Communications", "Tools", "Window", "Help"] as const;
const INSTRUCTION_CATEGORIES = [
  "Favorites",
  "Add-On",
  "Alarms",
  "Bit",
  "Timer/Counter",
  "Input/Output",
  "Compare",
  "Compute/Math",
  "Move/Logical",
  "File/Misc.",
  "Sequencer",
  "Equipment Phase",
  "Equipment Sequence",
  "Program Control",
  "For/Break",
  "Special",
  "HMI",
  "Trigonometry",
  "Advanced Math",
  "Math Conversions",
  "Motion State",
  "Motion Move",
  "Motion Group",
  "Motion Event",
  "Motion Config",
  "Motion Coordinated",
  "ASCII Serial Port",
  "ASCII String",
  "ASCII Conversion",
  "Debug",
] as const;
type MenuName = (typeof MENUS)[number];
type InstructionCategory = (typeof INSTRUCTION_CATEGORIES)[number];
type InstructionButtonSpec = Omit<ToolbarButton, "action" | "disabled"> & {
  instructionType?: string;
  branchAction?: "branch" | "branch-leg" | "branch-end";
};

const FAVORITE_INSTRUCTIONS: InstructionButtonSpec[] = [
  { label: "BST", icon: "BST", title: "Add Parallel Branch", branchAction: "branch" },
  { label: "NXB", icon: "NXB", title: "Add Branch Leg", branchAction: "branch-leg" },
  { label: "BND", icon: "BND", title: "Branch End", groupEnd: true, branchAction: "branch-end" },
  { label: "XIC", icon: "XIC", instructionType: "XIC" },
  { label: "XIO", icon: "XIO", groupEnd: true, instructionType: "XIO" },
  { label: "ONS", icon: "ONS", groupEnd: true, instructionType: "ONS" },
  { label: "OTE", icon: "OTE", instructionType: "OTE" },
  { label: "OTU", icon: "OTU", instructionType: "OTU" },
  { label: "OTL", icon: "OTL", groupEnd: true, instructionType: "OTL" },
  { label: "TON", icon: "TON", instructionType: "TON" },
  { label: "RTO", icon: "RTO", instructionType: "RTO" },
  { label: "CTU", icon: "CTU", instructionType: "CTU" },
  { label: "CTD", icon: "CTD", instructionType: "CTD" },
];

const CATEGORY_INSTRUCTIONS: Partial<Record<InstructionCategory, InstructionButtonSpec[]>> = {
  Favorites: FAVORITE_INSTRUCTIONS,
  Bit: FAVORITE_INSTRUCTIONS.slice(0, 9),
  "Timer/Counter": [
    { label: "TON", icon: "TON", instructionType: "TON" },
    { label: "TOF", icon: "TOF", instructionType: "TOF" },
    { label: "RTO", icon: "RTO", groupEnd: true, instructionType: "RTO" },
    { label: "CTU", icon: "CTU", instructionType: "CTU" },
    { label: "CTD", icon: "CTD", instructionType: "CTD" },
    { label: "RES", icon: "RES", instructionType: "RES" },
  ],
  Compare: [
    { label: "EQU", icon: "EQU", instructionType: "EQU" },
    { label: "NEQ", icon: "NEQ", instructionType: "NEQ" },
    { label: "LES", icon: "LES", instructionType: "LES" },
    { label: "LEQ", icon: "LEQ", instructionType: "LEQ" },
    { label: "GRT", icon: "GRT", instructionType: "GRT" },
    { label: "GEQ", icon: "GEQ", instructionType: "GEQ" },
    { label: "LIM", icon: "LIM", instructionType: "LIM" },
  ],
  "Compute/Math": [
    { label: "ADD", icon: "ADD", instructionType: "ADD" },
    { label: "SUB", icon: "SUB", instructionType: "SUB" },
    { label: "MUL", icon: "MUL", instructionType: "MUL" },
    { label: "DIV", icon: "DIV", instructionType: "DIV" },
    { label: "MOD", icon: "MOD", instructionType: "MOD" },
    { label: "CPT", icon: "CPT", instructionType: "CPT" },
  ],
  "Move/Logical": [
    { label: "MOV", icon: "MOV", instructionType: "MOV" },
    { label: "MVM", icon: "MVM", instructionType: "MVM" },
    { label: "CLR", icon: "CLR", instructionType: "CLR" },
    { label: "AND", icon: "AND", instructionType: "AND" },
    { label: "OR", icon: "OR", instructionType: "OR" },
    { label: "XOR", icon: "XOR", instructionType: "XOR" },
    { label: "NOT", icon: "NOT", instructionType: "NOT" },
  ],
  "File/Misc.": [
    { label: "COP", icon: "COP", instructionType: "COP" },
    { label: "CPS", icon: "CPS", instructionType: "CPS" },
    { label: "FLL", icon: "FLL", instructionType: "FLL" },
  ],
  Sequencer: [
    { label: "SQO", icon: "SQO", instructionType: "SQO" },
    { label: "SQI", icon: "SQI", instructionType: "SQI" },
    { label: "SQC", icon: "SQC", instructionType: "SQC" },
  ],
  "Program Control": [
    { label: "JMP", icon: "JMP", instructionType: "JMP" },
    { label: "LBL", icon: "LBL", instructionType: "LBL" },
    { label: "JSR", icon: "JSR", instructionType: "JSR" },
    { label: "SBR", icon: "SBR", instructionType: "SBR" },
    { label: "RET", icon: "RET", instructionType: "RET" },
  ],
  "Input/Output": [
    { label: "MSG", icon: "MSG", instructionType: "MSG" },
    { label: "GSV", icon: "GSV", instructionType: "GSV" },
    { label: "SSV", icon: "SSV", instructionType: "SSV" },
    { label: "IOT", icon: "IOT", instructionType: "IOT" },
  ],
  "Advanced Math": [
    { label: "SQR", icon: "SQR", instructionType: "SQR" },
    { label: "NEG", icon: "NEG", instructionType: "NEG" },
    { label: "ABS", icon: "ABS", instructionType: "ABS" },
    { label: "LN", icon: "LN", instructionType: "LN" },
    { label: "LOG", icon: "LOG", instructionType: "LOG" },
    { label: "XPY", icon: "XPY", instructionType: "XPY" },
  ],
  Trigonometry: [
    { label: "SIN", icon: "SIN", instructionType: "SIN" },
    { label: "COS", icon: "COS", instructionType: "COS" },
    { label: "TAN", icon: "TAN", instructionType: "TAN" },
    { label: "ASN", icon: "ASN", instructionType: "ASN" },
    { label: "ACS", icon: "ACS", instructionType: "ACS" },
    { label: "ATN", icon: "ATN", instructionType: "ATN" },
  ],
};

interface ToolbarButton {
  label: string;
  icon: string;
  title?: string;
  disabled?: boolean;
  groupEnd?: boolean;
  emphasis?: "primary" | "safe" | "danger";
  action: () => void;
}

type MenuCommand =
  | { kind: "item"; label: string; shortcut?: string; title?: string; disabled?: boolean; action: () => void }
  | { kind: "submenu"; label: string; title?: string; disabled?: boolean; items: MenuCommand[] }
  | { kind: "section"; label: string }
  | { kind: "separator" };

const UNSAFE_ONLINE_MESSAGE =
  "Unsupported hardware command: no tested real-controller transport is configured in this build.";

function hardwareCommandLabel(kind: ControllerCommandKind, fallback: string): string {
  return escoControllerCommandDisplayLabel(kind, fallback);
}

function hardwareCommandTitle(kind: ControllerCommandKind): string {
  return escoControllerCommandUnavailableTitle(kind, UNSAFE_ONLINE_MESSAGE);
}

function LadderToolbarGlyph({ type }: { type: string }) {
  const key = type.toUpperCase();
  const symbol =
    key === "BST" ? (
      <>
        <path d="M5 5 H23 M5 13 H23 M5 5 V13" />
      </>
    ) : key === "NXB" ? (
      <>
        <path d="M5 5 H23 M5 13 H23 M14 5 V13" />
      </>
    ) : key === "BND" ? (
      <>
        <path d="M5 5 H23 M5 13 H23 M23 5 V13" />
      </>
    ) : key === "XIC" ? (
      <>
        <path d="M3 9 H9 M19 9 H25 M11 4 V14 M17 4 V14" />
      </>
    ) : key === "XIO" ? (
      <>
        <path d="M3 9 H9 M19 9 H25 M11 4 V14 M17 4 V14 M10 15 L18 3" />
      </>
    ) : key === "OTE" ? (
      <>
        <path d="M3 9 H8 M20 9 H25 M11 4 C8 6 8 12 11 14 M17 4 C20 6 20 12 17 14" />
      </>
    ) : key === "OTU" || key === "OTL" ? (
      <>
        <path d="M3 9 H8 M20 9 H25 M11 4 C8 6 8 12 11 14 M17 4 C20 6 20 12 17 14" />
        <text x="14" y="11.5">{key === "OTU" ? "U" : "L"}</text>
      </>
    ) : (
      <text x="14" y="11.5">{key}</text>
    );
  return (
    <svg
      className={`esco-ribbon-ladder-icon esco-ribbon-ladder-icon--${type.toLowerCase()}`}
      viewBox="0 0 28 18"
      aria-hidden="true"
      focusable="false"
    >
      {symbol}
    </svg>
  );
}

function CommandToolbarGlyph({ type }: { type: string }) {
  return (
    <span className={`esco-ribbon-command-icon esco-ribbon-command-icon--${type}`} aria-hidden="true">
      <span className="esco-ribbon-command-icon__mark" />
    </span>
  );
}

function runOnKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function StandardComboWell({ onActivate, title }: { onActivate: () => void; title: string }) {
  return (
    <div
      className="esco-ribbon__standard-combo"
      role="button"
      tabIndex={0}
      aria-label="Select communication path (unsupported hardware browse)"
      title={title}
      onClick={onActivate}
      onKeyDown={(event) => runOnKeyboard(event, onActivate)}
    >
      <span aria-hidden="true" />
    </div>
  );
}

/**
 * Scroll the Controller Organizer (the left project tree) into view and flash it
 * so the "Controller Organizer" commands do something observable instead of just
 * reporting it is already visible. The organizer is always mounted, so this
 * focuses attention rather than toggling visibility.
 */
function focusControllerOrganizer(onToast: (message: string) => void) {
  const organizer = document.querySelector<HTMLElement>(".esco-controller-organizer");
  if (!organizer) {
    onToast("Controller Organizer is available in the left panel.");
    return;
  }
  const focusOrganizer = (target: HTMLElement) => {
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target.classList.add("is-flash");
    window.setTimeout(() => target.classList.remove("is-flash"), 900);
    const firstNode = target.querySelector<HTMLElement>(
      ".esco-tree__node--controller, .esco-tree__group--button",
    );
    firstNode?.focus?.();
  };
  const restoreButton = Array.from(organizer.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    /show controller organizer/i.test(button.textContent ?? ""),
  );
  if (restoreButton) {
    restoreButton.click();
    window.setTimeout(() => {
      const restored = document.querySelector<HTMLElement>(".esco-controller-organizer");
      if (restored) focusOrganizer(restored);
    }, 0);
    onToast("Controller Organizer restored.");
    return;
  }
  focusOrganizer(organizer);
  onToast("Controller Organizer focused.");
}

function StandardUtilityStrip({
  onControllerAction,
  onDockTab,
  onSimulationLab,
  onToast,
  onVerify,
}: {
  onControllerAction: (action: ControllerCommunicationAction) => void;
  onDockTab: (tab: DockTab) => void;
  onSimulationLab: () => void;
  onToast: (message: string) => void;
  onVerify: () => void;
}) {
  const utilities: {
    label: string;
    icon: string;
    title?: string;
    disabled?: boolean;
    action: () => void;
  }[] = [
    {
      label: hardwareCommandLabel("network-browser", "Browse Path"),
      icon: "browse",
      title: hardwareCommandTitle("network-browser"),
      action: () => onControllerAction("network-browser"),
    },
    { label: "Controller communications", icon: "comms", action: () => onDockTab("controller") },
    { label: "Verify project", icon: "verify", action: onVerify },
    { label: "Simulation lab", icon: "simlab", action: onSimulationLab },
    { label: "Controller organizer view", icon: "organizer", action: () => focusControllerOrganizer(onToast) },
  ];
  return (
    <div className="esco-ribbon__utility-strip" aria-label="Standard toolbar utility commands">
      {utilities.map((utility) => (
        <button
          key={utility.label}
          type="button"
          className="esco-ribbon__utility-btn"
          aria-label={utility.label}
          title={utility.title ?? utility.label}
          disabled={utility.disabled}
          onClick={utility.action}
        >
          <span className={`esco-ribbon__utility-icon esco-ribbon__utility-icon--${utility.icon}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Classic PLC toolbar stack: menu bar, standard/online toolbars, path bar, and instruction toolbar. */
export function RibbonToolbar({
  canUndo,
  canRedo,
  canPaste,
  canCopy,
  canCut = canCopy,
  canEditLadder,
  canClose,
  communicationPath = "No hardware path selected",
  onlineStateLabel = "Offline",
  forceCount = 0,
  pendingTestEditCount = 0,
  onClose,
  onTags,
  onHmi,
  onCompare,
  onProjectHistory,
  onSimulationLab,
  onEscoOnline,
  onEscoOnlineSetPath,
  onEscoOnlineGoOffline,
  onGit,
  onMainWindow,
  onExport,
  onSaveAs,
  onExportL5X,
  onExportTagsCsv,
  onImportProject,
  onImportL5X,
  onBuildRuntime,
  onExportRuntime,
  onImportRuntime,
  onSoftControllerDownloadRuntime,
  onOpenSoftControllerUpload,
  onExportSnapshot,
  onImportSnapshot,
  onExportLibrary,
  onExportExchange,
  onImportExchange,
  onExportPackage,
  onImportPackage,
  onValidateEscoArtifact,
  onImportTagsCsv,
  onNew,
  onAddRung,
  onAddInstruction,
  onAddBranch,
  onAddBranchLeg,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onFind,
  onFindNext,
  onFindPrevious,
  canFindNavigate,
  onProperties,
  onProjectProperties,
  onControllerProperties,
  onDockTab,
  onControllerAction,
  onVirtualSelectPath,
  onVirtualGoOnline,
  onVirtualMonitor,
  onVirtualDownload,
  onVirtualUpload,
  onVirtualGoOffline,
  onVirtualSetMode,
  onVirtualClearFaults,
  onHelpContents,
  onAbout,
  onToast,
  onVerify,
}: Props) {
  const [activeMenu, setActiveMenu] = useState<MenuName>("File");
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [activeInstructionCategory, setActiveInstructionCategory] =
    useState<InstructionCategory>("Favorites");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const ribbonRef = useRef<HTMLElement | null>(null);
  const categoryPickerRef = useRef<HTMLDivElement | null>(null);
  const categorySearchRef = useRef<HTMLInputElement | null>(null);
  const normalizedCategorySearch = categorySearch.trim().toLowerCase();
  const hasMatchingCategory = INSTRUCTION_CATEGORIES.some((category) =>
    category.toLowerCase().includes(normalizedCategorySearch),
  );
  const runControllerAction = (action: ControllerCommunicationAction) => {
    onDockTab("controller");
    onControllerAction(action);
  };
  const showHardwareUnavailable = (kind: ControllerCommandKind) => {
    runControllerAction(kind);
  };
  const unavailableMenuItem = (kind: ControllerCommandKind, label: string, shortcut?: string): MenuCommand => ({
    kind: "item",
    label: hardwareCommandLabel(kind, label),
    title: hardwareCommandTitle(kind),
    shortcut,
    action: () => runControllerAction(kind),
  });
  const addInstruction = (type: string) => () => onAddInstruction(type);
  const verifyDiagnostics = () => {
    onVerify();
    onDockTab("diagnostics");
  };
  const routeNoEdits = () => {
    if (pendingTestEditCount > 0) {
      showHardwareUnavailable("test-edits");
      return;
    }
    onDockTab("controller");
    onToast("No pending test edits in the offline project.");
  };
  const routeBatteryDiagnostics = () => {
    showHardwareUnavailable("go-to-faults");
  };
  const displayCommunicationPath = communicationPath.trim() || "No hardware path selected";
  const forcesLabel = forceCount > 0 ? `${forceCount} Force${forceCount === 1 ? "" : "s"}` : "No Forces";
  const editsLabel = pendingTestEditCount > 0 ? "Test Edits" : "No Edits";

  useEffect(() => {
    if (!openMenu) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (ribbonRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!categoryMenuOpen) {
      setCategorySearch("");
      return;
    }
    categorySearchRef.current?.focus();
    const closeOnPointerDown = (event: MouseEvent) => {
      if (categoryPickerRef.current?.contains(event.target as Node)) return;
      setCategoryMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenuOpen]);

  const standardToolbar: ToolbarButton[] = [
    { label: "New", icon: "new", title: "New ESCO Project", action: onNew },
    { label: "Open", icon: "open", title: "Open ESCO Project...", action: onImportProject },
    { label: "Save", icon: "save", title: "Save ESCO Project", action: onExport },
    { label: "Save As", icon: "save-as", title: "Save ESCO Project As...", action: onSaveAs },
    { label: "Cut", icon: "cut", disabled: !canCut, title: "Cut", action: onCut },
    { label: "Copy", icon: "copy", disabled: !canCopy, title: "Copy", action: onCopy },
    { label: "Paste", icon: "paste", disabled: !canPaste, action: onPaste },
    { label: "Undo", icon: "undo", disabled: !canUndo, action: onUndo },
    { label: "Redo", icon: "redo", disabled: !canRedo, action: onRedo },
    { label: "Find", icon: "find", title: "Find...", action: onFind },
    { label: "Close", icon: "close", disabled: !canClose, title: "Close", action: onClose },
  ];

  const onlineToolbar: ToolbarButton[] = [
    {
      label: "Set Path",
      icon: "path",
      title: "Open ESCO Online gateway path setup",
      action: onEscoOnlineSetPath,
    },
    {
      label: "Go Online",
      icon: "online",
      title: "Open ESCO Online read-only connection",
      action: onEscoOnline,
    },
    { label: "Go Offline", icon: "offline", title: "Disconnect the ESCO Online gateway session", action: onEscoOnlineGoOffline },
    {
      label: "Upload Snapshot",
      icon: "upload",
      title: "Open ESCO Online read-only upload snapshot",
      action: onEscoOnline,
    },
    {
      label: hardwareCommandLabel("download", "Download"),
      icon: "download",
      title: hardwareCommandTitle("download"),
      disabled: true,
      action: () => runControllerAction("download"),
    },
    { label: "Compare", icon: "compare", title: "Open ESCO Online match check", action: onEscoOnline },
    { label: "Read Tags", icon: "tags", title: "Open ESCO Online Tag Monitor", action: onEscoOnline },
    { label: "Watch Tags", icon: "watch", title: "Open ESCO Online watch list", action: onEscoOnline },
    {
      label: "Faults",
      icon: "faults",
      title: "Open ESCO Online read-only fault/status view",
      action: onEscoOnline,
    },
    { label: "Controller Status", icon: "status", title: "Open ESCO Online controller status", action: onEscoOnline },
  ];

  const instructionToolbar: ToolbarButton[] = (CATEGORY_INSTRUCTIONS[activeInstructionCategory] ?? FAVORITE_INSTRUCTIONS)
    .map((button) => ({
      ...button,
      disabled: !canEditLadder,
      action:
        button.branchAction === "branch"
          ? onAddBranch
          : button.branchAction === "branch-leg"
            ? onAddBranchLeg
            : button.branchAction === "branch-end"
              ? () => onToast("Branch end is managed by the graphical rung structure.")
              : addInstruction(button.instructionType ?? button.label),
    }));

  const separator = (): MenuCommand => ({ kind: "separator" });
  const submenu = (label: string, items: MenuCommand[], title?: string): MenuCommand => ({
    kind: "submenu",
    label,
    title,
    items,
  });
  const menuCommands: Record<MenuName, MenuCommand[]> = {
    File: [
      { kind: "item", label: "New ESCO Project", shortcut: "Ctrl+N", action: onNew },
      { kind: "item", label: "Open ESCO Project...", shortcut: "Ctrl+O", action: onImportProject },
      { kind: "item", label: "Save ESCO Project", shortcut: "Ctrl+S", action: onExport },
      { kind: "item", label: "Save ESCO Project As...", action: onSaveAs },
      separator(),
      submenu("Import / Export", [
        { kind: "item", label: "Import L5X...", action: onImportL5X },
        { kind: "item", label: "Export L5X (Review Only)...", action: onExportL5X },
        separator(),
        { kind: "item", label: "Export ESCO Snapshot...", action: onExportSnapshot },
        { kind: "item", label: "Import ESCO Snapshot...", action: onImportSnapshot },
        separator(),
        { kind: "item", label: "Export ESCO Library...", action: onExportLibrary },
        { kind: "item", label: "Export ESCO Exchange...", action: onExportExchange },
        { kind: "item", label: "Import ESCO Exchange...", action: onImportExchange },
        { kind: "item", label: "Export ESCO Package...", action: onExportPackage },
        { kind: "item", label: "Import ESCO Package...", action: onImportPackage },
      ]),
      submenu("Runtime / SoftController", [
        { kind: "item", label: "Build ESCO Runtime", action: onBuildRuntime },
        { kind: "item", label: "Export ESCO Runtime...", action: onExportRuntime },
        { kind: "item", label: "Import ESCO Runtime...", action: onImportRuntime },
        { kind: "item", label: "Download Runtime to ESCO SoftController", action: onSoftControllerDownloadRuntime },
        { kind: "item", label: "Open ESCO SoftController Upload...", action: onOpenSoftControllerUpload },
        { kind: "item", label: "Validate ESCO Package / Runtime Files...", action: onValidateEscoArtifact },
      ]),
      separator(),
      submenu("Properties", [
        { kind: "item", label: "Project Properties...", action: onProjectProperties },
        { kind: "item", label: "Controller Properties...", action: onControllerProperties },
      ]),
      { kind: "item", label: "Close", disabled: !canClose, action: onClose },
    ],
    Edit: [
      { kind: "item", label: "Undo", shortcut: "Ctrl+Z", disabled: !canUndo, action: onUndo },
      { kind: "item", label: "Redo", shortcut: "Ctrl+Y", disabled: !canRedo, action: onRedo },
      separator(),
      { kind: "item", label: "Cut", shortcut: "Ctrl+X", disabled: !canCut, action: onCut },
      { kind: "item", label: "Copy", shortcut: "Ctrl+C", disabled: !canCopy, action: onCopy },
      { kind: "item", label: "Paste", shortcut: "Ctrl+V", disabled: !canPaste, action: onPaste },
      separator(),
      { kind: "item", label: "Find...", shortcut: "Ctrl+F", action: onFind },
      { kind: "item", label: "Find Next", shortcut: "F3", disabled: !canFindNavigate, action: onFindNext },
      { kind: "item", label: "Find Previous", shortcut: "Shift+F3", disabled: !canFindNavigate, action: onFindPrevious },
    ],
    View: [
      { kind: "item", label: "Controller Organizer", action: () => focusControllerOrganizer(onToast) },
      { kind: "item", label: "Controller Tags", action: onTags },
      { kind: "item", label: "HMI Designer", action: onHmi },
      { kind: "item", label: "ESCO Simulation Lab", action: onSimulationLab },
      { kind: "item", label: "ESCO Online (Gateway)", action: onEscoOnline },
      { kind: "item", label: "Controller Status", action: () => onDockTab("controller") },
      { kind: "item", label: "Model Summary", action: () => onDockTab("model") },
      { kind: "item", label: "Task Monitor", action: () => onDockTab("tasks") },
      { kind: "item", label: "Watch", action: () => onDockTab("watch") },
      { kind: "item", label: "Trend", action: () => onDockTab("trend") },
      { kind: "item", label: "Forces", action: () => onDockTab("forces") },
      { kind: "item", label: "Compare", action: onCompare },
      { kind: "item", label: "Project History", action: onProjectHistory },
      { kind: "item", label: "Errors", action: () => onDockTab("diagnostics") },
    ],
    Search: [
      { kind: "item", label: "Find...", shortcut: "Ctrl+F", action: onFind },
      { kind: "item", label: "Find Next", shortcut: "F3", disabled: !canFindNavigate, action: onFindNext },
      { kind: "item", label: "Find Previous", shortcut: "Shift+F3", disabled: !canFindNavigate, action: onFindPrevious },
      separator(),
      { kind: "item", label: "Cross Reference", action: () => onDockTab("references") },
    ],
    Logic: [
      { kind: "item", label: "Verify Controller", action: onVerify },
      separator(),
      { kind: "item", label: "Add Rung", disabled: !canEditLadder, action: onAddRung },
      { kind: "item", label: "Examine On (XIC)", disabled: !canEditLadder, action: addInstruction("XIC") },
      { kind: "item", label: "Examine Off (XIO)", disabled: !canEditLadder, action: addInstruction("XIO") },
      { kind: "item", label: "One Shot (ONS)", disabled: !canEditLadder, action: addInstruction("ONS") },
      { kind: "item", label: "Output Energize (OTE)", disabled: !canEditLadder, action: addInstruction("OTE") },
      { kind: "item", label: "Timer On Delay (TON)", disabled: !canEditLadder, action: addInstruction("TON") },
      { kind: "item", label: "Retentive Timer On (RTO)", disabled: !canEditLadder, action: addInstruction("RTO") },
      { kind: "item", label: "Count Up (CTU)", disabled: !canEditLadder, action: addInstruction("CTU") },
      { kind: "item", label: "Count Down (CTD)", disabled: !canEditLadder, action: addInstruction("CTD") },
    ],
    Communications: [
      submenu("ESCO Online Gateway", [
        { kind: "item", label: "Open ESCO Online Gateway...", action: onEscoOnline },
        { kind: "item", label: "Set ESCO Online Path...", action: onEscoOnlineSetPath },
        { kind: "item", label: "Go Offline (Gateway)", action: onEscoOnlineGoOffline },
      ]),
      submenu("Real Controller (Blocked)", [
        unavailableMenuItem("network-browser", "Controller Route Browser..."),
        unavailableMenuItem("select-recent-path", "Saved Controller Path"),
        unavailableMenuItem("go-online", "Go Online"),
        unavailableMenuItem("monitor", "Monitor"),
        unavailableMenuItem("upload", "Upload..."),
        unavailableMenuItem("download", "Download..."),
      ]),
      submenu("Mode / Faults (Blocked)", [
        unavailableMenuItem("run-mode", "Run Mode"),
        unavailableMenuItem("program-mode", "Program Mode"),
        unavailableMenuItem("test-mode", "Test Mode"),
        unavailableMenuItem("clear-faults", "Clear Faults"),
        unavailableMenuItem("go-to-faults", "Go To Faults"),
      ]),
      submenu("Online Edits (Blocked)", [
        unavailableMenuItem("test-edits", "Test Edits"),
        unavailableMenuItem("assemble-edits", "Assemble Edits"),
        unavailableMenuItem("finalize-edits", "Finalize All Edits"),
        unavailableMenuItem("cancel-edits", "Cancel Edits"),
      ]),
      submenu("ESCO Virtual Controller", [
        { kind: "item", label: "Select Virtual Path...", action: onVirtualSelectPath },
        { kind: "item", label: "Go Online (Virtual)", action: onVirtualGoOnline },
        { kind: "item", label: "Monitor (Virtual)", action: onVirtualMonitor },
        { kind: "item", label: "Download to ESCO Virtual Controller", action: onVirtualDownload },
        { kind: "item", label: "Upload from ESCO Virtual Controller", action: onVirtualUpload },
        { kind: "item", label: "Program Mode (Virtual)", action: () => onVirtualSetMode("program") },
        { kind: "item", label: "Run Mode (Virtual)", action: () => onVirtualSetMode("run") },
        { kind: "item", label: "Clear Faults (Virtual)", action: onVirtualClearFaults },
        { kind: "item", label: "Go Offline (Virtual)", action: onVirtualGoOffline },
      ]),
      separator(),
      { kind: "item", label: "Go Offline", action: () => runControllerAction("go-offline") },
    ],
    Tools: [
      { kind: "item", label: "Cross Reference", action: () => onDockTab("references") },
      { kind: "item", label: "Compare...", action: onCompare },
      { kind: "item", label: "Diagnostics", action: () => onDockTab("diagnostics") },
      { kind: "item", label: "Task Monitor", action: () => onDockTab("tasks") },
      { kind: "item", label: "Trend", action: () => onDockTab("trend") },
      separator(),
      { kind: "item", label: "Import Tags...", action: onImportTagsCsv },
      { kind: "item", label: "Export Tags...", action: onExportTagsCsv },
      separator(),
      { kind: "item", label: "Git", action: onGit },
      { kind: "item", label: "Properties", action: onProperties },
    ],
    Window: [
      { kind: "item", label: "Main Window", action: onMainWindow },
      { kind: "item", label: "Controller Tags", action: onTags },
      { kind: "item", label: "Controller Status", action: () => onDockTab("controller") },
      { kind: "item", label: "Model Summary", action: () => onDockTab("model") },
      { kind: "item", label: "Diagnostics", action: () => onDockTab("diagnostics") },
      { kind: "item", label: "Cross Reference", action: () => onDockTab("references") },
      { kind: "item", label: "Watch", action: () => onDockTab("watch") },
      { kind: "item", label: "Forces", action: () => onDockTab("forces") },
      { kind: "item", label: "Trend", action: () => onDockTab("trend") },
      { kind: "item", label: "Task Monitor", action: () => onDockTab("tasks") },
    ],
    Help: [
      { kind: "item", label: "Help Contents", action: onHelpContents },
      { kind: "item", label: "About ESCO Automation Studio", action: onAbout },
    ],
  };

  const runMenuCommand = (command: MenuCommand) => {
    if (command.kind !== "item" || command.disabled) return;
    command.action();
    setOpenMenu(null);
  };

  const renderMenuCommand = (menu: MenuName, command: MenuCommand, index: number, path = `${menu}-${index}`): ReactNode => {
    if (command.kind === "separator") {
      return <div key={`${path}-sep`} className="esco-ribbon-menu__separator" role="separator" />;
    }
    if (command.kind === "section") {
      return (
        <div key={`${path}-section`} className="esco-ribbon-menu__section" role="presentation">
          {command.label}
        </div>
      );
    }
    if (command.kind === "submenu") {
      return (
        <div key={`${path}-${command.label}`} className="esco-ribbon-menu__submenu" role="none">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            className="esco-ribbon-menu__item esco-ribbon-menu__item--submenu esco-ribbon-menu__submenu-trigger"
            title={command.title ?? command.label}
            disabled={command.disabled}
            onClick={(event) => event.preventDefault()}
          >
            <span>{command.label}</span>
            <kbd aria-hidden="true">&gt;</kbd>
          </button>
          <div className="esco-ribbon-menu esco-ribbon-menu--nested" role="menu" aria-label={`${command.label} submenu`}>
            {command.items.map((child, childIndex) => renderMenuCommand(menu, child, childIndex, `${path}-${command.label}-${childIndex}`))}
          </div>
        </div>
      );
    }
    return (
      <button
        key={`${path}-${command.label}`}
        type="button"
        role="menuitem"
        className="esco-ribbon-menu__item"
        title={command.title ?? command.label}
        disabled={command.disabled}
        onClick={() => runMenuCommand(command)}
      >
        <span>{command.label}</span>
        {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
      </button>
    );
  };

  const renderButton = (
    button: ToolbarButton,
    variant: "command" | "ladder" = "command",
    options: { showLabel?: boolean } = {},
  ) => {
    const showLabel = options.showLabel ?? variant !== "ladder";
    const ariaLabel = button.label.replace(/\s+\((Unsupported|Future|Virtual)\)$/u, "");

    return (
      <button
        key={button.label}
        type="button"
        className={`esco-ribbon__button${variant === "ladder" ? " esco-ribbon__button--ladder" : ""}${button.groupEnd ? " esco-ribbon__button--group-end" : ""}${button.emphasis ? ` esco-ribbon__button--${button.emphasis}` : ""}`}
        aria-label={ariaLabel}
        title={button.title ?? button.label}
        disabled={button.disabled}
        onClick={button.action}
      >
        <span className="esco-ribbon__icon" aria-hidden="true">
          {variant === "ladder" && button.icon !== "+" ? (
            <LadderToolbarGlyph type={button.icon} />
          ) : button.icon === "+" ? (
            "+"
          ) : (
            <CommandToolbarGlyph type={button.icon} />
          )}
        </span>
        {showLabel ? <span className="esco-ribbon__label">{button.label}</span> : null}
      </button>
    );
  };

  return (
    <section className="esco-ribbon" aria-label="Classic PLC toolbar" ref={ribbonRef}>
      <div className="esco-ribbon__tabs" role="menubar" aria-label="Main menu">
        {MENUS.map((menu) => (
          <span className="esco-ribbon__menu-slot" key={menu}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenu === menu}
              className={`esco-ribbon__tab${activeMenu === menu && openMenu ? " is-active" : ""}${openMenu === menu ? " is-open" : ""}`}
              onMouseEnter={() => {
                if (openMenu) {
                  setActiveMenu(menu);
                  setOpenMenu(menu);
                }
              }}
              onClick={() => {
                setActiveMenu(menu);
                setOpenMenu(menu);
              }}
            >
              {menu}
            </button>
            {openMenu === menu ? (
              <div className="esco-ribbon-menu" role="menu" aria-label={`${menu} menu`}>
                {menuCommands[menu].map((command, index) => renderMenuCommand(menu, command, index))}
              </div>
            ) : null}
          </span>
        ))}
      </div>

      <div className="esco-ribbon__toolbar-row esco-ribbon__toolbar-row--standard" aria-label="Standard and online toolbars">
        <span className="esco-ribbon__rail-label">Standard toolbar</span>
        <div className="esco-ribbon__button-strip" aria-label="Standard toolbar commands">
          {standardToolbar.map((button) => renderButton(button, "command", { showLabel: false }))}
        </div>
        <StandardComboWell
          title={hardwareCommandTitle("select-recent-path")}
          onActivate={() => showHardwareUnavailable("select-recent-path")}
        />
        <StandardUtilityStrip
          onControllerAction={runControllerAction}
          onDockTab={onDockTab}
          onSimulationLab={onSimulationLab}
          onToast={onToast}
          onVerify={onVerify}
        />
        <div className="esco-ribbon__mode-pills" aria-label="Controller mode">
          <span
            role="button"
            tabIndex={0}
            className="is-run"
            aria-label="Request Run Mode"
            title={hardwareCommandTitle("run-mode")}
            onClick={() => showHardwareUnavailable("run-mode")}
            onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("run-mode"))}
          >
            RUN
          </span>
          <span
            role="button"
            tabIndex={0}
            className="is-prog"
            aria-label="Request Program Mode"
            title={hardwareCommandTitle("program-mode")}
            onClick={() => showHardwareUnavailable("program-mode")}
            onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("program-mode"))}
          >
            PROG
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Request Test Mode"
            title={hardwareCommandTitle("test-mode")}
            onClick={() => showHardwareUnavailable("test-mode")}
            onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("test-mode"))}
          >
            REM
          </span>
        </div>
        <div className="esco-ribbon__button-strip esco-ribbon__button-strip--online" aria-label="Online toolbar commands">
          {onlineToolbar.map((button) => renderButton(button))}
        </div>
        <span className="esco-ribbon__online-state" title="Goal B online session state">
          {onlineStateLabel}
        </span>
        <span className="esco-ribbon__rail-label">Online toolbar</span>
      </div>

      <div className="esco-ribbon__path-row" aria-label="Controller status and communication path bar">
        <div className="esco-ribbon__controller-flags" aria-label="Controller health flags">
          <span
            role="button"
            tabIndex={0}
            aria-label="Controller RUN status"
            title={hardwareCommandTitle("run-mode")}
            onClick={() => showHardwareUnavailable("run-mode")}
            onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("run-mode"))}
          >
            RUN
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Verify controller status"
            title="Open diagnostics and verify the offline project"
            onClick={verifyDiagnostics}
            onKeyDown={(event) => runOnKeyboard(event, verifyDiagnostics)}
          >
            OK
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Battery diagnostics"
            title={hardwareCommandTitle("go-to-faults")}
            onClick={routeBatteryDiagnostics}
            onKeyDown={(event) => runOnKeyboard(event, routeBatteryDiagnostics)}
          >
            BAT
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="I/O communication browser"
            title={hardwareCommandTitle("network-browser")}
            onClick={() => showHardwareUnavailable("network-browser")}
            onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("network-browser"))}
          >
            I/O
          </span>
        </div>
        <div className="esco-ribbon__path-stack">
          <div className="esco-ribbon__path-line">
            <span className="esco-ribbon__path-label">Path:</span>
            <div
              className="esco-ribbon__path-value"
              role="button"
              tabIndex={0}
              aria-label="Select controller communication path"
              title={hardwareCommandTitle("select-recent-path")}
              onClick={() => showHardwareUnavailable("select-recent-path")}
              onKeyDown={(event) => runOnKeyboard(event, () => showHardwareUnavailable("select-recent-path"))}
            >
              {displayCommunicationPath}
            </div>
          </div>
          <div className="esco-ribbon__edit-state" aria-label="Offline edit state">
            <span
              role="button"
              tabIndex={0}
              aria-label="Open controller offline status"
              title="Open the controller status dock"
              onClick={() => onDockTab("controller")}
              onKeyDown={(event) => runOnKeyboard(event, () => onDockTab("controller"))}
            >
              Offline
            </span>
            <span
              role="button"
              tabIndex={0}
              className={forceCount > 0 ? "is-active" : undefined}
              aria-label="Open forces monitor"
              title="Open offline forces"
              onClick={() => onDockTab("forces")}
              onKeyDown={(event) => runOnKeyboard(event, () => onDockTab("forces"))}
            >
              {forcesLabel}
            </span>
            <span
              role="button"
              tabIndex={0}
              className={pendingTestEditCount > 0 ? "is-warning" : undefined}
              aria-label="Open online edit state"
              title={pendingTestEditCount > 0 ? hardwareCommandTitle("test-edits") : "No pending test edits"}
              onClick={routeNoEdits}
              onKeyDown={(event) => runOnKeyboard(event, routeNoEdits)}
            >
              {editsLabel}
            </span>
          </div>
        </div>
        <span className="esco-ribbon__rail-label">Communication Path bar</span>
      </div>

      <div className="esco-ribbon__toolbar-row esco-ribbon__toolbar-row--instruction" aria-label="Instruction toolbar">
        <div className="esco-ribbon__instruction-stack">
          <div className="esco-ribbon__button-strip esco-ribbon__button-strip--instructions">
            {instructionToolbar.map((button) => renderButton(button, "ladder"))}
          </div>
          <div className="esco-ribbon__category-picker" ref={categoryPickerRef}>
            <button
              type="button"
              className={`esco-ribbon__category-trigger${categoryMenuOpen ? " is-open" : ""}`}
              aria-haspopup="listbox"
              aria-expanded={categoryMenuOpen}
              aria-label="Instruction group"
              onClick={() => setCategoryMenuOpen((open) => !open)}
            >
              <span className="esco-ribbon__category-trigger-label">{activeInstructionCategory}</span>
              <span className="esco-ribbon__category-trigger-caret" aria-hidden="true">▾</span>
            </button>
            <div
              className={`esco-ribbon__category-menu${categoryMenuOpen ? " is-open" : ""}`}
              role="listbox"
              aria-label="Instruction groups"
            >
              <input
                ref={categorySearchRef}
                type="text"
                className="esco-ribbon__category-search"
                placeholder="Search groups..."
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                aria-label="Search instruction groups"
              />
              <div className="esco-ribbon__category-options">
                {INSTRUCTION_CATEGORIES.map((category) => {
                  const matches = category.toLowerCase().includes(normalizedCategorySearch);
                  return (
                    <button
                      key={category}
                      type="button"
                      role="option"
                      aria-selected={category === activeInstructionCategory}
                      className={[
                        "esco-ribbon__category-option",
                        category === activeInstructionCategory ? "is-active" : "",
                        matches ? "" : "is-hidden",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setActiveInstructionCategory(category);
                        setCategoryMenuOpen(false);
                        onToast(`${category} instruction group is selected in the offline toolbar.`);
                      }}
                    >
                      {category}
                    </button>
                  );
                })}
                {!hasMatchingCategory && (
                  <div className="esco-ribbon__category-empty">No matching groups</div>
                )}
              </div>
            </div>
          </div>
        </div>
        <span className="esco-ribbon__rail-label">Instruction toolbar</span>
      </div>
    </section>
  );
}
