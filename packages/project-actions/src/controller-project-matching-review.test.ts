import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerProjectMatchingReviewReport } from "./controller-project-matching-review";

describe("controllerProjectMatchingReviewReport", () => {
  it("reviews project/controller matching metadata with offline boundaries", () => {
    const project = createProject("Project Matching");
    const controller = createController(project.id, "LineCtl");
    controller.matchProjectToController = "true";
    controller.projectSN = "16#0000_1a2b";
    controller.inhibitAutomaticFirmwareUpdate = "1";
    project.controllers.push(controller);

    const report = controllerProjectMatchingReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.projectMatchedCount).toBe(1);
    expect(report.projectSerialCount).toBe(1);
    expect(report.firmwareUpdateInhibitCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      matchProjectToController: "true",
      matchProjectToControllerEnabled: true,
      projectSN: "16#0000_1a2b",
      inhibitAutomaticFirmwareUpdate: "1",
      inhibitAutomaticFirmwareUpdateEnabled: true,
      projectMatchingMetadataPresent: true,
      firmwareUpdateMetadataPresent: true,
      status: "project-matched",
      controllerCommunicationModelled: false,
      controllerSerialNumberMatchModelled: false,
      downloadPreflightModelled: false,
      firmwareUpdateModelled: false,
      firmwareUpdateInhibitModelled: false,
      controllerReplacementWorkflowModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-controller-serial-number-match",
      "no-download-preflight",
      "no-firmware-update",
      "no-firmware-update-inhibit",
      "no-controller-replacement-workflow",
    ]));
  });

  it("flags partial and malformed project/controller matching metadata", () => {
    const project = createProject("Bad Project Matching");
    const partial = createController(project.id, "PartialCtl");
    partial.matchProjectToController = "sometimes";
    const invalid = createController(project.id, "InvalidCtl");
    invalid.matchProjectToController = "true";
    invalid.inhibitAutomaticFirmwareUpdate = "maybe";
    const orphanSerial = createController(project.id, "OrphanSerialCtl");
    orphanSerial.projectSN = "16#0000_1a2b";
    project.controllers.push(partial, invalid, orphanSerial);

    const report = controllerProjectMatchingReviewReport(project);
    expect(report.metadataCount).toBe(3);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(3);
    expect(report.partialMetadataCount).toBe(1);
    expect(report.missingProjectSerialCount).toBe(1);
    expect(report.orphanProjectSerialCount).toBe(1);
    expect(report.invalidFlagCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "partial-project-matching-metadata",
      "invalid-match-project-to-controller-flag",
    ]);
    expect(report.rows[1]?.issues).toEqual([
      "missing-project-serial-number",
      "invalid-inhibit-automatic-firmware-update-flag",
    ]);
    expect(report.rows[2]?.issues).toEqual(["project-serial-without-matching"]);
    expect(report.warnings.join("\n")).toMatch(/MatchProjectToController/);
    expect(report.warnings.join("\n")).toMatch(/InhibitAutomaticFirmwareUpdate/);
    expect(report.warnings.join("\n")).toMatch(/ProjectSN/);
  });

  it("marks controllers without imported project matching metadata as no-metadata", () => {
    const project = createProject("No Matching");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerProjectMatchingReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      projectMatchingMetadataPresent: false,
      firmwareUpdateMetadataPresent: false,
      status: "no-metadata",
      downloadPreflightModelled: false,
    });
  });
});
