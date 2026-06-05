import { describe, expect, it } from "vitest";
import { SettingsStore, memoryStorage } from "./settings";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  loadWorkbenchLayout,
  normalizeWorkbenchLayout,
  saveWorkbenchLayout,
} from "./workbench-layout";

const store = () => new SettingsStore(memoryStorage(), "esco-test");

describe("normalizeWorkbenchLayout", () => {
  it("returns the default layout for empty / nullish input", () => {
    expect(normalizeWorkbenchLayout(null)).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(normalizeWorkbenchLayout(undefined)).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(normalizeWorkbenchLayout({})).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("keeps valid fields and fills missing ones from the default", () => {
    expect(normalizeWorkbenchLayout({ dockTab: "forces" })).toEqual({
      ...DEFAULT_WORKBENCH_LAYOUT,
      dockTab: "forces",
    });
    expect(
      normalizeWorkbenchLayout({ dockTab: "model", copilotTab: "model", rightPanelOpen: true }),
    ).toEqual({ dockTab: "model", copilotTab: "model", rightPanelOpen: true });
  });

  it("rejects unknown tab values and non-boolean flags", () => {
    expect(
      normalizeWorkbenchLayout({ dockTab: "nope", copilotTab: 42, rightPanelOpen: "yes" }),
    ).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });
});

describe("loadWorkbenchLayout / saveWorkbenchLayout", () => {
  it("returns the default layout when nothing is stored", () => {
    expect(loadWorkbenchLayout(store())).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("round-trips a saved layout", () => {
    const s = store();
    saveWorkbenchLayout({ dockTab: "trend", copilotTab: "model", rightPanelOpen: true }, s);
    expect(loadWorkbenchLayout(s)).toEqual({
      dockTab: "trend",
      copilotTab: "model",
      rightPanelOpen: true,
    });
  });

  it("merges partial updates over what is already persisted", () => {
    const s = store();
    saveWorkbenchLayout({ dockTab: "watch", rightPanelOpen: true }, s);
    saveWorkbenchLayout({ dockTab: "references" }, s);
    expect(loadWorkbenchLayout(s)).toEqual({
      dockTab: "references",
      copilotTab: "chat",
      rightPanelOpen: true,
    });
  });

  it("recovers gracefully from a corrupt stored value", () => {
    const backing = memoryStorage({ "esco-test.workbench.layout.v1": "{not json" });
    const s = new SettingsStore(backing, "esco-test");
    expect(loadWorkbenchLayout(s)).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("returns the normalised layout it persisted", () => {
    const s = store();
    const result = saveWorkbenchLayout({ dockTab: "tasks" }, s);
    expect(result).toEqual({ dockTab: "tasks", copilotTab: "chat", rightPanelOpen: false });
  });
});
