import { describe, expect, it } from "vitest";
import { MAX_CHANGE_LOG_ENTRIES, appendProjectChange } from "./change-log";
import { createProject } from "./factory";
import type { ProjectChangeEntry } from "./types";

function entry(n: number): ProjectChangeEntry {
  return {
    id: `change-${n}`,
    at: new Date(n).toISOString(),
    type: "edit",
    summary: `Change ${n}`,
  };
}

describe("appendProjectChange", () => {
  it("appends an entry to a project with no existing log", () => {
    const project = createProject("Audit");
    const next = appendProjectChange(project, entry(1));
    expect(next.changeLog).toEqual([entry(1)]);
  });

  it("appends to the end of an existing log (oldest first)", () => {
    const project = createProject("Audit");
    const next = appendProjectChange(appendProjectChange(project, entry(1)), entry(2));
    expect(next.changeLog).toEqual([entry(1), entry(2)]);
  });

  it("does not mutate the input project", () => {
    const project = createProject("Audit");
    const next = appendProjectChange(project, entry(1));
    expect(project.changeLog).toBeUndefined();
    expect(next).not.toBe(project);
    expect(next.changeLog).not.toBe(project.changeLog);
  });

  it("does not mutate an existing log array", () => {
    const project = { ...createProject("Audit"), changeLog: [entry(1)] };
    const before = project.changeLog;
    const next = appendProjectChange(project, entry(2));
    expect(before).toEqual([entry(1)]); // original array untouched
    expect(next.changeLog).toEqual([entry(1), entry(2)]);
  });

  it("caps the log to the most recent MAX_CHANGE_LOG_ENTRIES entries", () => {
    let project = createProject("Audit");
    const total = MAX_CHANGE_LOG_ENTRIES + 25;
    for (let i = 0; i < total; i++) {
      project = appendProjectChange(project, entry(i));
    }
    expect(project.changeLog).toHaveLength(MAX_CHANGE_LOG_ENTRIES);
    // The oldest 25 entries were dropped; the most recent are kept in order.
    expect(project.changeLog![0]).toEqual(entry(total - MAX_CHANGE_LOG_ENTRIES));
    expect(project.changeLog![MAX_CHANGE_LOG_ENTRIES - 1]).toEqual(entry(total - 1));
  });

  it("MAX_CHANGE_LOG_ENTRIES is a sensible positive cap", () => {
    expect(MAX_CHANGE_LOG_ENTRIES).toBe(500);
  });
});
