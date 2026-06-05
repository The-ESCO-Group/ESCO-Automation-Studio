import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag } from "@esco/core";
import {
  convertEngineeringUnitValue,
  formatEngineeringUnitValue,
  normalizeEngineeringUnit,
  tagEngineeringUnitReviewReport,
} from "./tag-engineering-units-review";

describe("tagEngineeringUnitReviewReport", () => {
  it("reviews tag-level, array-element, and UDT-member engineering units with offline formatting and conversion previews", () => {
    const project = createProject("Engineering Units");
    const controller = createController(project.id, "UnitsCtl");
    controller.dataTypes.push({
      id: "udt_motor",
      name: "MOTOR_UDT",
      members: [
        { name: "Speed", dataType: "REAL" },
        { name: "Torque", dataType: "REAL" },
      ],
    });
    controller.controllerTags.push(
      {
        ...createTag(controller.id, "Pressure", "REAL"),
        engineeringUnits: [{ operand: "", text: "psi" }],
      },
      {
        ...createTag(controller.id, "Flows", "REAL", { dimensions: [3] }),
        engineeringUnits: [{ operand: "[2]", text: "gal/min" }],
      },
      {
        ...createTag(controller.id, "Motor", "MOTOR_UDT"),
        engineeringUnits: [{ operand: ".Speed", text: "RPM" }],
      },
    );
    project.controllers.push(controller);

    const report = tagEngineeringUnitReviewReport(project);
    expect(report.rowCount).toBe(3);
    expect(report.tagWithUnitsCount).toBe(3);
    expect(report.controllerScopeUnitCount).toBe(3);
    expect(report.tagLevelUnitCount).toBe(1);
    expect(report.memberOrElementUnitCount).toBe(2);
    expect(report.issueCount).toBe(0);
    expect(report.knownUnitCount).toBe(3);
    expect(report.unknownUnitTextCount).toBe(0);
    expect(report.engineeringUnitConversionModelledCount).toBe(3);
    expect(report.liveDisplayFormattingModelledCount).toBe(3);
    expect(report.rows.map((row) => row.path).sort()).toEqual(["Flows[2]", "Motor.Speed", "Pressure"]);
    const pressure = report.rows.find((row) => row.path === "Pressure");
    expect(pressure).toMatchObject({
      normalizedUnitText: "psi",
      engineeringUnitFamily: "pressure",
      formatPreview: "12.35 psi",
      engineeringUnitConversionModelled: true,
      onlineTagPropertyEditModelled: false,
      controllerDownloadModelled: false,
      liveDisplayFormattingModelled: true,
    });
    expect(pressure?.conversionPreview).toMatch(/psi -> .*bar \/ .*kPa/);
    expect(pressure?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-online-tag-property-edit",
      "no-controller-download",
    ]));
    expect(pressure?.boundaries).not.toContain("no-engineering-unit-conversion");
    expect(pressure?.boundaries).not.toContain("no-live-display-formatting");
  });

  it("flags duplicate operands, blank unit text, invalid members, and bad array indexes", () => {
    const project = createProject("Engineering Unit Issues");
    const controller = createController(project.id, "BadUnitsCtl");
    controller.dataTypes.push({
      id: "udt_motor",
      name: "MOTOR_UDT",
      members: [{ name: "Speed", dataType: "REAL" }],
    });
    controller.controllerTags.push(
      {
        ...createTag(controller.id, "Pressure", "REAL"),
        engineeringUnits: [
          { operand: "", text: "psi" },
          { operand: "", text: "" },
        ],
      },
      {
        ...createTag(controller.id, "Flows", "REAL", { dimensions: [2] }),
        engineeringUnits: [{ operand: "[2]", text: "L/min" }],
      },
      {
        ...createTag(controller.id, "Motor", "MOTOR_UDT"),
        engineeringUnits: [{ operand: ".Torque", text: "N*m" }],
      },
      {
        ...createTag(controller.id, "Scalar", "REAL"),
        engineeringUnits: [{ operand: "[0]", text: "degC" }],
      },
    );
    project.controllers.push(controller);

    const report = tagEngineeringUnitReviewReport(project);
    expect(report.issueCount).toBe(5);
    expect(report.blankUnitTextCount).toBe(1);
    expect(report.duplicateOperandCount).toBe(2);
    expect(report.invalidOperandCount).toBe(3);
    expect(report.rows.find((row) => row.path === "Flows[2]")?.issues).toEqual(["array-index-out-of-range"]);
    expect(report.rows.find((row) => row.path === "Motor.Torque")?.issues).toEqual(["unknown-member"]);
    expect(report.rows.find((row) => row.path === "Scalar[0]")?.issues).toEqual(["array-index-on-scalar"]);
    expect(report.warnings.join("\n")).toMatch(/duplicate engineering-unit operand/);
    expect(report.warnings.join("\n")).toMatch(/unknown member/);
  });

  it("includes program-scoped tag engineering units in the review", () => {
    const project = createProject("Program Units");
    const controller = createController(project.id, "UnitsCtl");
    const program = createProgram(controller.id, "Mixing");
    program.programTags.push({
      ...createTag(controller.id, "BatchWeight", "REAL", { scope: "program", programId: program.id }),
      engineeringUnits: [{ operand: "", text: "kg" }],
    });
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = tagEngineeringUnitReviewReport(project);
    expect(report.rowCount).toBe(1);
    expect(report.programScopeUnitCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      programName: "Mixing",
      tagName: "BatchWeight",
      tagScope: "program",
      path: "BatchWeight",
      unitText: "kg",
      status: "reviewable",
      normalizedUnitText: "kg",
      engineeringUnitConversionModelled: true,
      liveDisplayFormattingModelled: true,
    });
  });

  it("converts and formats known scalar engineering units without controller writes", () => {
    expect(normalizeEngineeringUnit("degC")).toMatchObject({ display: "degC", family: "temperature" });
    expect(normalizeEngineeringUnit("\u00b0F")).toMatchObject({ display: "degF", family: "temperature" });
    expect(formatEngineeringUnitValue(12.345, "psi")).toMatchObject({
      ok: true,
      text: "12.35 psi",
    });
    expect(convertEngineeringUnitValue(25, "degC", "degF")).toMatchObject({
      ok: true,
      value: 77,
      text: "77.00 degF",
    });
    expect(convertEngineeringUnitValue(10, "gpm", "L/min")).toMatchObject({
      ok: true,
      text: "37.85 L/min",
    });
    expect(convertEngineeringUnitValue(1, "psi", "degF")).toMatchObject({
      ok: false,
      reason: "incompatible-unit-family",
    });
  });
});
