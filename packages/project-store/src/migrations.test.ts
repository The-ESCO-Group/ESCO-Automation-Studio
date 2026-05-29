import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, type PlcProject } from "@esco/core";
import {
  MIGRATIONS,
  PLCPROJ_FORMAT_VERSION,
  backupFileName,
  deserializeProjectFile,
  serializeProject,
  willMigrate,
} from "./index";
import { migrateV2toV3 } from "./migrations";

function demoProject(): PlcProject {
  const project = createProject("Migrations");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "MainProgram");
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("migration registry", () => {
  it("forms an unbroken chain up to the current version", () => {
    // Every step from 1..current-1 must have exactly one migration.
    for (let v = 1; v < PLCPROJ_FORMAT_VERSION; v++) {
      expect(MIGRATIONS.filter((m) => m.from === v)).toHaveLength(1);
    }
    // Each migration advances by exactly one version.
    for (const m of MIGRATIONS) expect(m.to).toBe(m.from + 1);
  });

  it("chains a legacy v1 file all the way to the current version", () => {
    const legacy = JSON.stringify({ formatVersion: 1, project: demoProject() });
    const result = deserializeProjectFile(legacy);
    // v1->v2 and v2->v3 both applied.
    expect(result.migrationsApplied.length).toBe(PLCPROJ_FORMAT_VERSION - 1);
    expect(result.project.name).toBe("Migrations");
  });

  it("loads a current-version file with no migrations", () => {
    const result = deserializeProjectFile(serializeProject(demoProject()));
    expect(result.migrationsApplied).toEqual([]);
  });
});

describe("v2->v3 normalize project collections", () => {
  it("backfills missing optional arrays without throwing", () => {
    const file = {
      formatVersion: 2,
      project: {
        id: "p1",
        name: "Partial",
        controllers: [
          { id: "c1", name: "Ctl", tasks: [], programs: [{ id: "pr1", name: "Main" }], controllerTags: [] },
        ],
      },
    };
    const migrated = migrateV2toV3(structuredClone(file));
    const controller = (migrated.project as any).controllers[0];
    expect(Array.isArray(controller.dataTypes)).toBe(true);
    expect(Array.isArray(controller.addOnInstructions)).toBe(true);
    expect(controller.ioConfiguration).toEqual({ modules: [] });
    expect(Array.isArray(controller.programs[0].routines)).toBe(true);
    expect(Array.isArray(controller.programs[0].programTags)).toBe(true);
  });

  it("is a no-op for a complete project (round-trips unchanged)", () => {
    const project = demoProject();
    const restored = deserializeProjectFile(serializeProject(project)).project;
    expect(restored).toEqual(project);
  });

  it("leaves a structurally broken project for the loader to reject", () => {
    const broken = { formatVersion: 2, project: { id: "x" } };
    const migrated = migrateV2toV3(structuredClone(broken));
    expect(migrated).toEqual(broken); // unchanged; loader will flag malformed
    expect(() => deserializeProjectFile(JSON.stringify(broken))).toThrow(/malformed/i);
  });
});

describe("backup / compat helpers", () => {
  it("willMigrate is true for an older file and false for a current one", () => {
    expect(willMigrate(JSON.stringify({ formatVersion: 1, project: demoProject() }))).toBe(true);
    expect(willMigrate(serializeProject(demoProject()))).toBe(false);
    expect(willMigrate("{ not json")).toBe(false);
  });

  it("derives a stable, sortable backup filename", () => {
    const name = backupFileName("Plant.plcproj.json", 2, "2026-05-29T08:00:00.000Z");
    expect(name).toBe("Plant.v2.2026-05-29T08-00-00-000Z.bak.plcproj.json");
  });
});
