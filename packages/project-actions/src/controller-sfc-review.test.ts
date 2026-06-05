import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerSfcExecutionReviewReport } from "./controller-sfc-review";

describe("controllerSfcExecutionReviewReport", () => {
  it("projects imported controller SFC execution metadata with offline execution boundaries", () => {
    const project = createProject("SFC Review");
    const controller = createController(project.id, "LineCtl");
    controller.sfcExecutionControl = "CurrentActive";
    controller.sfcRestartPosition = "MostRecent";
    controller.sfcLastScan = "DontScan";
    project.controllers.push(controller);

    const report = controllerSfcExecutionReviewReport(project);

    expect(report.controllerCount).toBe(1);
    expect(report.controllersWithSfcMetadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      sfcExecutionControl: "CurrentActive",
      sfcRestartPosition: "MostRecent",
      sfcLastScan: "DontScan",
      hasSfcMetadata: true,
      status: "reviewable",
      sfcStepEngineModelled: false,
      transitionEvaluationModelled: false,
      restartStateModelled: false,
      lastScanExecutionModelled: false,
      controllerVerifiedSfcScheduling: false,
    });
    expect(report.rows[0]?.boundaries).toEqual([
      "no-sfc-step-engine",
      "no-sfc-transition-evaluation",
      "no-sfc-restart-state",
      "no-sfc-last-scan-execution",
      "no-controller-verified-sfc-scheduling",
    ]);
  });

  it("keeps controllers without imported SFC execution metadata as empty review rows", () => {
    const project = createProject("No SFC Metadata");
    project.controllers.push(createController(project.id, "PlainCtl"));

    const report = controllerSfcExecutionReviewReport(project);

    expect(report.controllerCount).toBe(1);
    expect(report.controllersWithSfcMetadataCount).toBe(0);
    expect(report.emptyControllerCount).toBe(1);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "PlainCtl",
      hasSfcMetadata: false,
      status: "empty",
      issues: [],
    });
    expect(report.rows[0]?.message).toMatch(/no imported SFC execution-control metadata/);
  });

  it("flags partial imported SFC execution settings without validating vendor enum values", () => {
    const project = createProject("Partial SFC Metadata");
    const controller = createController(project.id, "PartialCtl");
    controller.sfcExecutionControl = "CurrentActive";
    project.controllers.push(controller);

    const report = controllerSfcExecutionReviewReport(project);

    expect(report.controllersWithSfcMetadataCount).toBe(1);
    expect(report.issueCount).toBe(1);
    expect(report.missingExecutionControlCount).toBe(0);
    expect(report.missingRestartPositionCount).toBe(1);
    expect(report.missingLastScanCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      issues: ["missing-restart-position", "missing-last-scan"],
    });
    expect(report.warnings[0]).toMatch(/missing SFCRestartPosition/);
    expect(report.warnings[0]).toMatch(/missing SFCLastScan/);
  });
});
