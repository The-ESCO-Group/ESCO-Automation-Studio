import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { controllerSafetyLevelReviewReport } from "./controller-safety-level-review";

describe("controllerSafetyLevelReviewReport", () => {
  it("reviews a canonical SIL/PL safety level with offline enforcement boundaries", () => {
    const project = createProject("Safety Level Review");
    const controller = createController(project.id, "GuardCtl");
    controller.safetyInfo = { safetyLevel: "SIL2/PLd" };
    project.controllers.push(controller);

    const report = controllerSafetyLevelReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.safetyLevelCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "GuardCtl",
      safetyLevel: "SIL2/PLd",
      safetyIntegrityLevel: "SIL2",
      performanceLevel: "PLd",
      safetyLevelPresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      safetyRatingEnforced: false,
      safetyCertificationVerified: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(
      expect.arrayContaining([
        "no-controller-communication",
        "no-safety-rating-enforcement",
        "no-safety-certification-verification",
      ]),
    );
  });

  it("accepts mixed case and parses the SIL3/PLe rating", () => {
    const project = createProject("Mixed Case Level");
    const controller = createController(project.id, "Sil3Ctl");
    controller.safetyInfo = { safetyLevel: "sil3/ple" };
    project.controllers.push(controller);

    const report = controllerSafetyLevelReviewReport(project);
    expect(report.reviewableCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      status: "reviewable",
      safetyIntegrityLevel: "SIL3",
      performanceLevel: "PLe",
    });
  });

  it("flags an unrecognized safety level format as needs-attention", () => {
    const project = createProject("Bad Safety Level");
    const partial = createController(project.id, "PartialLevel");
    partial.safetyInfo = { safetyLevel: "SIL2" };
    const garbled = createController(project.id, "GarbledLevel");
    garbled.safetyInfo = { safetyLevel: "SIL 2 / PL d" };
    project.controllers.push(partial, garbled);

    const report = controllerSafetyLevelReviewReport(project);
    expect(report.safetyLevelCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(2);
    expect(report.unrecognizedFormatCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual(["unrecognized-safety-level-format"]);
    expect(report.rows[0]?.safetyIntegrityLevel).toBeUndefined();
    expect(report.warnings.join("\n")).toMatch(/SIL\/PL/);
  });

  it("marks controllers without an imported SafetyLevel as no-metadata", () => {
    const project = createProject("No Safety Level");
    const noInfo = createController(project.id, "BareCtl");
    const infoNoLevel = createController(project.id, "NoLevelCtl");
    infoNoLevel.safetyInfo = { safetyEnabled: "true" };
    project.controllers.push(noInfo, infoNoLevel);

    const report = controllerSafetyLevelReviewReport(project);
    expect(report.safetyLevelCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "BareCtl",
      safetyLevelPresent: false,
      status: "no-metadata",
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "NoLevelCtl",
      safetyLevelPresent: false,
      status: "no-metadata",
    });
  });
});
