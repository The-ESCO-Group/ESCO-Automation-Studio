import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerCstReviewReport } from "./controller-cst-review";

describe("controllerCstReviewReport", () => {
  it("reviews imported CST metadata with offline clock-coordination boundaries", () => {
    const project = createProject("Controller CST Review");
    const controller = createController(project.id, "CstCtl");
    controller.cst = { masterId: "3" };
    project.controllers.push(controller);

    const report = controllerCstReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.cstCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "CstCtl",
      masterId: "3",
      masterIdValue: 3,
      cstPresent: true,
      masterIdPresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      cstClockCoordinationModelled: false,
      cstMasterElectionModelled: false,
      chassisTimeSyncModelled: false,
      liveTimeStatusModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-cst-clock-coordination",
      "no-cst-master-election",
      "no-chassis-time-sync",
      "no-live-time-status",
    ]));
  });

  it("flags missing and malformed CST MasterID metadata", () => {
    const project = createProject("Bad CST");
    const missing = createController(project.id, "MissingMaster");
    missing.cst = {};
    const malformed = createController(project.id, "MalformedMaster");
    malformed.cst = { masterId: "slot-3" };
    project.controllers.push(missing, malformed);

    const report = controllerCstReviewReport(project);
    expect(report.cstCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.missingMasterIdCount).toBe(1);
    expect(report.invalidMasterIdCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["missing-master-id"]);
    expect(report.rows[1]?.issues).toEqual(["invalid-master-id"]);
    expect(report.warnings.join("\n")).toMatch(/MasterID/);
  });

  it("marks controllers without imported CST as no-metadata", () => {
    const project = createProject("No CST");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerCstReviewReport(project);
    expect(report.cstCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      cstPresent: false,
      masterIdPresent: false,
      status: "no-metadata",
      cstClockCoordinationModelled: false,
    });
  });
});
