import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerPropertiesReviewReport } from "./controller-properties-review";

describe("controllerPropertiesReviewReport", () => {
  it("reviews controller identity, system overhead, and redundancy settings with offline boundaries", () => {
    const project = createProject("Controller Review");
    const controller = createController(project.id, "LineCtl");
    controller.description = "Line 1 controller";
    controller.processorType = "1756-L85E";
    controller.catalogNumber = "1756-L85E";
    controller.firmwareRevision = "35.11";
    controller.chassis = "1756-A10";
    controller.slot = 0;
    controller.timeSlice = "20";
    controller.shareUnusedTimeSlice = "1";
    controller.redundancyInfo = {
      enabled: true,
      keepTestEditsOnSwitchOver: false,
      ioMemoryPadPercentage: "90",
      dataTablePadPercentage: "50",
      frontPortCrossloadEnabledPorts: "1,2",
      frontPortCrossloadSecurityEnabled: "true",
    };
    project.controllers.push(controller);

    const report = controllerPropertiesReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.redundancyEnabledCount).toBe(1);
    expect(report.frontPortCrossloadConfiguredCount).toBe(1);
    expect(report.frontPortCrossloadSecurityEnabledCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "LineCtl",
      processorType: "1756-L85E",
      catalogNumber: "1756-L85E",
      firmwareRevision: "35.11",
      timeSlicePercent: 20,
      shareUnusedTimeSliceEnabled: true,
      status: "redundancy-enabled",
      controllerCommunicationModelled: false,
      firmwareCompatibilityChecked: false,
      systemOverheadSchedulingModelled: false,
      controllerStatusWordsModelled: false,
      redundancy: {
        enabled: true,
        keepTestEditsOnSwitchOver: false,
        ioMemoryPadPercentage: "90",
        dataTablePadPercentage: "50",
        frontPortCrossloadEnabledPorts: "1,2",
        frontPortCrossloadSecurityEnabled: "true",
        frontPortCrossloadSecurityEnabledValue: true,
        redundancyModelled: false,
        frontPortCrossloadModelled: false,
      },
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-firmware-compatibility-check",
      "no-system-overhead-scheduling",
      "no-controller-status-words",
      "no-redundancy-switchover",
      "no-redundancy-memory-pad-enforcement",
      "no-front-port-crossload",
    ]));
  });

  it("flags missing identity and invalid scheduling metadata", () => {
    const project = createProject("Controller Issues");
    const controller = createController(project.id, "BadCtl");
    controller.timeSlice = "101";
    controller.shareUnusedTimeSlice = "sometimes";
    project.controllers.push(controller);

    const report = controllerPropertiesReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.missingIdentityCount).toBe(3);
    expect(report.schedulingIssueCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "missing-processor-type",
      "missing-catalog-number",
      "missing-firmware-revision",
      "invalid-time-slice",
      "invalid-share-unused-time-slice",
    ]);
    expect(report.warnings[0]).toMatch(/missing processor type/);
    expect(report.warnings[0]).toMatch(/time slice/);
  });

  it("flags invalid redundancy pad percentages without modelling redundancy behavior", () => {
    const project = createProject("Redundancy Issues");
    const controller = createController(project.id, "RedCtl");
    controller.processorType = "1756-L83E";
    controller.catalogNumber = "1756-L83E";
    controller.firmwareRevision = "33.11";
    controller.redundancyInfo = {
      enabled: false,
      keepTestEditsOnSwitchOver: true,
      ioMemoryPadPercentage: "-1",
      dataTablePadPercentage: "120",
    };
    project.controllers.push(controller);

    const report = controllerPropertiesReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.redundancyIssueCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      issues: ["invalid-redundancy-pad"],
      redundancy: {
        enabled: false,
        keepTestEditsOnSwitchOver: true,
        redundancyModelled: false,
      },
    });
    expect(report.rows[0]?.boundaries).toContain("no-redundancy-switchover");
  });

  it("flags malformed front-port crossload security metadata", () => {
    const project = createProject("Crossload Issues");
    const controller = createController(project.id, "CrossloadCtl");
    controller.processorType = "1756-L85E";
    controller.catalogNumber = "1756-L85E";
    controller.firmwareRevision = "35.11";
    controller.redundancyInfo = {
      frontPortCrossloadEnabledPorts: "1",
      frontPortCrossloadSecurityEnabled: "sometimes",
    };
    project.controllers.push(controller);

    const report = controllerPropertiesReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.redundancyIssueCount).toBe(1);
    expect(report.frontPortCrossloadConfiguredCount).toBe(1);
    expect(report.frontPortCrossloadSecurityEnabledCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      issues: ["invalid-front-port-crossload-security-flag"],
      redundancy: {
        frontPortCrossloadEnabledPorts: "1",
        frontPortCrossloadSecurityEnabled: "sometimes",
        frontPortCrossloadSecurityEnabledValue: undefined,
        frontPortCrossloadModelled: false,
      },
    });
    expect(report.rows[0]?.boundaries).toContain("no-front-port-crossload");
    expect(report.warnings[0]).toMatch(/FrontPortCrossloadSecurityEnabled/);
  });
});
