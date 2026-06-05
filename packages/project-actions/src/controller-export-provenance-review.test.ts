import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerExportProvenanceReviewReport } from "./controller-export-provenance-review";

describe("controllerExportProvenanceReviewReport", () => {
  it("reviews imported software revision and export owner with offline boundaries", () => {
    const project = createProject("Export Provenance Review");
    const both = createController(project.id, "BothCtl");
    both.softwareRevision = "32.04";
    both.exportOwner = "John Doe, Acme Corp";
    const ownerOnly = createController(project.id, "OwnerOnlyCtl");
    ownerOnly.exportOwner = "Jane Roe";
    project.controllers.push(both, ownerOnly);

    const report = controllerExportProvenanceReviewReport(project);
    expect(report.controllerCount).toBe(2);
    expect(report.metadataCount).toBe(2);
    expect(report.reviewableCount).toBe(2);
    expect(report.softwareRevisionCount).toBe(1);
    expect(report.exportOwnerCount).toBe(2);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BothCtl",
      softwareRevision: "32.04",
      exportOwner: "John Doe, Acme Corp",
      softwareRevisionPresent: true,
      exportOwnerPresent: true,
      provenancePresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      softwareVersionEnforcementModelled: false,
      firmwareCompatibilityModelled: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "OwnerOnlyCtl",
      softwareRevisionPresent: false,
      exportOwnerPresent: true,
      provenancePresent: true,
      status: "reviewable",
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-software-version-enforcement",
      "no-firmware-compatibility-check",
      "no-download-preflight",
    ]));
  });

  it("flags a malformed software revision string", () => {
    const project = createProject("Bad Export Provenance");
    const controller = createController(project.id, "BadCtl");
    controller.softwareRevision = "v32";
    project.controllers.push(controller);

    const report = controllerExportProvenanceReviewReport(project);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(1);
    expect(report.invalidSoftwareRevisionCount).toBe(1);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BadCtl",
      softwareRevision: "v32",
      status: "needs-attention",
      issues: ["invalid-software-revision-format"],
    });
    expect(report.warnings.join("\n")).toMatch(/SoftwareRevision/);
  });

  it("marks controllers without imported provenance metadata as no-metadata", () => {
    const project = createProject("No Export Provenance");
    project.controllers.push(createController(project.id, "BareCtl"));

    const report = controllerExportProvenanceReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      softwareRevisionPresent: false,
      exportOwnerPresent: false,
      provenancePresent: false,
      status: "no-metadata",
      controllerCommunicationModelled: false,
    });
  });
});
