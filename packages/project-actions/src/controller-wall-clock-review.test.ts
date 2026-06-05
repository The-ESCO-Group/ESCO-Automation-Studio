import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerWallClockReviewReport } from "./controller-wall-clock-review";

describe("controllerWallClockReviewReport", () => {
  it("reviews imported WallClockTime metadata with offline time boundaries", () => {
    const project = createProject("Controller Wall Clock Review");
    const controller = createController(project.id, "ClockCtl");
    controller.wallClockTime = {
      localTimeAdjustment: "-21600000000",
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
    };
    project.controllers.push(controller);

    const report = controllerWallClockReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.wallClockTimeCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "ClockCtl",
      localTimeAdjustment: "-21600000000",
      localTimeAdjustmentHours: -6,
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
      wallClockTimePresent: true,
      localTimeAdjustmentPresent: true,
      timeZonePresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      controllerClockReadModelled: false,
      controllerClockSetModelled: false,
      timeSyncServiceModelled: false,
      timeZoneDialogModelled: false,
      scheduledTimeChangeModelled: false,
      wallClockRuntimeModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-controller-clock-read",
      "no-controller-clock-set",
      "no-time-sync-service",
      "no-time-zone-dialog",
      "no-scheduled-time-change",
      "no-wall-clock-runtime",
    ]));
  });

  it("flags partial and malformed WallClockTime metadata", () => {
    const project = createProject("Bad Wall Clock");
    const partial = createController(project.id, "PartialCtl");
    partial.wallClockTime = { localTimeAdjustment: "abc" };
    const outOfRange = createController(project.id, "OutOfRangeCtl");
    outOfRange.wallClockTime = {
      localTimeAdjustment: "90000000000",
      timeZone: "(GMT+25:00) Impossible",
    };
    project.controllers.push(partial, outOfRange);

    const report = controllerWallClockReviewReport(project);
    expect(report.wallClockTimeCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.partialWallClockTimeCount).toBe(1);
    expect(report.invalidLocalTimeAdjustmentCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "partial-wall-clock-time",
      "invalid-local-time-adjustment",
    ]);
    expect(report.rows[1]?.issues).toEqual(["local-time-adjustment-out-of-range"]);
    expect(report.warnings.join("\n")).toMatch(/LocalTimeAdjustment/);
    expect(report.warnings.join("\n")).toMatch(/outside a \+\/-24 hour offset/);
  });

  it("marks controllers without imported WallClockTime as no-metadata", () => {
    const project = createProject("No Clock");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerWallClockReviewReport(project);
    expect(report.wallClockTimeCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      wallClockTimePresent: false,
      localTimeAdjustmentPresent: false,
      timeZonePresent: false,
      status: "no-metadata",
      controllerClockSetModelled: false,
    });
  });
});
