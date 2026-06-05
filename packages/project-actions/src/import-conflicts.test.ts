import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type IoModule,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import {
  collectEscoImportNames,
  previewEscoImportConflicts,
  resolveEscoImportConflicts,
  suggestEscoImportRename,
  type EscoImportIncomingItem,
} from "./index";

function fixture(): PlcProject {
  const project = createProject("Import Conflicts");
  const controller = createController(project.id, "MainController");
  const program = createProgram(controller.id, "MainProgram");
  program.routines.push(createRoutine(program.id, "MainRoutine", "ladder"));
  program.programTags.push(
    createTag(controller.id, "LocalStart", "BOOL", { scope: "program", programId: program.id }),
  );

  const dataType: UserDefinedType = {
    id: "udt_motor",
    name: "MotorData",
    members: [{ name: "Run", dataType: "BOOL" }],
  };
  const customInstruction: AddOnInstruction = {
    id: "ci_scale",
    name: "ScaleInstruction",
    parameters: [],
    localTags: [],
    routineNames: [],
  };
  const device: IoModule = {
    id: "dev_local_di",
    name: "LocalDI",
    catalogNumber: "1756-IB16",
  };

  controller.programs.push(program);
  controller.controllerTags.push(createTag(controller.id, "StartPB", "BOOL"));
  controller.dataTypes.push(dataType, { ...dataType, id: "udt_motor_1", name: "MotorData_1" });
  controller.addOnInstructions.push(customInstruction);
  controller.ioConfiguration.modules.push(device);
  project.controllers.push(controller);
  return project;
}

describe("ESCO import conflict preview", () => {
  it("previews collisions across routines, programs, data types, custom instructions, and device definitions", () => {
    const incoming: EscoImportIncomingItem[] = [
      { kind: "program", name: "MainProgram" },
      { kind: "routine", programName: "MainProgram", name: "MainRoutine" },
      { kind: "data-type", name: "MotorData" },
      { kind: "custom-instruction", name: "ScaleInstruction" },
      { kind: "device-definition", name: "LocalDI" },
    ];

    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming,
    });

    expect(preview.conflictCount).toBe(5);
    expect(preview.rows.map((row) => [row.kind, row.status, row.suggestedName])).toEqual([
      ["program", "conflict", "MainProgram_1"],
      ["routine", "conflict", "MainRoutine_1"],
      ["data-type", "conflict", "MotorData_2"],
      ["custom-instruction", "conflict", "ScaleInstruction_1"],
      ["device-definition", "conflict", "LocalDI_1"],
    ]);

    const plan = resolveEscoImportConflicts({ preview });
    expect(plan.errors).toEqual([]);
    expect(plan.renameCount).toBe(5);
    expect(plan.actions.map((action) => action.finalName)).toEqual([
      "MainProgram_1",
      "MainRoutine_1",
      "MotorData_2",
      "ScaleInstruction_1",
      "LocalDI_1",
    ]);
  });

  it("generates deterministic rename suffixes", () => {
    expect(suggestEscoImportRename("MotorData", ["MotorData", "MotorData_1"])).toBe("MotorData_2");
    expect(suggestEscoImportRename("VeryLongImportComponentNameThatExceedsForty", [])).toBe(
      "VeryLongImportComponentNameThatExceedsForty",
    );
    expect(
      suggestEscoImportRename("VeryLongImportComponentNameThatExceedsForty", [
        "VeryLongImportComponentNameThatExceedsForty",
      ]),
    ).toBe("VeryLongImportComponentNameThatExceeds_1");
  });

  it("resolves skip choices without creating an import action", () => {
    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming: [{ kind: "program", name: "MainProgram" }],
    });

    const plan = resolveEscoImportConflicts({
      preview,
      choices: [{ id: preview.rows[0]!.id, option: "skip" }],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.skipCount).toBe(1);
    expect(plan.actions[0]).toMatchObject({
      action: "skip",
      kind: "program",
      originalName: "MainProgram",
    });
  });

  it("resolves overwrite choices against the existing ESCO component name", () => {
    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming: [{ kind: "data-type", name: "motordata" }],
    });

    const plan = resolveEscoImportConflicts({
      preview,
      choices: [{ id: preview.rows[0]!.id, option: "overwrite" }],
    });

    expect(plan.errors).toEqual([]);
    expect(plan.overwriteCount).toBe(1);
    expect(plan.actions[0]).toMatchObject({
      action: "overwrite",
      existingName: "MotorData",
      finalName: "MotorData",
    });
  });

  it("maps an incoming tag reference to an existing ESCO tag", () => {
    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming: [{ kind: "tag-reference", name: "StartPB" }],
    });

    expect(preview.mappedTagReferenceCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      status: "tag-reference-mapped",
      existingName: "StartPB",
      defaultOption: "map-existing-tag",
    });

    const plan = resolveEscoImportConflicts({ preview });
    expect(plan.errors).toEqual([]);
    expect(plan.mappedTagCount).toBe(1);
    expect(plan.actions[0]).toMatchObject({
      action: "map-existing-tag",
      targetName: "StartPB",
      tagScope: "controller",
    });
  });

  it("creates a deterministic new ESCO tag action for a missing tag reference", () => {
    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming: [{ kind: "tag-reference", name: "SpeedCommand", dataType: "REAL", tagScope: "controller" }],
    });

    expect(preview.missingTagReferenceCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      status: "tag-reference-missing",
      suggestedName: "SpeedCommand",
      defaultOption: "create-new-tag",
    });

    const plan = resolveEscoImportConflicts({ preview });
    expect(plan.errors).toEqual([]);
    expect(plan.createdTagCount).toBe(1);
    expect(plan.actions[0]).toMatchObject({
      action: "create-new-tag",
      finalName: "SpeedCommand",
      dataType: "REAL",
      tagScope: "controller",
    });
  });

  it("renames duplicate incoming components deterministically", () => {
    const preview = previewEscoImportConflicts({
      existingNames: collectEscoImportNames(fixture()),
      incoming: [
        { kind: "routine", programName: "MainProgram", name: "Helper" },
        { kind: "routine", programName: "MainProgram", name: "Helper" },
      ],
    });

    expect(preview.rows.map((row) => [row.status, row.suggestedName])).toEqual([
      ["new", undefined],
      ["duplicate-in-import", "Helper_1"],
    ]);

    const plan = resolveEscoImportConflicts({ preview });
    expect(plan.errors).toEqual([]);
    expect(plan.actions.map((action) => [action.action, action.finalName])).toEqual([
      ["import", "Helper"],
      ["rename", "Helper_1"],
    ]);
  });
});
