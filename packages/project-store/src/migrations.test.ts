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
import { migrateV2toV3, migrateV3toV4, migrateV4toV5 } from "./migrations";

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

describe("v3->v4 normalize project metadata", () => {
  it("backfills timestamps, parent ids, and scheduled arrays from an older shape", () => {
    const legacy = {
      formatVersion: 3,
      savedAt: "2026-05-29T08:00:00.000Z",
      project: {
        id: "p1",
        name: "Plant",
        controllers: [
          {
            id: "c1",
            name: "Ctl",
            tasks: [{ id: "t1", name: "MainTask", type: "continuous" }],
            programs: [
              {
                id: "pr1",
                name: "MainProgram",
                routines: [{ id: "r1", name: "MainRoutine", language: "ladder" }],
                programTags: [],
              },
            ],
            controllerTags: [],
            dataTypes: [],
            addOnInstructions: [],
            ioConfiguration: { modules: [] },
          },
        ],
      },
    };

    const migrated = migrateV3toV4(structuredClone(legacy));
    const project = migrated.project as any;
    const controller = project.controllers[0];
    const task = controller.tasks[0];
    const program = controller.programs[0];
    const routine = program.routines[0];

    expect(project.createdAt).toBe("2026-05-29T08:00:00.000Z");
    expect(project.updatedAt).toBe("2026-05-29T08:00:00.000Z");
    expect(project.description).toBe("");
    expect(controller.projectId).toBe("p1");
    expect(task.controllerId).toBe("c1");
    expect(task.scheduledProgramIds).toEqual([]);
    expect(program.controllerId).toBe("c1");
    expect(routine.programId).toBe("pr1");
  });

  it("lets the loader migrate v3 metadata to the current version", () => {
    const project = demoProject();
    const legacy = JSON.parse(serializeProject(project));
    legacy.formatVersion = 3;
    delete legacy.project.createdAt;
    delete legacy.project.updatedAt;
    delete legacy.project.controllers[0].projectId;

    const result = deserializeProjectFile(JSON.stringify(legacy));
    expect(result.migrationsApplied).toContain("v3->v4: normalize project metadata");
    expect(result.project.createdAt).toBe(legacy.savedAt);
    expect(result.project.updatedAt).toBe(legacy.savedAt);
    expect(result.project.controllers[0]!.projectId).toBe(project.id);
  });
});

describe("v4->v5 backfill project change history", () => {
  it("backfills an empty changeLog when absent", () => {
    const legacy = {
      formatVersion: 4,
      project: {
        id: "p1",
        name: "Plant",
        controllers: [{ id: "c1", name: "Ctl", tasks: [], programs: [], controllerTags: [] }],
      },
    };
    const migrated = migrateV4toV5(structuredClone(legacy));
    expect((migrated.project as any).changeLog).toEqual([]);
  });

  it("leaves an existing changeLog untouched (idempotent)", () => {
    const existing = [
      { id: "ch1", at: "2026-06-01T00:00:00.000Z", type: "created", summary: "Created project" },
    ];
    const file = {
      formatVersion: 4,
      project: {
        id: "p1",
        name: "Plant",
        controllers: [{ id: "c1", name: "Ctl", tasks: [], programs: [], controllerTags: [] }],
        changeLog: structuredClone(existing),
      },
    };
    const migrated = migrateV4toV5(structuredClone(file));
    expect((migrated.project as any).changeLog).toEqual(existing);
  });

  it("leaves a structurally broken project for the loader to reject", () => {
    const broken = { formatVersion: 4, project: { id: "x" } };
    const migrated = migrateV4toV5(structuredClone(broken));
    expect(migrated).toEqual(broken); // unchanged; no changeLog backfilled
  });

  it("lets the loader migrate a v4 file (no changeLog) to v5 with an empty log", () => {
    const project = demoProject();
    const legacy = JSON.parse(serializeProject(project));
    legacy.formatVersion = 4;
    delete legacy.project.changeLog;

    const result = deserializeProjectFile(JSON.stringify(legacy));
    expect(result.migrationsApplied).toContain("v4->v5: backfill project change history");
    expect(result.project.changeLog).toEqual([]);
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
