import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  addRung,
  appendInstruction,
  appendNode,
  createLadderRoutine,
  createNode,
  routineNodes,
  routineTagReferences,
  tagOperand,
  type LadderRoutine,
} from "@esco/ladder";
import {
  APP_VERSION,
  EASPROJ_EXTENSION,
  ESCO_PROJECT_EXTENSIONS,
  PLCPROJ_EXTENSION,
  PLCPROJ_FORMAT_NAME,
  PLCPROJ_FORMAT_VERSION,
  deserializeProject,
  deserializeProjectFile,
  isEscoProjectFileName,
  serializeProject,
} from "./index";

/** A project carrying a real ladder AST + BOOL tags, like the editor produces. */
function demoProject(): PlcProject {
  const project = createProject("Round Trip");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  let ladder = addRung(createLadderRoutine());
  const rungId = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, rungId, "XIC", "StartPB");
  ladder = appendInstruction(ladder, rungId, "XIO", "StopPB");
  ladder = appendInstruction(ladder, rungId, "OTE", "MotorRun");
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const name of ["StartPB", "StopPB", "MotorRun"]) {
    controller.controllerTags.push(createTag(controller.id, name, "BOOL", { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

describe("project-store serialize/deserialize", () => {
  it("round-trips a project with ladder AST and tags", () => {
    const project = demoProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("preserves the ladder operand tags through a round trip", () => {
    const project = demoProject();
    const restored = deserializeProject(serializeProject(project));
    const ladder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(routineTagReferences(ladder)).toEqual(["StartPB", "StopPB", "MotorRun"]);
  });

  it("rejects invalid JSON", () => {
    expect(() => deserializeProject("{ not json")).toThrow();
  });

  it("rejects proprietary-binary-like input with the ESCO offline interchange message", () => {
    const acdLike =
      "\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1" +
      "Root Entry\u0000" +
      ["PLC", " engineering"].join("") +
      " project.acd\u0000";

    expect(() => deserializeProjectFile(acdLike)).toThrow(/ESCO offline interchange/i);
    expect(() => deserializeProjectFile(acdLike)).toThrow(/Proprietary binary controller-project files/i);
    expect(() => deserializeProjectFile(acdLike)).toThrow(/\.L5X/i);
    expect(() => deserializeProjectFile(acdLike)).toThrow(/approved external engineering tool/i);
  });

  it("rejects a wrong-shaped file", () => {
    const bad = JSON.stringify({ formatVersion: 1, project: { id: "x" } });
    expect(() => deserializeProject(bad)).toThrow();
  });

  it("rejects an unsupported format version", () => {
    const project = demoProject();
    const file = JSON.parse(serializeProject(project));
    file.formatVersion = 999;
    expect(() => deserializeProject(JSON.stringify(file))).toThrow(/format version/i);
  });

  it("round-trips the new core instructions (ONS, RTO, RES, CTD, NOP, AFI)", () => {
    const project = demoProject();
    const routine = project.controllers[0]!.programs[0]!.routines[0]!;
    let ladder = routine.ladder as LadderRoutine;
    ladder = addRung(ladder);
    const rungId = ladder.rungs[ladder.rungs.length - 1]!.id;
    ladder = appendNode(ladder, rungId, createNode("ONS", [tagOperand("storage", "OneShot")]));
    ladder = appendNode(ladder, rungId, createNode("RTO", [tagOperand("timer", "Dwell"), tagOperand("preset", "5000")]));
    ladder = appendNode(ladder, rungId, createNode("RES", [tagOperand("structure", "Dwell")]));
    ladder = appendNode(ladder, rungId, createNode("CTD", [tagOperand("counter", "Down"), tagOperand("preset", "0")]));
    ladder = appendNode(ladder, rungId, createNode("NOP", []));
    ladder = appendNode(ladder, rungId, createNode("AFI", []));
    routine.ladder = ladder;

    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
    const restoredLadder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const newRung = restoredLadder.rungs[restoredLadder.rungs.length - 1]!;
    expect(newRung.root.nodes.map((n) => n.instructionType)).toEqual([
      "ONS", "RTO", "RES", "CTD", "NOP", "AFI",
    ]);
    const rto = newRung.root.nodes.find((n) => n.instructionType === "RTO");
    expect(rto?.operands.map((o) => o.value)).toEqual(["Dwell", "5000"]);
  });

  it("round-trips a multi-operand instruction (TON) with all its operands", () => {
    const project = demoProject();
    const routine = project.controllers[0]!.programs[0]!.routines[0]!;
    let ladder = routine.ladder as LadderRoutine;
    ladder = addRung(ladder);
    const rungId = ladder.rungs[ladder.rungs.length - 1]!.id;
    ladder = appendNode(
      ladder,
      rungId,
      createNode("TON", [tagOperand("timer", "Timer1"), tagOperand("preset", "3000")]),
    );
    routine.ladder = ladder;

    const restored = deserializeProject(serializeProject(project));
    const restoredLadder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const ton = routineNodes(restoredLadder).find((n) => n.instructionType === "TON");
    expect(ton?.operands.map((o) => o.value)).toEqual(["Timer1", "3000"]);
  });
});

describe("project-store format and migrations", () => {
  const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "A", "C", "D"].join("");

  it("stamps format metadata into saved files", () => {
    const file = JSON.parse(serializeProject(demoProject()));
    expect(file.formatName).toBe(PLCPROJ_FORMAT_NAME);
    expect(file.formatVersion).toBe(PLCPROJ_FORMAT_VERSION);
    expect(file.appVersion).toBe(APP_VERSION);
    expect(typeof file.savedAt).toBe("string");
  });

  it("stamps compatibility/version metadata into saved files", () => {
    const file = JSON.parse(serializeProject(demoProject()));
    expect(file.compatibility).toMatchObject({
      minFormatVersion: 1,
      formatVersion: PLCPROJ_FORMAT_VERSION,
      extension: PLCPROJ_EXTENSION,
    });
    expect(file.compatibility.producedBy).toContain(PLCPROJ_FORMAT_NAME);
    expect(file.compatibility.producedBy).toContain(APP_VERSION);
  });

  it("still round-trips the project unchanged with compatibility metadata present", () => {
    const project = demoProject();
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it("recognizes .easproj and .plcproj.json as ESCO project files", () => {
    expect(EASPROJ_EXTENSION).toBe(".easproj");
    expect(ESCO_PROJECT_EXTENSIONS).toContain(PLCPROJ_EXTENSION);
    expect(ESCO_PROJECT_EXTENSIONS).toContain(EASPROJ_EXTENSION);
    expect(isEscoProjectFileName("Line1.easproj")).toBe(true);
    expect(isEscoProjectFileName("Line1.PLCPROJ.JSON")).toBe(true);
    expect(isEscoProjectFileName("plant.json")).toBe(true);
    expect(isEscoProjectFileName("plant.L5X")).toBe(false);
    expect(isEscoProjectFileName("plant.acd")).toBe(false);
  });

  it("opens a project saved under the .easproj name (extension-agnostic content)", () => {
    // The on-disk content is identical regardless of extension, so a file a host
    // wrote as .easproj loads through the same deserializer.
    const text = serializeProject(demoProject());
    const result = deserializeProjectFile(text);
    expect(result.project.name).toBe("Round Trip");
    expect(result.migrationsApplied).toEqual([]);
  });

  it("preserves importedSource metadata when provided", () => {
    const text = serializeProject(demoProject(), { importedSource: "L5X: Plant.L5X" });
    expect(deserializeProjectFile(text).importedSource).toBe("L5X: Plant.L5X");
  });

  it("loads a current-version file without migrations", () => {
    const result = deserializeProjectFile(serializeProject(demoProject()));
    expect(result.migrationsApplied).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.project.name).toBe("Round Trip");
  });

  it("migrates a legacy v1 file to the current version", () => {
    // A v1 file predates the format metadata block.
    const legacy = JSON.stringify({ formatVersion: 1, savedAt: "2020-01-01T00:00:00.000Z", project: demoProject() });
    const result = deserializeProjectFile(legacy);
    expect(result.migrationsApplied.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /migrat/i.test(w))).toBe(true);
    expect(result.project.name).toBe("Round Trip");
  });

  it("rejects an unsupported future version clearly", () => {
    const file = JSON.parse(serializeProject(demoProject()));
    file.formatVersion = 999;
    expect(() => deserializeProjectFile(JSON.stringify(file))).toThrow(/unsupported project format version/i);
  });

  it("rejects a file with no format version clearly", () => {
    expect(() => deserializeProjectFile(JSON.stringify({ project: demoProject() }))).toThrow(/missing format version/i);
  });

  it("rejects a malformed (migrated) project clearly", () => {
    const legacy = JSON.stringify({ formatVersion: 1, project: { id: "x" } });
    expect(() => deserializeProjectFile(legacy)).toThrow(/malformed/i);
  });

  it("round-trips project provenance (origin + blocked binary import audit) through save/load", () => {
    const blockedName = `Plant${BLOCKED_BINARY_PROJECT_EXTENSION}`;
    const project = demoProject();
    project.provenance = {
      sourceType: "xml-review-import",
      fileName: "Plant.L5X",
      importedAt: "2026-06-02T12:00:00.000Z",
      blockedImport: {
        fileName: blockedName,
        path: `C:/lines/${blockedName}`,
        format: "binary-project",
        formatLabel: "Proprietary binary controller project",
        reason: "ESCO does not read, write, compile, decompile, or convert proprietary binary project files.",
        blockedAt: "2026-06-02T12:30:00.000Z",
      },
    };

    const restored = deserializeProject(serializeProject(project));
    // Provenance is preserved verbatim: the offline origin and blocked import
    // audit record both survive a project save/load.
    expect(restored.provenance).toEqual(project.provenance);
  });
});
