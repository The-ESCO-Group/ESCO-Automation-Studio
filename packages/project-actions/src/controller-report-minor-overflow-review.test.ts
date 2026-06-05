import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerReportMinorOverflowReviewReport } from "./controller-report-minor-overflow-review";

describe("controllerReportMinorOverflowReviewReport", () => {
  it("reviews enabled and disabled ReportMinorOverflow metadata with offline boundaries", () => {
    const project = createProject("Report Minor Overflow Review");
    const enabled = createController(project.id, "EnabledCtl");
    enabled.reportMinorOverflow = "true";
    const disabled = createController(project.id, "DisabledCtl");
    disabled.reportMinorOverflow = "0";
    project.controllers.push(enabled, disabled);

    const report = controllerReportMinorOverflowReviewReport(project);
    expect(report.controllerCount).toBe(2);
    expect(report.metadataCount).toBe(2);
    expect(report.reviewableCount).toBe(2);
    expect(report.enabledCount).toBe(1);
    expect(report.disabledCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "EnabledCtl",
      reportMinorOverflow: "true",
      reportMinorOverflowEnabled: true,
      reportMinorOverflowPresent: true,
      status: "overflow-reporting-enabled",
      controllerCommunicationModelled: false,
      arithmeticOverflowFaultGenerationModelled: false,
      minorFaultStatusModelled: false,
      controllerFaultLogModelled: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "DisabledCtl",
      reportMinorOverflow: "0",
      reportMinorOverflowEnabled: false,
      reportMinorOverflowPresent: true,
      status: "reviewable",
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-arithmetic-overflow-fault-generation",
      "no-minor-fault-status",
      "no-controller-fault-log",
      "no-download-preflight",
    ]));
  });

  it("flags malformed ReportMinorOverflow metadata", () => {
    const project = createProject("Bad Report Minor Overflow");
    const controller = createController(project.id, "BadCtl");
    controller.reportMinorOverflow = "sometimes";
    project.controllers.push(controller);

    const report = controllerReportMinorOverflowReviewReport(project);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(1);
    expect(report.invalidFlagCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BadCtl",
      reportMinorOverflow: "sometimes",
      reportMinorOverflowEnabled: undefined,
      status: "needs-attention",
      issues: ["invalid-report-minor-overflow-flag"],
    });
    expect(report.warnings.join("\n")).toMatch(/ReportMinorOverflow/);
  });

  it("marks controllers without imported ReportMinorOverflow metadata as no-metadata", () => {
    const project = createProject("No Report Minor Overflow");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerReportMinorOverflowReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      reportMinorOverflowPresent: false,
      status: "no-metadata",
      arithmeticOverflowFaultGenerationModelled: false,
    });
  });
});
