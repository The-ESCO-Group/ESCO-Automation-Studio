import { describe, expect, it } from "vitest";
import {
  resolveWorkbenchShortcut,
  shortcutLabel,
  type ShortcutEventLike,
  type WorkbenchCommand,
} from "./shortcuts";

const ev = (overrides: Partial<ShortcutEventLike> & { key: string }): ShortcutEventLike => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("resolveWorkbenchShortcut", () => {
  it("routes function-key accelerators without a modifier", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "F1" }))).toEqual({ command: "openHelp", global: true });
    expect(resolveWorkbenchShortcut(ev({ key: "F3" }))).toEqual({ command: "findNext", global: true });
    expect(resolveWorkbenchShortcut(ev({ key: "F3", shiftKey: true }))).toEqual({
      command: "findPrevious",
      global: true,
    });
  });

  it("routes Ctrl chords to global navigation/file commands", () => {
    const cases: Array<[Partial<ShortcutEventLike> & { key: string }, WorkbenchCommand]> = [
      [{ key: "f", ctrlKey: true }, "openFind"],
      [{ key: "Tab", ctrlKey: true }, "cycleTabNext"],
      [{ key: "Tab", ctrlKey: true, shiftKey: true }, "cycleTabPrevious"],
      [{ key: "n", ctrlKey: true }, "newProject"],
      [{ key: "o", ctrlKey: true }, "openProject"],
      [{ key: "s", ctrlKey: true }, "saveProject"],
      [{ key: "s", ctrlKey: true, shiftKey: true }, "saveProjectAs"],
    ];
    for (const [keyEvent, command] of cases) {
      expect(resolveWorkbenchShortcut(ev(keyEvent))).toEqual({ command, global: true });
    }
  });

  it("routes Ctrl chords to editor commands flagged non-global", () => {
    const cases: Array<[Partial<ShortcutEventLike> & { key: string }, WorkbenchCommand]> = [
      [{ key: "c", ctrlKey: true }, "copyRung"],
      [{ key: "x", ctrlKey: true }, "cutRung"],
      [{ key: "v", ctrlKey: true }, "pasteRung"],
      [{ key: "z", ctrlKey: true }, "undo"],
      [{ key: "z", ctrlKey: true, shiftKey: true }, "redo"],
      [{ key: "y", ctrlKey: true }, "redo"],
    ];
    for (const [keyEvent, command] of cases) {
      expect(resolveWorkbenchShortcut(ev(keyEvent))).toEqual({ command, global: false });
    }
  });

  it("treats Cmd (metaKey) the same as Ctrl for macOS parity", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "s", metaKey: true }))).toEqual({
      command: "saveProject",
      global: true,
    });
    expect(resolveWorkbenchShortcut(ev({ key: "z", metaKey: true, shiftKey: true }))).toEqual({
      command: "redo",
      global: false,
    });
  });

  it("is case-insensitive on the letter key", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "F", ctrlKey: true }))?.command).toBe("openFind");
    expect(resolveWorkbenchShortcut(ev({ key: "S", ctrlKey: true }))?.command).toBe("saveProject");
  });

  it("returns null for unbound chords and bare keys", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "f" }))).toBeNull(); // no modifier
    expect(resolveWorkbenchShortcut(ev({ key: "k", ctrlKey: true }))).toBeNull(); // unbound letter
    expect(resolveWorkbenchShortcut(ev({ key: "a" }))).toBeNull();
    expect(resolveWorkbenchShortcut(ev({ key: "F5" }))).toBeNull();
  });

  it("ignores Ctrl/Cmd chords that also hold Alt (reserved for the OS)", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "s", ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveWorkbenchShortcut(ev({ key: "f", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("still routes the bare function keys even with Alt held (no Ctrl required)", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "F1", altKey: true }))?.command).toBe("openHelp");
  });

  it("routes Alt+Insert to the Add Ladder Element picker as a global command", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "Insert", altKey: true }))).toEqual({
      command: "addLadderElement",
      global: true,
    });
    // Ctrl+Alt+Insert and a bare Insert are not the picker chord.
    expect(resolveWorkbenchShortcut(ev({ key: "Insert", altKey: true, ctrlKey: true }))).toBeNull();
    expect(resolveWorkbenchShortcut(ev({ key: "Insert" }))).toBeNull();
  });

  it("routes bare Delete and Backspace to ladder selection delete", () => {
    expect(resolveWorkbenchShortcut(ev({ key: "Delete" }))).toEqual({
      command: "deleteSelection",
      global: false,
    });
    expect(resolveWorkbenchShortcut(ev({ key: "Backspace" }))).toEqual({
      command: "deleteSelection",
      global: false,
    });
    expect(resolveWorkbenchShortcut(ev({ key: "Delete", ctrlKey: true }))).toBeNull();
  });
});

describe("shortcutLabel", () => {
  it("produces a label for every command the resolver can emit", () => {
    const commands: WorkbenchCommand[] = [
      "findNext",
      "findPrevious",
      "openFind",
      "openHelp",
      "cycleTabNext",
      "cycleTabPrevious",
      "newProject",
      "openProject",
      "saveProject",
      "saveProjectAs",
      "copyRung",
      "cutRung",
      "pasteRung",
      "addLadderElement",
      "deleteSelection",
      "undo",
      "redo",
    ];
    for (const command of commands) {
      expect(shortcutLabel(command)).toMatch(/[A-Za-z0-9]/);
    }
  });

  it("uses recognisable IDE accelerator strings", () => {
    expect(shortcutLabel("openFind")).toBe("Ctrl+F");
    expect(shortcutLabel("saveProjectAs")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel("openHelp")).toBe("F1");
    expect(shortcutLabel("deleteSelection")).toBe("Del");
  });
});
