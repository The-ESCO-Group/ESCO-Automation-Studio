import { describe, expect, it } from "vitest";
import { SettingsStore, memoryStorage } from "./settings";
import {
  loadRecentProjects,
  markRecentProjectMissing,
  normalizeRecentProjects,
  rememberRecentProject,
} from "./recent-projects";

describe("recent project metadata", () => {
  it("uses a stable path id and dedupes desktop-backed projects", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    let recent = loadRecentProjects(store);
    recent = rememberRecentProject(recent, {
      projectId: "proj_1",
      name: "Line 1",
      source: "opened",
      storage: "desktop-file",
      fileName: "Line1.plcproj.json",
      path: "C:\\Projects\\Line1.plcproj.json",
    }, store);
    recent = rememberRecentProject(recent, {
      projectId: "proj_1",
      name: "Line 1 Renamed",
      source: "exported",
      storage: "desktop-file",
      fileName: "Line1.plcproj.json",
      path: "C:\\Projects\\Line1.plcproj.json",
    }, store);

    expect(recent).toHaveLength(1);
    expect(recent[0]!.id).toBe("path:C:\\Projects\\Line1.plcproj.json");
    expect(recent[0]!.name).toBe("Line 1 Renamed");
    expect(recent[0]!.status).toBe("available");
    expect(loadRecentProjects(store)).toEqual(recent);
  });

  it("marks missing desktop files without dropping the useful metadata", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    const recent = rememberRecentProject([], {
      name: "Missing",
      source: "opened",
      storage: "desktop-file",
      fileName: "Missing.plcproj.json",
      path: "C:\\Missing.plcproj.json",
    }, store);

    const marked = markRecentProjectMissing(recent, recent[0]!.id, store);
    expect(marked[0]!.status).toBe("missing");
    expect(marked[0]!.path).toBe("C:\\Missing.plcproj.json");
    expect(loadRecentProjects(store)[0]!.status).toBe("missing");
  });

  it("normalizes legacy metadata-only entries safely", () => {
    const entries = normalizeRecentProjects([
      { id: "legacy", name: "Old", source: "imported", fileName: "Old.L5X", at: "2026-01-01T00:00:00.000Z" },
      { nope: true },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.storage).toBe("metadata");
    expect(entries[0]!.status).toBe("unknown");
  });
});
