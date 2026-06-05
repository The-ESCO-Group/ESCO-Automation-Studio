import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerExportFileReviewReport } from "./controller-export-file-review";

describe("controllerExportFileReviewReport", () => {
  it("reviews imported export date + embedded context with offline boundaries", () => {
    const project = createProject("Export File Review");
    const controller = createController(project.id, "ExpCtl");
    controller.exportDate = "Tue Jan 02 14:03:11 2024";
    controller.containsContext = "true";
    project.controllers.push(controller);

    const report = controllerExportFileReviewReport(project);

    expect(report.controllerCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.metadataCount).toBe(1);
    expect(report.exportDateCount).toBe(1);
    expect(report.containsContextCount).toBe(1);
    expect(report.partialContextExportCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "ExpCtl",
      exportDate: "Tue Jan 02 14:03:11 2024",
      containsContext: "true",
      exportDatePresent: true,
      containsContextPresent: true,
      embedsProjectContext: true,
      exportFileMetadataPresent: true,
      status: "reviewable",
      issues: [],
      controllerCommunicationModelled: false,
      exportTimeVerified: false,
      exportRegenerationModelled: false,
      contextResolutionModelled: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-export-time-verification",
      "no-export-regeneration",
      "no-context-resolution",
      "no-download-preflight",
    ]));
    expect(report.rows[0]?.message).toMatch(/export file is reviewable offline/);
    expect(report.rows[0]?.message).toMatch(/embeds project context/);
  });

  it("accepts a space-padded single-digit day and surfaces a partial (no-context) export", () => {
    const project = createProject("Partial Context Review");
    const controller = createController(project.id, "PartialCtl");
    controller.exportDate = "Tue Jan  2 14:03:11 2024";
    controller.containsContext = "false";
    project.controllers.push(controller);

    const report = controllerExportFileReviewReport(project);

    expect(report.issueCount).toBe(0);
    expect(report.reviewableCount).toBe(1);
    expect(report.partialContextExportCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "reviewable",
      embedsProjectContext: false,
      containsContextPresent: true,
    });
    expect(report.rows[0]?.message).toMatch(/no embedded project context \(partial export\)/);
  });

  it("flags a malformed export date and an unrecognized ContainsContext flag", () => {
    const project = createProject("Bad Export File Review");
    const badDate = createController(project.id, "BadDate");
    badDate.exportDate = "2024-01-02T14:03:11Z";
    badDate.containsContext = "true";
    const badFlag = createController(project.id, "BadFlag");
    badFlag.exportDate = "Tue Jan 02 14:03:11 2024";
    badFlag.containsContext = "yes";
    project.controllers.push(badDate, badFlag);

    const report = controllerExportFileReviewReport(project);

    expect(report.issueCount).toBe(2);
    expect(report.invalidExportDateCount).toBe(1);
    expect(report.unrecognizedContainsContextCount).toBe(1);
    expect(report.rows.map((row) => [row.controllerName, row.status, row.issues])).toEqual([
      ["BadDate", "needs-attention", ["invalid-export-date-format"]],
      ["BadFlag", "needs-attention", ["unrecognized-contains-context-flag"]],
    ]);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings[0]).toMatch(/ExportDate should use the expected controller-editor timestamp format/);
    expect(report.warnings[1]).toMatch(/ContainsContext should be true or false/);
  });

  it("marks controllers without imported export file metadata as no-metadata", () => {
    const project = createProject("No Export File Review");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerExportFileReviewReport(project);

    expect(report).toMatchObject({
      controllerCount: 1,
      reviewableCount: 0,
      metadataCount: 0,
      exportDateCount: 0,
      containsContextCount: 0,
      partialContextExportCount: 0,
      issueCount: 0,
      warnings: [],
    });
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      exportFileMetadataPresent: false,
      status: "no-metadata",
      embedsProjectContext: false,
      issues: [],
    });
    expect(report.rows[0]?.message).toMatch(/no imported export file metadata/);
  });
});
