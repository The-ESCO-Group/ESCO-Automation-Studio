/**
 * Workbench keyboard command routing.
 *
 * A real PLC engineering workbench drives almost everything from the
 * keyboard, so the shell binds a fixed map of accelerators to IDE commands.
 * This module is the single, pure source of truth for that map: it turns a
 * keyboard event into a {@link WorkbenchCommand} (or `null` when the chord is
 * not bound) without touching React or the DOM, which keeps the routing fully
 * unit-testable and stops the wiring in `App.tsx` from drifting.
 *
 * The actual side effects (focusing Find, opening Help, saving, …) stay in the
 * shell; this module only decides *which* command a chord means and whether it
 * is safe to fire while the user is typing in a text field.
 */

/** Every keyboard-routable workbench command. */
export type WorkbenchCommand =
  | "findNext"
  | "findPrevious"
  | "openFind"
  | "openHelp"
  | "cycleTabNext"
  | "cycleTabPrevious"
  | "newProject"
  | "openProject"
  | "saveProject"
  | "saveProjectAs"
  | "copyRung"
  | "cutRung"
  | "pasteRung"
  | "addLadderElement"
  | "deleteSelection"
  | "moveInstructionEarlier"
  | "moveInstructionLater"
  | "undo"
  | "redo";

/** Minimal, framework-agnostic view of a keyboard event. */
export interface ShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutResolution {
  command: WorkbenchCommand;
  /**
   * Global commands (Find, Help, Save, New, Open, tab cycling) fire even while
   * a text input is focused — they behave like window-level accelerators.
   * Editor commands (clipboard, undo/redo) defer to the browser inside text
   * fields so native editing keeps working.
   */
  global: boolean;
}

const GLOBAL = (command: WorkbenchCommand): ShortcutResolution => ({ command, global: true });
const EDITOR = (command: WorkbenchCommand): ShortcutResolution => ({ command, global: false });

/**
 * Resolve a keyboard event to the workbench command it triggers, or `null` when
 * the chord is unbound. Pure — no preventDefault, no app state. The caller is
 * responsible for guarding editor commands inside text fields (see
 * {@link ShortcutResolution.global}) and for command-specific preconditions
 * (e.g. whether a rung is selected before `copyRung`).
 */
export function resolveWorkbenchShortcut(event: ShortcutEventLike): ShortcutResolution | null {
  // Function-key accelerators work without a modifier.
  if (event.key === "F1") return GLOBAL("openHelp");
  if (event.key === "F3") return GLOBAL(event.shiftKey ? "findPrevious" : "findNext");

  // Alt+Insert opens the Add Ladder Element picker (Studio-style), even while an
  // operand field is focused, so an engineer can insert without leaving the rung.
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "Insert") {
    return GLOBAL("addLadderElement");
  }

  // Alt+Left / Alt+Right nudge the selected instruction earlier/later within its
  // series. Global so the move works whether the instruction box or one of its
  // operand fields holds focus; the shell guards it to the ladder editor surface.
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft") {
    return GLOBAL("moveInstructionEarlier");
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowRight") {
    return GLOBAL("moveInstructionLater");
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
    return EDITOR("deleteSelection");
  }

  // Everything else is a Ctrl (Win/Linux) or Cmd (macOS) chord.
  if (!(event.ctrlKey || event.metaKey)) return null;
  // Alt + Ctrl/Cmd combos are reserved for the OS / other handlers.
  if (event.altKey) return null;

  switch (event.key.toLowerCase()) {
    case "f":
      return GLOBAL("openFind");
    case "tab":
      return GLOBAL(event.shiftKey ? "cycleTabPrevious" : "cycleTabNext");
    case "n":
      return GLOBAL("newProject");
    case "o":
      return GLOBAL("openProject");
    case "s":
      return GLOBAL(event.shiftKey ? "saveProjectAs" : "saveProject");
    case "c":
      return EDITOR("copyRung");
    case "x":
      return EDITOR("cutRung");
    case "v":
      return EDITOR("pasteRung");
    case "z":
      return EDITOR(event.shiftKey ? "redo" : "undo");
    case "y":
      return EDITOR("redo");
    default:
      return null;
  }
}

/** Human-readable accelerator label for a command, for menus/tooltips/help. */
export function shortcutLabel(command: WorkbenchCommand): string {
  switch (command) {
    case "findNext":
      return "F3";
    case "findPrevious":
      return "Shift+F3";
    case "openFind":
      return "Ctrl+F";
    case "openHelp":
      return "F1";
    case "cycleTabNext":
      return "Ctrl+Tab";
    case "cycleTabPrevious":
      return "Ctrl+Shift+Tab";
    case "newProject":
      return "Ctrl+N";
    case "openProject":
      return "Ctrl+O";
    case "saveProject":
      return "Ctrl+S";
    case "saveProjectAs":
      return "Ctrl+Shift+S";
    case "copyRung":
      return "Ctrl+C";
    case "cutRung":
      return "Ctrl+X";
    case "pasteRung":
      return "Ctrl+V";
    case "addLadderElement":
      return "Alt+Insert";
    case "deleteSelection":
      return "Del";
    case "moveInstructionEarlier":
      return "Alt+Left";
    case "moveInstructionLater":
      return "Alt+Right";
    case "undo":
      return "Ctrl+Z";
    case "redo":
      return "Ctrl+Y";
  }
}
