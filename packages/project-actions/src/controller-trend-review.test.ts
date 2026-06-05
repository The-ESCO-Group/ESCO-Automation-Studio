import { createController, createProject, type ControllerTrend } from "@esco/core";
import { describe, expect, it } from "vitest";
import { controllerTrendReviewReport } from "./controller-trend-review";

function trend(name: string, options: Partial<ControllerTrend> = {}): ControllerTrend {
  return {
    id: `trend-${name}`,
    name,
    attributes: {
      SamplePeriod: "10",
      NumberOfCaptures: "1",
      CaptureSizeType: "Samples",
      CaptureSize: "1000",
      StartTriggerType: "No Trigger",
      StopTriggerType: "No Trigger",
      TrendxVersion: "5.2",
      ...options.attributes,
    },
    pens: [
      {
        id: `pen-${name}-0`,
        name: "PumpPressure",
        attributes: {
          Color: "16#00ff_0000",
          Visible: "true",
          Width: "2",
          Type: "Analog",
          Min: "0.0",
          Max: "100.0",
          EngUnits: "psi",
        },
      },
    ],
    ...options,
  };
}

describe("controllerTrendReviewReport", () => {
  it("projects imported trend configuration with explicit offline boundaries", () => {
    const project = createProject("TrendProject");
    const controller = createController(project.id, "TrendCtl");
    controller.trends = [trend("PumpTrend", { description: "Pump checkout", template: "[1,2]" })];
    project.controllers.push(controller);

    const report = controllerTrendReviewReport(project);

    expect(report.trendCount).toBe(1);
    expect(report.penCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "TrendCtl",
      trendName: "PumpTrend",
      description: "Pump checkout",
      samplePeriod: "10",
      samplePeriodMs: 10,
      numberOfCaptures: "1",
      numberOfCapturesValue: 1,
      templatePresent: true,
      controllerCommunicationModelled: false,
      onlineTrendRunModelled: false,
      controllerSamplingModelled: false,
      trendLogCaptureModelled: false,
      sampledDataExported: false,
    });
    expect(report.rows[0]?.pens[0]).toMatchObject({
      penName: "PumpPressure",
      tagSpecifier: "PumpPressure",
      color: "16#00ff_0000",
      engineeringUnits: "psi",
    });
    expect(report.rows[0]?.boundaries).toContain("no-controller-sampling");
  });

  it("flags trend definitions that exceed Studio-style trend configuration bounds", () => {
    const project = createProject("TrendProject");
    const controller = createController(project.id, "TrendCtl");
    controller.trends = [
      trend("EmptyTrend", { pens: [] }),
      trend("HugeTrend", {
        attributes: { SamplePeriod: "0", NumberOfCaptures: "101" },
        pens: Array.from({ length: 9 }, (_, index) => ({
          id: `pen-${index}`,
          name: `Tag${index}`,
        })),
      }),
    ];
    project.controllers.push(controller);

    const report = controllerTrendReviewReport(project);

    expect(report.trendCount).toBe(2);
    expect(report.issueCount).toBe(2);
    expect(report.noPenCount).toBe(1);
    expect(report.tooManyPensCount).toBe(1);
    expect(report.invalidSamplePeriodCount).toBe(1);
    expect(report.invalidNumberOfCapturesCount).toBe(1);
    expect(report.rows.find((row) => row.trendName === "EmptyTrend")?.issues).toEqual(["no-pens"]);
    expect(report.rows.find((row) => row.trendName === "HugeTrend")?.issues).toEqual([
      "too-many-pens",
      "invalid-sample-period",
      "invalid-number-of-captures",
    ]);
  });
});
