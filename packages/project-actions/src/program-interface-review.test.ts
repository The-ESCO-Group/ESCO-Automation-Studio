import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, type ProgramParameter } from "@esco/core";
import { programInterfaceReviewReport } from "./program-interface-review";

function parameter(input: Partial<ProgramParameter> & Pick<ProgramParameter, "name" | "dataType">): ProgramParameter {
  return {
    name: input.name,
    dataType: input.dataType,
    usage: input.usage,
    required: input.required,
    dimension: input.dimension,
    dimensions: input.dimensions,
    defaultValue: input.defaultValue,
    description: input.description,
    radix: input.radix,
    externalAccess: input.externalAccess,
  };
}

describe("programInterfaceReviewReport", () => {
  it("reviews imported Input, Output, and InOut program parameters with offline boundaries", () => {
    const project = createProject("Program Interface Review");
    const controller = createController(project.id, "LineCtl");
    const program = createProgram(controller.id, "Filler");
    program.safetyClass = "Standard";
    program.parameters = [
      parameter({
        name: "Start",
        dataType: "BOOL",
        usage: "Input",
        required: true,
        defaultValue: "0",
        description: "Start request",
        radix: "Decimal",
        externalAccess: "read-write",
      }),
      parameter({ name: "Ready", dataType: "BOOL", usage: "Output", externalAccess: "read-only" }),
      parameter({ name: "Recipe", dataType: "RecipeType", usage: "InOut", dimension: 2, dimensions: [2, 3] }),
    ];
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = programInterfaceReviewReport(project);
    expect(report.programCount).toBe(1);
    expect(report.programWithParametersCount).toBe(1);
    expect(report.parameterCount).toBe(3);
    expect(report.inputCount).toBe(1);
    expect(report.outputCount).toBe(1);
    expect(report.inOutCount).toBe(1);
    expect(report.requiredCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      programName: "Filler",
      safetyClass: "Standard",
      status: "reviewable",
      connectionModelled: false,
      runtimeTransferModelled: false,
      controllerVerified: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-cross-program-parameter-binding",
      "no-program-connection-scheduling",
      "no-runtime-parameter-transfer",
      "no-controller-verified-interface",
    ]));
    expect(report.rows[0]?.parameters).toEqual([
      expect.objectContaining({
        name: "Start",
        dataType: "BOOL",
        usage: "Input",
        direction: "input",
        required: true,
        defaultValue: "0",
        description: "Start request",
        radix: "Decimal",
        externalAccess: "read-write",
        issues: [],
      }),
      expect.objectContaining({ name: "Ready", direction: "output", externalAccess: "read-only" }),
      expect.objectContaining({ name: "Recipe", direction: "inout", dimension: 2, dimensions: [2, 3] }),
    ]);
  });

  it("reports programs without imported parameters as empty review rows", () => {
    const project = createProject("Empty Interface");
    const controller = createController(project.id, "Ctl");
    controller.programs.push(createProgram(controller.id, "NoParams"));
    project.controllers.push(controller);

    const report = programInterfaceReviewReport(project);
    expect(report.programCount).toBe(1);
    expect(report.emptyProgramCount).toBe(1);
    expect(report.parameterCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      programName: "NoParams",
      status: "empty",
      parameters: [],
      message: "Program \"NoParams\" has no imported program parameters to review.",
    });
  });

  it("flags malformed hand-edited program parameter metadata", () => {
    const project = createProject("Bad Interface");
    const controller = createController(project.id, "Ctl");
    const program = createProgram(controller.id, "BadParams");
    program.parameters = [
      parameter({ name: "", dataType: "BOOL", usage: "Input" }),
      parameter({ name: "NoType", dataType: "", usage: "Output" }),
      parameter({ name: "Buffer", dataType: "DINT", usage: "Buffer" }),
      parameter({ name: "BadArray", dataType: "DINT", usage: "InOut", dimension: 2, dimensions: [3, -1] }),
    ];
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = programInterfaceReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.parameterIssueCount).toBe(4);
    expect(report.missingNameCount).toBe(1);
    expect(report.missingDataTypeCount).toBe(1);
    expect(report.unknownUsageCount).toBe(1);
    expect(report.invalidDimensionCount).toBe(1);
    expect(report.rows[0]?.status).toBe("needs-attention");
    expect(report.rows[0]?.issues).toEqual([
      "missing-name",
      "missing-data-type",
      "unknown-usage",
      "invalid-dimensions",
    ]);
    expect(report.rows[0]?.parameters.map((row) => row.issues)).toEqual([
      ["missing-name"],
      ["missing-data-type"],
      ["unknown-usage"],
      ["invalid-dimensions"],
    ]);
    expect(report.warnings[0]).toMatch(/missing parameter name/);
    expect(report.warnings[0]).toMatch(/invalid parameter dimensions/);
  });
});
