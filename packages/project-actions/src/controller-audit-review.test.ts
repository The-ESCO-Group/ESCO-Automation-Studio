import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerAuditReviewReport } from "./controller-audit-review";

describe("controllerAuditReviewReport", () => {
  it("reviews imported controller project audit timestamps with offline boundaries", () => {
    const project = createProject("Audit Review");
    const controller = createController(project.id, "AuditCtl");
    controller.projectCreationDate = "Tue Mar 12 09:15:23 2024";
    controller.lastModifiedDate = "Thu May 30 14:02:51 2024";
    project.controllers.push(controller);

    const report = controllerAuditReviewReport(project);

    expect(report.controllerCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.configuredAuditCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "AuditCtl",
      projectCreationDate: "Tue Mar 12 09:15:23 2024",
      lastModifiedDate: "Thu May 30 14:02:51 2024",
      auditMetadataPresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      controllerAuditLogRead: false,
      projectHistorySyncModelled: false,
      timestampVerified: false,
      controllerDownloadModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-controller-audit-log-read",
      "no-project-history-sync",
      "no-timestamp-verification",
      "no-controller-download",
    ]));
    expect(report.rows[0]?.message).toMatch(/project audit timestamps are reviewable offline/);
  });

  it("flags partial project audit timestamp metadata", () => {
    const project = createProject("Partial Audit Review");
    const createdOnly = createController(project.id, "CreatedOnly");
    createdOnly.projectCreationDate = "Tue Mar 12 09:15:23 2024";
    const modifiedOnly = createController(project.id, "ModifiedOnly");
    modifiedOnly.lastModifiedDate = "Thu May 30 14:02:51 2024";
    project.controllers.push(createdOnly, modifiedOnly);

    const report = controllerAuditReviewReport(project);

    expect(report.configuredAuditCount).toBe(2);
    expect(report.issueCount).toBe(2);
    expect(report.partialAuditTimestampCount).toBe(2);
    expect(report.rows.map((row) => row.issues)).toEqual([
      ["partial-audit-timestamps"],
      ["partial-audit-timestamps"],
    ]);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings[0]).toMatch(/ProjectCreationDate and LastModifiedDate/);
  });

  it("marks controllers without imported audit timestamps as no-metadata", () => {
    const project = createProject("No Audit Review");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerAuditReviewReport(project);

    expect(report).toMatchObject({
      controllerCount: 1,
      reviewableCount: 0,
      configuredAuditCount: 0,
      issueCount: 0,
      partialAuditTimestampCount: 0,
      warnings: [],
    });
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      auditMetadataPresent: false,
      status: "no-metadata",
      issues: [],
    });
    expect(report.rows[0]?.message).toMatch(/no imported project audit timestamp metadata/);
  });
});
