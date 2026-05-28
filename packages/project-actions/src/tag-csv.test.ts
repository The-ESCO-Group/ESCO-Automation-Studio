import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createTag,
  type PlcProject,
} from "@esco/core";
import { applyTagCsvImport, exportTagsCsv, previewTagCsvImport } from "./tag-csv";
import { getAllTags } from "./helpers";

function buildProject(): PlcProject {
  const project = createProject("CsvCtl");
  const controller = createController(project.id, "CsvCtl");
  controller.controllerTags.push(
    createTag(controller.id, "Start", "BOOL", { value: false, description: "Start PB" }),
    createTag(controller.id, "Arr", "DINT", { value: 0, dimension: 8 }),
  );
  const alias = createTag(controller.id, "MotorCmd", "ALIAS", { value: 0 });
  alias.aliasFor = "Start";
  controller.controllerTags.push(alias);
  const program = createProgram(controller.id, "MainProgram");
  program.programTags.push(
    createTag(controller.id, "LocalFlag", "BOOL", {
      scope: "program",
      programId: program.id,
      value: false,
    }),
  );
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const HEADER = "Scope,Program,Name,DataType,Dimension,AliasFor,ExternalAccess,Description";

describe("exportTagsCsv", () => {
  it("writes a header plus one row per controller and program tag", () => {
    const csv = exportTagsCsv(buildProject());
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(5); // header + 4 tags
    expect(csv).toContain("controller,,Start,BOOL,,,,Start PB");
    expect(csv).toContain("controller,,Arr,DINT,8,,,");
    expect(csv).toContain("controller,,MotorCmd,ALIAS,,Start,,");
    expect(csv).toContain("program,MainProgram,LocalFlag,BOOL,,,,");
  });

  it("quotes fields containing commas", () => {
    const project = buildProject();
    project.controllers[0]!.controllerTags[0]!.description = "Start, then run";
    expect(exportTagsCsv(project)).toContain('"Start, then run"');
  });

  it("round-trips: exporting then re-importing is all updates, no creates", () => {
    const project = buildProject();
    const preview = previewTagCsvImport(project, exportTagsCsv(project));
    expect(preview.createCount).toBe(0);
    expect(preview.errorCount).toBe(0);
    expect(preview.updateCount).toBe(4);
  });
});

describe("previewTagCsvImport", () => {
  it("classifies rows as create / update against the project", () => {
    const csv = `${HEADER}
controller,,Start,BOOL,,,,Updated start
controller,,NewTag,DINT,,,,Brand new
program,MainProgram,LocalCounter,COUNTER,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    expect(preview.errorCount).toBe(0);
    expect(preview.updateCount).toBe(1); // Start
    expect(preview.createCount).toBe(2); // NewTag, LocalCounter
  });

  it("flags duplicates, invalid names, missing types, and unknown programs as errors", () => {
    const csv = `${HEADER}
controller,,Start,BOOL,,,,
controller,,Start,BOOL,,,,
controller,,123bad,DINT,,,,
controller,,NoType,,,,,
program,Ghost,Tag1,BOOL,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    expect(preview.errorCount).toBe(4); // dup Start, 123bad, NoType, Ghost program
    expect(preview.updateCount).toBe(1); // first Start
    const messages = preview.rows.flatMap((r) => r.messages).join(" | ");
    expect(messages).toMatch(/Duplicate tag "Start"/);
    expect(messages).toMatch(/Invalid tag name "123bad"/);
    expect(messages).toMatch(/Missing data type/);
    expect(messages).toMatch(/Program "Ghost" not found/);
  });

  it("warns (but still creates) for an unmodeled data type", () => {
    const csv = `${HEADER}\ncontroller,,PumpData,PumpUdt,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    const row = preview.rows[0]!;
    expect(row.status).toBe("create");
    expect(row.messages.join(" ")).toMatch(/Unmodeled data type "PumpUdt"/);
  });

  it("requires Name and DataType columns", () => {
    const preview = previewTagCsvImport(buildProject(), "Scope,Description\ncontroller,x");
    expect(preview.warnings.join(" ")).toMatch(/must include.*Name.*DataType/i);
    expect(preview.rows).toHaveLength(0);
  });
});

describe("applyTagCsvImport", () => {
  it("creates new tags, updates existing ones, and skips error rows without mutating the input", () => {
    const project = buildProject();
    const csv = `${HEADER}
controller,,Start,BOOL,,,,Updated start
controller,,NewTag,DINT,4,,read-only,Fresh
program,MainProgram,LocalCounter,COUNTER,,,,
controller,,123bad,DINT,,,,`;
    const result = applyTagCsvImport(project, csv);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ created: 2, updated: 1, skipped: 1 });

    const tags = getAllTags(result.project);
    expect(tags.find((t) => t.name === "Start")?.description).toBe("Updated start");
    const newTag = tags.find((t) => t.name === "NewTag");
    expect(newTag?.dataType).toBe("DINT");
    expect(newTag?.dimension).toBe(4);
    expect(newTag?.externalAccess).toBe("read-only");

    // Program-scoped create landed in the right program.
    const program = result.project.controllers[0]!.programs[0]!;
    expect(program.programTags.find((t) => t.name === "LocalCounter")?.scope).toBe("program");

    // Input project is untouched.
    expect(project.controllers[0]!.controllerTags.find((t) => t.name === "Start")?.description).toBe("Start PB");
    expect(getAllTags(project).some((t) => t.name === "NewTag")).toBe(false);
  });

  it("attaches validation findings to the result", () => {
    const result = applyTagCsvImport(buildProject(), `${HEADER}\ncontroller,,Extra,BOOL,,,,`);
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
