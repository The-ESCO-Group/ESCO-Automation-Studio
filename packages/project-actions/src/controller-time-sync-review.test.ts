import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerTimeSyncReviewReport } from "./controller-time-sync-review";

describe("controllerTimeSyncReviewReport", () => {
  it("reviews imported TimeSynchronize metadata with offline CIP Sync boundaries", () => {
    const project = createProject("Controller Time Sync Review");
    const controller = createController(project.id, "SyncCtl");
    controller.timeSync = {
      ptpEnable: true,
      priority1: "128",
      priority2: "200",
    };
    project.controllers.push(controller);

    const report = controllerTimeSyncReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.timeSyncCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.ptpEnabledCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SyncCtl",
      ptpEnable: true,
      priority1: "128",
      priority1Value: 128,
      priority2: "200",
      priority2Value: 200,
      timeSyncPresent: true,
      ptpEnablePresent: true,
      priority1Present: true,
      priority2Present: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      controllerClockSyncModelled: false,
      cipSyncRuntimeModelled: false,
      ptpGrandmasterElectionModelled: false,
      controllerTimeQualityModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-controller-clock-sync",
      "no-cip-sync-runtime",
      "no-ptp-grandmaster-election",
      "no-controller-time-quality",
    ]));
  });

  it("flags partial and malformed TimeSynchronize priority metadata", () => {
    const project = createProject("Bad Time Sync");
    const partial = createController(project.id, "PartialCtl");
    partial.timeSync = { priority1: "256" };
    const malformed = createController(project.id, "MalformedCtl");
    malformed.timeSync = {
      ptpEnable: false,
      priority1: "abc",
      priority2: "-1",
    };
    project.controllers.push(partial, malformed);

    const report = controllerTimeSyncReviewReport(project);
    expect(report.timeSyncCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.partialTimeSyncCount).toBe(1);
    expect(report.invalidPriorityCount).toBe(3);
    expect(report.rows[0]?.issues).toEqual(["partial-time-sync", "invalid-priority1"]);
    expect(report.rows[1]?.issues).toEqual(["invalid-priority1", "invalid-priority2"]);
    expect(report.warnings.join("\n")).toMatch(/TimeSynchronize metadata/);
    expect(report.warnings.join("\n")).toMatch(/Priority1/);
    expect(report.warnings.join("\n")).toMatch(/Priority2/);
  });

  it("marks controllers without imported TimeSynchronize as no-metadata", () => {
    const project = createProject("No Time Sync");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerTimeSyncReviewReport(project);
    expect(report.timeSyncCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      timeSyncPresent: false,
      ptpEnablePresent: false,
      priority1Present: false,
      priority2Present: false,
      status: "no-metadata",
      controllerClockSyncModelled: false,
    });
  });
});
