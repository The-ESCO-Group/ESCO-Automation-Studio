import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerTimeZoneReviewReport } from "./controller-time-zone-review";

describe("controllerTimeZoneReviewReport", () => {
  it("reviews a recognized TimeZone whose GMT offset matches LocalTimeAdjustment", () => {
    const project = createProject("Controller Time Zone Review");
    const controller = createController(project.id, "ClockCtl");
    controller.wallClockTime = {
      localTimeAdjustment: "-21600000000",
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
    };
    project.controllers.push(controller);

    const report = controllerTimeZoneReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.timeZoneCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "ClockCtl",
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
      timeZoneGmtOffsetHours: -6,
      localTimeAdjustmentHours: -6,
      timeZonePresent: true,
      localTimeAdjustmentPresent: true,
      status: "reviewable",
      timeZoneDialogModelled: false,
      daylightSavingRuntimeModelled: false,
      controllerClockRuntimeModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(
      expect.arrayContaining([
        "no-time-zone-dialog",
        "no-daylight-saving-runtime",
        "no-controller-clock-runtime",
      ]),
    );
  });

  it("parses half-hour offsets within tolerance", () => {
    const project = createProject("Half Hour Zone");
    const controller = createController(project.id, "IndiaCtl");
    controller.wallClockTime = {
      localTimeAdjustment: "19800000000", // +5.5h
      timeZone: "(GMT+05:30) Chennai, Kolkata, Mumbai, New Delhi",
    };
    project.controllers.push(controller);

    const report = controllerTimeZoneReviewReport(project);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      timeZoneGmtOffsetHours: 5.5,
      localTimeAdjustmentHours: 5.5,
      status: "reviewable",
    });
  });

  it("flags an unrecognized TimeZone format and an offset mismatch", () => {
    const project = createProject("Bad Time Zones");
    const malformed = createController(project.id, "MalformedCtl");
    malformed.wallClockTime = {
      localTimeAdjustment: "0",
      timeZone: "Central Standard Time",
    };
    const impossible = createController(project.id, "ImpossibleCtl");
    impossible.wallClockTime = { timeZone: "(GMT+25:00) Impossible" };
    const mismatch = createController(project.id, "MismatchCtl");
    mismatch.wallClockTime = {
      localTimeAdjustment: "-21600000000", // -6h
      timeZone: "(GMT-05:00) Eastern Time (US & Canada)",
    };
    project.controllers.push(malformed, impossible, mismatch);

    const report = controllerTimeZoneReviewReport(project);
    expect(report.timeZoneCount).toBe(3);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(3);
    expect(report.unrecognizedFormatCount).toBe(2);
    expect(report.offsetMismatchCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["unrecognized-time-zone-format"]);
    expect(report.rows[1]?.issues).toEqual(["unrecognized-time-zone-format"]);
    expect(report.rows[2]?.issues).toEqual(["time-zone-offset-mismatch"]);
    expect(report.warnings.join("\n")).toMatch(/disagrees with LocalTimeAdjustment/);
  });

  it("does not flag a mismatch when LocalTimeAdjustment is absent or unparsable", () => {
    const project = createProject("Time Zone Only");
    const tzOnly = createController(project.id, "TzOnlyCtl");
    tzOnly.wallClockTime = { timeZone: "(GMT+00:00) Dublin, Edinburgh, Lisbon, London" };
    project.controllers.push(tzOnly);

    const report = controllerTimeZoneReviewReport(project);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      timeZoneGmtOffsetHours: 0,
      localTimeAdjustmentPresent: false,
      status: "reviewable",
    });
    expect(report.rows[0]?.localTimeAdjustmentHours).toBeUndefined();
  });

  it("marks controllers without imported TimeZone as no-metadata", () => {
    const project = createProject("No Time Zone");
    const bare = createController(project.id, "BareCtl");
    const offsetOnly = createController(project.id, "OffsetOnlyCtl");
    offsetOnly.wallClockTime = { localTimeAdjustment: "-21600000000" };
    project.controllers.push(bare, offsetOnly);

    const report = controllerTimeZoneReviewReport(project);
    expect(report.timeZoneCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      timeZonePresent: false,
      status: "no-metadata",
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "OffsetOnlyCtl",
      timeZonePresent: false,
      localTimeAdjustmentPresent: true,
      status: "no-metadata",
    });
  });
});
