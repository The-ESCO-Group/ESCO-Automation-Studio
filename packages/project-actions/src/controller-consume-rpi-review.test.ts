import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerConsumeRpiReviewReport } from "./controller-consume-rpi-review";

describe("controllerConsumeRpiReviewReport", () => {
  it("reviews both consumed-tag RPI source spellings with offline boundaries", () => {
    const project = createProject("RPI Source Review");
    const controller = createController(project.id, "LineCtl");
    controller.canUseRPIFromProducer = "true";
    const documented = createController(project.id, "DocCtl");
    documented.canUseRPIFromController = "0";
    project.controllers.push(controller, documented);

    const report = controllerConsumeRpiReviewReport(project);
    expect(report.controllerCount).toBe(2);
    expect(report.metadataCount).toBe(2);
    expect(report.reviewableCount).toBe(2);
    expect(report.enabledCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      canUseRPIFromProducer: "true",
      canUseRPIFromProducerValue: true,
      effectiveCanUseRPIFromProducer: true,
      status: "rpi-from-producer-enabled",
      controllerCommunicationModelled: false,
      consumedTagConnectionModelled: false,
      rpiNegotiationModelled: false,
      rpiSchedulingModelled: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "DocCtl",
      canUseRPIFromController: "0",
      canUseRPIFromControllerValue: false,
      effectiveCanUseRPIFromProducer: false,
      status: "reviewable",
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-consumed-tag-connection",
      "no-rpi-negotiation",
      "no-rpi-scheduling",
      "no-download-preflight",
    ]));
  });

  it("flags malformed and conflicting controller RPI source flags", () => {
    const project = createProject("RPI Source Issues");
    const invalid = createController(project.id, "InvalidCtl");
    invalid.canUseRPIFromController = "sometimes";
    const conflict = createController(project.id, "ConflictCtl");
    conflict.canUseRPIFromProducer = "true";
    conflict.canUseRPIFromController = "false";
    project.controllers.push(invalid, conflict);

    const report = controllerConsumeRpiReviewReport(project);
    expect(report.issueCount).toBe(2);
    expect(report.invalidFlagCount).toBe(1);
    expect(report.conflictingFlagCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["invalid-can-use-rpi-from-controller-flag"]);
    expect(report.rows[1]?.issues).toEqual(["conflicting-rpi-source-flags"]);
    expect(report.warnings.join("\n")).toMatch(/CanUseRPIFromController/);
    expect(report.warnings.join("\n")).toMatch(/disagree/);
  });

  it("marks controllers without imported RPI source metadata as no-metadata", () => {
    const project = createProject("No RPI Source");
    project.controllers.push(createController(project.id, "PlainCtl"));

    const report = controllerConsumeRpiReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "PlainCtl",
      status: "no-metadata",
      controllerCommunicationModelled: false,
      rpiSchedulingModelled: false,
    });
  });
});
