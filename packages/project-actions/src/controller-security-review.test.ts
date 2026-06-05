import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerSecurityReviewReport } from "./controller-security-review";

describe("controllerSecurityReviewReport", () => {
  it("reviews secured controller Security metadata with offline boundaries", () => {
    const project = createProject("Controller Security Review");
    const controller = createController(project.id, "SecuredCtl");
    controller.security = {
      code: "123456",
      changesToDetect: "16#ffff_ffff_ffff_ffff",
      securityAuthorityId: "{a1b2c3d4-0000-0000-0000-000000000000}",
      securityAuthorityName: "ESCO-FTSecurity",
    };
    project.controllers.push(controller);

    const report = controllerSecurityReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.securityMetadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.sourceProtectionCodeCount).toBe(1);
    expect(report.changeDetectionCount).toBe(1);
    expect(report.securedAuthorityCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SecuredCtl",
      code: "123456",
      changesToDetect: "16#ffff_ffff_ffff_ffff",
      securityAuthorityId: "{a1b2c3d4-0000-0000-0000-000000000000}",
      securityAuthorityName: "ESCO-FTSecurity",
      securityMetadataPresent: true,
      sourceProtectionCodePresent: true,
      changeDetectionPresent: true,
      securityAuthorityPresent: true,
      status: "secured-authority",
      controllerCommunicationModelled: false,
      securityPermissionEnforcementModelled: false,
      factoryTalkSecurityAuthenticationModelled: false,
      sourceProtectionEnforced: false,
      changeDetectionMonitoringModelled: false,
      controllerAuditLogWriteModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-security-permission-enforcement",
      "no-factorytalk-security-authentication",
      "no-source-protection-enforcement",
      "no-change-detection-monitoring",
      "no-controller-audit-log-write",
    ]));
  });

  it("reviews common unsecured Security metadata without requiring a security authority", () => {
    const project = createProject("Unsecured Controller Security Review");
    const controller = createController(project.id, "PlainCtl");
    controller.security = {
      code: "0",
      changesToDetect: "16#ffff_ffff_ffff_ffff_ffff",
    };
    project.controllers.push(controller);

    const report = controllerSecurityReviewReport(project);
    expect(report.securityMetadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.securedAuthorityCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "PlainCtl",
      code: "0",
      changesToDetect: "16#ffff_ffff_ffff_ffff_ffff",
      securityAuthorityPresent: false,
      status: "reviewable",
    });
  });

  it("flags partial change-detection and FactoryTalk authority metadata", () => {
    const project = createProject("Bad Controller Security");
    const missingChanges = createController(project.id, "MissingChangesCtl");
    missingChanges.security = {
      code: "123456",
    };
    const orphanAuthority = createController(project.id, "OrphanAuthorityCtl");
    orphanAuthority.security = {
      securityAuthorityId: "{a1b2c3d4-0000-0000-0000-000000000000}",
    };
    project.controllers.push(missingChanges, orphanAuthority);

    const report = controllerSecurityReviewReport(project);
    expect(report.securityMetadataCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.partialSecurityCount).toBe(1);
    expect(report.authorityIssueCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual(["partial-change-detection-metadata"]);
    expect(report.rows[1]?.issues).toEqual([
      "partial-security-authority",
      "authority-without-security-settings",
    ]);
    expect(report.warnings.join("\n")).toMatch(/SecurityAuthorityID/);
  });

  it("marks controllers without imported Security metadata as no-metadata", () => {
    const project = createProject("No Security");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerSecurityReviewReport(project);
    expect(report.securityMetadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      securityMetadataPresent: false,
      sourceProtectionCodePresent: false,
      changeDetectionPresent: false,
      securityAuthorityPresent: false,
      status: "no-metadata",
      securityPermissionEnforcementModelled: false,
      factoryTalkSecurityAuthenticationModelled: false,
    });
  });
});
