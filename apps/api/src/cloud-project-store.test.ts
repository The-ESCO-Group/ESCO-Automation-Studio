import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import type { PlcProject } from "@esco/core";
import {
  CloudProjectConflictError,
  CloudProjectNotFoundError,
  CloudProjectStore,
} from "./cloud-project-store";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    await rm(cleanupDirs.pop()!, { recursive: true, force: true });
  }
});

async function tempStore(): Promise<CloudProjectStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "esco-cloud-project-store-"));
  cleanupDirs.push(dir);
  return new CloudProjectStore(dir);
}

function demoProject(name = "Line 1"): PlcProject {
  const project = createProject(name, "Packaging line");
  project.id = "project-line-1";
  const controller = createController(project.id, "PLC_1");
  const program = createProgram(controller.id, "MainProgram");
  program.routines.push(createRoutine(program.id, "MainRoutine"));
  program.programTags.push(createTag(controller.id, "ProgramCount", "DINT", { scope: "program", programId: program.id }));
  controller.programs.push(program);
  controller.controllerTags.push(createTag(controller.id, "LineReady", "BOOL"));
  project.controllers.push(controller);
  return project;
}

describe("CloudProjectStore", () => {
  it("saves, lists, and reads canonical ESCO project files", async () => {
    const store = await tempStore();
    const project = demoProject();

    const saved = await store.save(project);
    const list = await store.list();
    const opened = await store.read(project.id);

    expect(saved.summary).toMatchObject({
      id: "project-line-1",
      name: "Line 1",
      controllerCount: 1,
      routineCount: 1,
      tagCount: 2,
    });
    expect(saved.summary.revision).toMatch(/^sha256:/);
    expect(list.map((entry) => entry.id)).toEqual(["project-line-1"]);
    expect(opened.project.name).toBe("Line 1");
    expect(opened.summary.revision).toBe(saved.summary.revision);
  });

  it("rejects stale expected revisions", async () => {
    const store = await tempStore();
    const first = await store.save(demoProject());
    const updated = demoProject("Line 1 Updated");
    await store.save(updated);

    await expect(store.save(demoProject("Stale Write"), { expectedRevision: first.summary.revision }))
      .rejects.toBeInstanceOf(CloudProjectConflictError);
  });

  it("reports missing projects clearly", async () => {
    const store = await tempStore();

    await expect(store.read("missing-project")).rejects.toBeInstanceOf(CloudProjectNotFoundError);
    expect(await store.delete("missing-project")).toBe(false);
  });
});
