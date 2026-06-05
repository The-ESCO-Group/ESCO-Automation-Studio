import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerChangeDetectionReviewReport } from "./controller-change-detection-review";

describe("controllerChangeDetectionReviewReport", () => {
  it("reviews the default all-changes mask as detecting every category", () => {
    const project = createProject("Change Detection Review");
    const controller = createController(project.id, "SecuredCtl");
    controller.security = { code: "123456", changesToDetect: "16#ffff_ffff_ffff_ffff" };
    project.controllers.push(controller);

    const report = controllerChangeDetectionReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.changeDetectionCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SecuredCtl",
      changesToDetect: "16#ffff_ffff_ffff_ffff",
      normalizedMask: "ffffffffffffffff",
      detectsAllChanges: true,
      detectsNoChanges: false,
      changeDetectionPresent: true,
      status: "reviewable",
      changeDetectionAuditValueModelled: false,
      controllerAuditLogWriteModelled: false,
      onlineChangeMonitoringModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(
      expect.arrayContaining([
        "no-change-detection-audit-value",
        "no-controller-audit-log-write",
        "no-online-change-monitoring",
      ]),
    );
    expect(report.rows[0]?.message).toMatch(/tracks all change categories/);
  });

  it("reviews a partial mask that exceeds the safe-integer range without arithmetic", () => {
    const project = createProject("Wide Mask");
    const controller = createController(project.id, "WideCtl");
    // 20 hex digits / 80 bits — well beyond Number.MAX_SAFE_INTEGER.
    controller.security = { changesToDetect: "16#00ff_ffff_ffff_ffff_ffff" };
    project.controllers.push(controller);

    const report = controllerChangeDetectionReviewReport(project);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      normalizedMask: "00ffffffffffffffffff",
      detectsAllChanges: false,
      detectsNoChanges: false,
      status: "reviewable",
    });
  });

  it("flags an all-zeros mask as change detection disabled", () => {
    const project = createProject("Disabled Detection");
    const bareZero = createController(project.id, "ZeroCtl");
    bareZero.security = { code: "1", changesToDetect: "16#0000_0000_0000_0000" };
    const plainZero = createController(project.id, "PlainZeroCtl");
    plainZero.security = { changesToDetect: "0" };
    project.controllers.push(bareZero, plainZero);

    const report = controllerChangeDetectionReviewReport(project);
    expect(report.changeDetectionCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.disabledCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual(["change-detection-disabled"]);
    expect(report.rows[0]).toMatchObject({
      detectsAllChanges: false,
      detectsNoChanges: true,
      status: "needs-attention",
    });
    expect(report.rows[1]?.issues).toEqual(["change-detection-disabled"]);
    expect(report.warnings.join("\n")).toMatch(/edits produce no change-detection audit value/);
  });

  it("flags an unrecognized mask format", () => {
    const project = createProject("Bad Mask");
    const controller = createController(project.id, "BadMaskCtl");
    controller.security = { changesToDetect: "all" };
    project.controllers.push(controller);

    const report = controllerChangeDetectionReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.unrecognizedFormatCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      changesToDetect: "all",
      status: "needs-attention",
    });
    expect(report.rows[0]?.normalizedMask).toBeUndefined();
    expect(report.rows[0]?.detectsAllChanges).toBeUndefined();
    expect(report.rows[0]?.issues).toEqual(["unrecognized-change-detection-format"]);
  });

  it("marks controllers without ChangesToDetect as no-metadata", () => {
    const project = createProject("No Mask");
    const bare = createController(project.id, "BareCtl");
    const codeOnly = createController(project.id, "CodeOnlyCtl");
    codeOnly.security = { code: "987654" };
    project.controllers.push(bare, codeOnly);

    const report = controllerChangeDetectionReviewReport(project);
    expect(report.changeDetectionCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      changeDetectionPresent: false,
      status: "no-metadata",
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "CodeOnlyCtl",
      changeDetectionPresent: false,
      status: "no-metadata",
    });
    expect(report.rows[1]?.normalizedMask).toBeUndefined();
  });
});
