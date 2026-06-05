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
  const start = createTag(controller.id, "Start", "BOOL", { value: false, description: "Start PB" });
  start.radix = "Decimal";
  start.comments = [{ operand: "", text: "Panel start pushbutton" }];
  const arr = createTag(controller.id, "Arr", "DINT", { value: 0, dimension: 8 });
  arr.engineeringUnits = [{ operand: "[0]", text: "counts" }];
  controller.controllerTags.push(
    start,
    arr,
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

const HEADER = "Scope,Program,Name,DataType,Dimension,AliasFor,Constant,ExternalAccess,Radix,Description,Comments,EngineeringUnits";

describe("exportTagsCsv", () => {
  it("writes a header plus one row per controller and program tag", () => {
    const csv = exportTagsCsv(buildProject());
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(5); // header + 4 tags
    expect(csv).toContain("controller,,Start,BOOL,,,,,Decimal,Start PB");
    expect(csv).toContain("Panel start pushbutton");
    expect(csv).toContain("controller,,Arr,DINT,8,,,,,");
    expect(csv).toContain("counts");
    expect(csv).toContain("controller,,MotorCmd,ALIAS,,Start,,,,,,");
    expect(csv).toContain("program,MainProgram,LocalFlag,BOOL,,,,,,,,");
  });

  it("quotes fields containing commas", () => {
    const project = buildProject();
    project.controllers[0]!.controllerTags[0]!.description = "Start, then run";
    expect(exportTagsCsv(project)).toContain('"Start, then run"');
  });

  it("exports full multi-dimensional array dimensions", () => {
    const project = buildProject();
    project.controllers[0]!.controllerTags.push(
      createTag(project.controllers[0]!.id, "Matrix", "DINT", { dimensions: [2, 3] }),
    );
    expect(exportTagsCsv(project)).toContain("controller,,Matrix,DINT,2 3,,,,,");
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
controller,,Start,BOOL,,,,,,Updated start,,
controller,,NewTag,DINT,,,,,,Brand new,,
program,MainProgram,LocalCounter,COUNTER,,,,,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    expect(preview.errorCount).toBe(0);
    expect(preview.updateCount).toBe(1); // Start
    expect(preview.createCount).toBe(2); // NewTag, LocalCounter
  });

  it("flags duplicates, invalid names, missing types, and unknown programs as errors", () => {
    const csv = `${HEADER}
controller,,Start,BOOL,,,,,,,,
controller,,Start,BOOL,,,,,,,,
controller,,123bad,DINT,,,,,,,,
controller,,Bad__Name,DINT,,,,,,,,
controller,,NoType,,,,,,,,
program,Ghost,Tag1,BOOL,,,,,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    expect(preview.errorCount).toBe(5); // dup Start, 123bad, Bad__Name, NoType, Ghost program
    expect(preview.updateCount).toBe(1); // first Start
    const messages = preview.rows.flatMap((r) => r.messages).join(" | ");
    expect(messages).toMatch(/Duplicate controller tag "Start"/);
    expect(messages).toMatch(/Invalid tag name "123bad"/);
    expect(messages).toMatch(/consecutive underscores/);
    expect(messages).toMatch(/Missing data type/);
    expect(messages).toMatch(/Program "Ghost" not found/);
  });

  it("flags unknown data types as preview errors", () => {
    const csv = `${HEADER}\ncontroller,,PumpData,PumpUdt,,,,,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);
    const row = preview.rows[0]!;
    expect(preview.errorCount).toBe(1);
    expect(row.status).toBe("error");
    expect(row.messages.join(" ")).toMatch(/Unknown data type "PumpUdt"/);
  });

  it("parses multi-dimensional dimensions from space- or comma-separated cells", () => {
    const csv = `${HEADER}
controller,,SpaceMatrix,DINT,2 3,,,,,,,
controller,,CommaMatrix,DINT,"4,5",,,,,,,`;
    const preview = previewTagCsvImport(buildProject(), csv);

    expect(preview.errorCount).toBe(0);
    expect(preview.rows.find((row) => row.row?.name === "SpaceMatrix")?.row).toMatchObject({
      dimension: 2,
      dimensions: [2, 3],
    });
    expect(preview.rows.find((row) => row.row?.name === "CommaMatrix")?.row).toMatchObject({
      dimension: 4,
      dimensions: [4, 5],
    });
  });

  it("parses quoted newlines plus radix, comments, and engineering units", () => {
    const comments = JSON.stringify([{ operand: ".Cmd", text: "Command bit" }]).replace(/"/g, '""');
    const units = JSON.stringify([{ operand: "", text: "psi" }]).replace(/"/g, '""');
    const csv = `${HEADER}
controller,,Start,BOOL,,,,,Hex,"Line one
Line two","${comments}","${units}"`;
    const preview = previewTagCsvImport(buildProject(), csv);

    expect(preview.errorCount).toBe(0);
    expect(preview.updateCount).toBe(1);
    expect(preview.rows[0]?.row).toMatchObject({
      name: "Start",
      radix: "Hex",
      description: "Line one\nLine two",
      comments: [{ operand: ".Cmd", text: "Command bit" }],
      engineeringUnits: [{ operand: "", text: "psi" }],
    });
  });

  it("validates duplicate annotation operands during preview", () => {
    const duplicateComments = JSON.stringify([
      { operand: "[0]", text: "First" },
      { operand: "[0]", text: "Duplicate" },
    ]).replace(/"/g, '""');
    const csv = `${HEADER}\ncontroller,,Start,BOOL,,,,,Decimal,,\"${duplicateComments}\",`;
    const preview = previewTagCsvImport(buildProject(), csv);

    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.messages.join(" ")).toMatch(/Duplicate tag comment operand "\[0]"/);
  });

  it("requires Name and DataType columns", () => {
    const preview = previewTagCsvImport(buildProject(), "Scope,Description\ncontroller,x");
    expect(preview.warnings.join(" ")).toMatch(/must include.*Name.*DataType/i);
    expect(preview.rows).toHaveLength(0);
  });
});

describe("applyTagCsvImport", () => {
  it("creates new tags and updates existing ones without mutating the input", () => {
    const project = buildProject();
    const csv = `${HEADER}
controller,,Start,BOOL,,,,,,Updated start,,
controller,,NewTag,DINT,4,,true,read-only,,Fresh,,
program,MainProgram,LocalCounter,COUNTER,,,,,,,,`;
    const result = applyTagCsvImport(project, csv);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ created: 2, updated: 1, skipped: 0 });

    const tags = getAllTags(result.project);
    expect(tags.find((t) => t.name === "Start")?.description).toBe("Updated start");
    const newTag = tags.find((t) => t.name === "NewTag");
    expect(newTag?.dataType).toBe("DINT");
    expect(newTag?.dimension).toBe(4);
    expect(newTag?.constant).toBe(true);
    expect(newTag?.externalAccess).toBe("read-only");

    // Program-scoped create landed in the right program.
    const program = result.project.controllers[0]!.programs[0]!;
    expect(program.programTags.find((t) => t.name === "LocalCounter")?.scope).toBe("program");

    // Input project is untouched.
    expect(project.controllers[0]!.controllerTags.find((t) => t.name === "Start")?.description).toBe("Start PB");
    expect(getAllTags(project).some((t) => t.name === "NewTag")).toBe(false);
  });

  it("applies radix, comments, engineering units, and clears them from blank cells", () => {
    const project = buildProject();
    const comments = JSON.stringify([{ operand: ".Run", text: "Running bit" }]).replace(/"/g, '""');
    const units = JSON.stringify([{ operand: "", text: "rpm" }]).replace(/"/g, '""');
    const csv = `${HEADER}
controller,,Start,BOOL,,,,,Hex,Updated,"${comments}","${units}"
controller,,Arr,DINT,8,,,,,, ,`;
    const result = applyTagCsvImport(project, csv);

    expect(result.ok).toBe(true);
    const start = getAllTags(result.project).find((t) => t.name === "Start");
    const arr = getAllTags(result.project).find((t) => t.name === "Arr");
    expect(start).toMatchObject({
      radix: "Hex",
      description: "Updated",
      comments: [{ operand: ".Run", text: "Running bit" }],
      engineeringUnits: [{ operand: "", text: "rpm" }],
    });
    expect(arr?.comments).toBeUndefined();
    expect(arr?.engineeringUnits).toBeUndefined();
  });

  it("refuses to apply a CSV with preview errors", () => {
    const project = buildProject();
    const csv = `${HEADER}
controller,,NewTag,DINT,,,,,,Fresh,,
controller,,123bad,DINT,,,,,,,,`;
    const result = applyTagCsvImport(project, csv);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/preview and fix/i);
    expect(result.project).toBe(project);
    expect(getAllTags(project).some((t) => t.name === "NewTag")).toBe(false);
  });

  it("updates same-named tags only within the CSV row's Logix scope", () => {
    const project = buildProject();
    const controller = project.controllers[0]!;
    controller.controllerTags.push(
      createTag(controller.id, "LocalFlag", "BOOL", { value: false, description: "Controller scoped" }),
    );
    const csv = `${HEADER}
program,MainProgram,LocalFlag,BOOL,,,,,,Program scoped,,
controller,,LocalFlag,BOOL,,,,,,Controller edited,,`;

    const preview = previewTagCsvImport(project, csv);
    expect(preview.errorCount).toBe(0);
    expect(preview.updateCount).toBe(2);

    const result = applyTagCsvImport(project, csv);
    expect(result.ok).toBe(true);
    expect(result.project.controllers[0]!.controllerTags.find((tag) => tag.name === "LocalFlag")?.description)
      .toBe("Controller edited");
    expect(result.project.controllers[0]!.programs[0]!.programTags.find((tag) => tag.name === "LocalFlag")?.description)
      .toBe("Program scoped");
  });

  it("creates and updates tags with full multi-dimensional array metadata", () => {
    const project = buildProject();
    const csv = `${HEADER}
controller,,Arr,DINT,2 3,,,,,,,
controller,,Matrix,DINT,4 5,,,,,,,`;
    const result = applyTagCsvImport(project, csv);

    expect(result.ok).toBe(true);
    const tags = getAllTags(result.project);
    expect(tags.find((t) => t.name === "Arr")).toMatchObject({
      dimension: 2,
      dimensions: [2, 3],
    });
    expect(tags.find((t) => t.name === "Matrix")).toMatchObject({
      dimension: 4,
      dimensions: [4, 5],
    });
  });

  it("attaches validation findings to the result", () => {
    const result = applyTagCsvImport(buildProject(), `${HEADER}\ncontroller,,Extra,BOOL,,,,,,,,`);
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
