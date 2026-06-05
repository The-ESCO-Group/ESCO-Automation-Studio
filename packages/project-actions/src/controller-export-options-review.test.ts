import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerExportOptionsReviewReport } from "./controller-export-options-review";

describe("controllerExportOptionsReviewReport", () => {
  it("reviews a full export option list with offline boundaries", () => {
    const project = createProject("Export Options Review");
    const controller = createController(project.id, "FullCtl");
    controller.exportOptions =
      "References NoRawData L5KData DecoratedData Context Dependencies";
    project.controllers.push(controller);

    const report = controllerExportOptionsReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "FullCtl",
      options: ["References", "NoRawData", "L5KData", "DecoratedData", "Context", "Dependencies"],
      exportOptionsPresent: true,
      partialContextExport: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      exportRegenerationModelled: false,
      dataClassEnforcementModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-export-regeneration",
      "no-data-class-enforcement",
    ]));
  });

  it("flags contradictory raw-data options", () => {
    const project = createProject("Contradictory Options");
    const controller = createController(project.id, "BadRawCtl");
    controller.exportOptions = "References RawData NoRawData DecoratedData";
    project.controllers.push(controller);

    const report = controllerExportOptionsReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.contradictoryRawDataCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      issues: ["contradictory-raw-data-options"],
    });
    expect(report.warnings.join("\n")).toMatch(/RawData and NoRawData/);
  });

  it("flags a duplicated data class (case-insensitive)", () => {
    const project = createProject("Duplicate Options");
    const controller = createController(project.id, "DupCtl");
    controller.exportOptions = "DecoratedData References decorateddata";
    project.controllers.push(controller);

    const report = controllerExportOptionsReviewReport(project);
    expect(report.duplicateOptionCount).toBe(1);
    expect(report.rows[0]?.issues).toContain("duplicate-export-option");
    expect(report.rows[0]?.status).toBe("needs-attention");
  });

  it("flags an export carrying no decoded/raw tag data", () => {
    const project = createProject("Structure-Only Export");
    const controller = createController(project.id, "StructCtl");
    controller.exportOptions = "References NoRawData Dependencies";
    project.controllers.push(controller);

    const report = controllerExportOptionsReviewReport(project);
    expect(report.noDecodedTagDataCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      issues: ["no-decoded-tag-data"],
    });
  });

  it("marks controllers without imported export options as no-metadata", () => {
    const project = createProject("No Export Options");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerExportOptionsReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      options: [],
      exportOptionsPresent: false,
      partialContextExport: false,
      status: "no-metadata",
    });
  });
});
