import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerSafetyInfoReviewReport } from "./controller-safety-info-review";

describe("controllerSafetyInfoReviewReport", () => {
  it("reviews imported GuardLogix SafetyInfo with offline safety boundaries", () => {
    const project = createProject("Controller Safety Review");
    const controller = createController(project.id, "SafeCtl");
    controller.safetyInfo = {
      safetyEnabled: "true",
      safetyLocked: true,
      safetySignatureId: "16#abcd_1234",
      safetySignatureTimestamp: "2024-09-18T13:45:21.000Z",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
      safetyLevel: "SIL2/PLd",
    };
    project.controllers.push(controller);

    const report = controllerSafetyInfoReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.safetyInfoCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.safetyEnabledCount).toBe(1);
    expect(report.safetyLockedCount).toBe(1);
    expect(report.safetySignatureCount).toBe(1);
    expect(report.safetySignatureTimestampCount).toBe(1);
    expect(report.configureSafetyIOAlwaysCount).toBe(1);
    expect(report.safetyLevelCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SafeCtl",
      safetyEnabled: "true",
      safetyEnabledValue: true,
      safetyLocked: true,
      safetySignatureId: "16#abcd_1234",
      safetySignatureTimestamp: "2024-09-18T13:45:21.000Z",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
      safetyLevel: "SIL2/PLd",
      safetyInfoPresent: true,
      safetySignaturePresent: true,
      safetySignatureTimestampPresent: true,
      status: "safety-locked",
      controllerCommunicationModelled: false,
      safetySignatureVerified: false,
      safetyLockUnlockModelled: false,
      safetyEnableDisableModelled: false,
      safetyTaskSchedulingModelled: false,
      safetyMemoryPartitionEnforced: false,
      safetyIoConfigurationModelled: false,
      controllerSafetyStatusModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-safety-signature-verification",
      "no-safety-lock-unlock",
      "no-safety-enable-disable",
      "no-safety-task-scheduling",
      "no-safety-memory-partition-enforcement",
      "no-safety-io-configuration",
      "no-controller-safety-status",
    ]));
  });

  it("flags partial SafetyInfo and locked/protected settings without a signature", () => {
    const project = createProject("Safety Issues");
    const controller = createController(project.id, "BadSafeCtl");
    controller.safetyInfo = {
      safetyLocked: true,
      signatureRunModeProtect: true,
    };
    project.controllers.push(controller);

    const report = controllerSafetyInfoReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.partialSafetyInfoCount).toBe(1);
    expect(report.missingSignatureCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "partial-safety-info",
      "locked-without-signature",
      "run-mode-protect-without-signature",
    ]);
    expect(report.rows[0]?.status).toBe("needs-attention");
    expect(report.warnings[0]).toMatch(/partial SafetyInfo metadata/);
    expect(report.warnings[0]).toMatch(/SafetySignatureID is missing/);
  });

  it("flags SafetySignatureID and SafetySignatureTimestamp mismatches", () => {
    const project = createProject("Safety Signature Timestamp Issues");
    const missingTimestamp = createController(project.id, "MissingTimestampCtl");
    missingTimestamp.safetyInfo = {
      safetyLocked: false,
      safetySignatureId: "16#abcd_1234",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
    };
    const orphanTimestamp = createController(project.id, "OrphanTimestampCtl");
    orphanTimestamp.safetyInfo = {
      safetyLocked: false,
      safetySignatureTimestamp: "2024-09-18T13:45:21.000Z",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
    };
    project.controllers.push(missingTimestamp, orphanTimestamp);

    const report = controllerSafetyInfoReviewReport(project);
    expect(report.safetyInfoCount).toBe(2);
    expect(report.safetySignatureCount).toBe(1);
    expect(report.safetySignatureTimestampCount).toBe(1);
    expect(report.issueCount).toBe(2);
    expect(report.partialSafetyInfoCount).toBe(2);
    expect(report.signatureTimestampIssueCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "partial-safety-info",
      "signature-id-without-timestamp",
    ]);
    expect(report.rows[1]?.issues).toEqual([
      "partial-safety-info",
      "signature-timestamp-without-id",
    ]);
    expect(report.warnings.join("\n")).toMatch(/SafetySignatureTimestamp/);
  });

  it("flags malformed SafetyEnabled metadata without requiring signature fields", () => {
    const project = createProject("Safety Enabled Issues");
    const controller = createController(project.id, "EnabledCtl");
    controller.safetyInfo = {
      safetyEnabled: "sometimes",
      safetyLevel: "SIL3/PLe",
    };
    project.controllers.push(controller);

    const report = controllerSafetyInfoReviewReport(project);
    expect(report.safetyInfoCount).toBe(1);
    expect(report.safetyLevelCount).toBe(1);
    expect(report.invalidSafetyEnabledCount).toBe(1);
    expect(report.partialSafetyInfoCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      status: "needs-attention",
      safetyEnabled: "sometimes",
      safetyEnabledValue: undefined,
      safetyLevel: "SIL3/PLe",
      issues: ["invalid-safety-enabled-flag"],
      safetyEnableDisableModelled: false,
    });
    expect(report.rows[0]?.boundaries).toContain("no-safety-enable-disable");
    expect(report.warnings[0]).toMatch(/SafetyEnabled/);
  });

  it("marks controllers without imported SafetyInfo as no-metadata", () => {
    const project = createProject("No SafetyInfo");
    project.controllers.push(createController(project.id, "StandardCtl"));

    const report = controllerSafetyInfoReviewReport(project);
    expect(report.safetyInfoCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "StandardCtl",
      safetyInfoPresent: false,
      safetySignaturePresent: false,
      safetySignatureTimestampPresent: false,
      status: "no-metadata",
      safetySignatureVerified: false,
      controllerSafetyStatusModelled: false,
    });
  });
});
