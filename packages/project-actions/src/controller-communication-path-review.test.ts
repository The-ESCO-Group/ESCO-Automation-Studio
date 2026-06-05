import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerCommunicationPathReviewReport } from "./controller-communication-path-review";

describe("controllerCommunicationPathReviewReport", () => {
  it("reviews imported CommPath/CommDriver metadata with offline boundaries", () => {
    const project = createProject("Controller Communication Path Review");
    const controller = createController(project.id, "LineCtl");
    controller.commPath = "AB_ETHIP-1\\192.168.1.10\\Backplane\\0";
    controller.commDriver = "AB_ETHIP-1";
    project.controllers.push(controller);

    const report = controllerCommunicationPathReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.commPathCount).toBe(1);
    expect(report.commDriverCount).toBe(1);
    expect(report.ethernetPathCount).toBe(1);
    expect(report.localModelPathCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      commPath: "AB_ETHIP-1\\192.168.1.10\\Backplane\\0",
      commDriver: "AB_ETHIP-1",
      commPathPresent: true,
      commDriverPresent: true,
      routeSegmentCount: 4,
      routeFamily: "ethernet-ip",
      driverPathMatches: true,
      networkAddress: "192.168.1.10",
      targetSlot: "0",
      routeSummary: "EtherNet/IP route to 192.168.1.10, backplane slot 0.",
      status: "reviewable",
      controllerCommunicationModelled: false,
      pathBrowseModelled: false,
      onlineConnectionModelled: false,
      driverValidationModelled: false,
      downloadTargetSelectionModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-path-browse",
      "no-online-connection",
      "no-driver-validation",
      "no-download-target-selection",
    ]));
    expect(report.rows[0]?.routeSegments.map((segment) => segment.kind)).toEqual([
      "driver",
      "network-address",
      "backplane",
      "slot",
    ]);
  });

  it("flags partial and malformed communication path metadata", () => {
    const project = createProject("Bad Communication Paths");
    const pathOnly = createController(project.id, "PathOnly");
    pathOnly.commPath = "Backplane";
    const driverOnly = createController(project.id, "DriverOnly");
    driverOnly.commDriver = "AB_ETHIP-1";
    const badDriver = createController(project.id, "BadDriver");
    badDriver.commPath = "AB_ETHIP-1\\192.168.1.10";
    badDriver.commDriver = "AB_ETHIP-1\\192.168.1.10";
    project.controllers.push(pathOnly, driverOnly, badDriver);

    const report = controllerCommunicationPathReviewReport(project);
    expect(report.metadataCount).toBe(3);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(3);
    expect(report.missingCommPathCount).toBe(1);
    expect(report.missingCommDriverCount).toBe(1);
    expect(report.malformedCommPathCount).toBe(1);
    expect(report.malformedCommDriverCount).toBe(1);
    expect(report.driverPathMismatchCount).toBe(0);
    expect(report.rows[0]?.issues).toEqual(["missing-comm-driver", "malformed-comm-path"]);
    expect(report.rows[1]?.issues).toEqual(["missing-comm-path"]);
    expect(report.rows[2]?.issues).toEqual(["malformed-comm-driver"]);
    expect(report.warnings.join("\n")).toMatch(/CommPath/);
    expect(report.warnings.join("\n")).toMatch(/CommDriver/);
  });

  it("marks controllers without communication path metadata as no-metadata", () => {
    const project = createProject("No Communication Path");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerCommunicationPathReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      commPathPresent: false,
      commDriverPresent: false,
      routeSegmentCount: 0,
      routeFamily: "unknown",
      driverPathMatches: false,
      routeSummary: "No imported CommPath metadata.",
      offlineDiagnosticsAvailable: false,
      status: "no-metadata",
      controllerCommunicationModelled: false,
    });
  });

  it("classifies local offline model routes", () => {
    const project = createProject("Local Backplane Path");
    const controller = createController(project.id, "VirtualCtl");
    controller.commPath = "Offline Model\\Local Backplane\\Slot 0";
    controller.commDriver = "Offline Model";
    project.controllers.push(controller);

    const report = controllerCommunicationPathReviewReport(project);
    expect(report.reviewableCount).toBe(1);
    expect(report.localModelPathCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      routeFamily: "local-backplane",
      driverPathMatches: true,
      targetSlot: "0",
      routeSummary: "Offline model route through Local Backplane slot 0.",
    });
    expect(report.rows[0]?.routeSegments.map((segment) => segment.kind)).toEqual([
      "driver",
      "local-model",
      "slot",
    ]);
  });

  it("flags a CommDriver that does not match the first CommPath segment", () => {
    const project = createProject("Driver Mismatch");
    const controller = createController(project.id, "MismatchCtl");
    controller.commPath = "AB_ETHIP-2\\192.168.1.10\\Backplane\\0";
    controller.commDriver = "AB_ETHIP-1";
    project.controllers.push(controller);

    const report = controllerCommunicationPathReviewReport(project);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(1);
    expect(report.driverPathMismatchCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      driverPathMatches: false,
      networkAddress: "192.168.1.10",
      targetSlot: "0",
    });
    expect(report.rows[0]?.issues).toEqual(["driver-path-mismatch"]);
    expect(report.warnings.join("\n")).toMatch(/CommDriver does not match/);
  });
});
