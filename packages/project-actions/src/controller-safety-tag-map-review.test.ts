import { describe, expect, it } from "vitest";
import { createController, createProject, createTag } from "@esco/core";
import { controllerSafetyTagMapReviewReport } from "./controller-safety-tag-map-review";

function tag(controllerId: string, name: string, safetyClass: "Safety" | "Standard") {
  const result = createTag(controllerId, name, "BOOL");
  result.safetyClass = safetyClass;
  return result;
}

describe("controllerSafetyTagMapReviewReport", () => {
  it("reviews a well-formed SafetyTagMap and parses its entries", () => {
    const project = createProject("Safety Tag Map Review");
    const controller = createController(project.id, "GuardCtl");
    controller.safetyInfo = {
      safetyEnabled: "true",
      safetyTagMap: "S_EStop = EStop_Status, S_GateOpen = Gate_Open",
    };
    controller.controllerTags.push(
      tag(controller.id, "S_EStop", "Safety"),
      tag(controller.id, "EStop_Status", "Standard"),
      tag(controller.id, "S_GateOpen", "Safety"),
      tag(controller.id, "Gate_Open", "Standard"),
    );
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.metadataCount).toBe(1);
    expect(report.reviewableCount).toBe(1);
    expect(report.mappingCount).toBe(2);
    expect(report.resolvedMappingCount).toBe(2);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "GuardCtl",
      safetyTagMapPresent: true,
      status: "reviewable",
      controllerCommunicationModelled: false,
      offlineTagResolutionAvailable: true,
      tagResolutionModelled: false,
      safetyStandardDataMovementModelled: false,
      downloadPreflightModelled: false,
    });
    expect(report.rows[0]?.entries).toEqual([
      {
        raw: "S_EStop = EStop_Status",
        format: "equals",
        safetyTag: "S_EStop",
        standardTag: "EStop_Status",
        malformed: false,
        safetyTagResolved: true,
        standardTagResolved: true,
        safetyTagDataType: "BOOL",
        standardTagDataType: "BOOL",
        safetyTagSafetyClass: "Safety",
        standardTagSafetyClass: "Standard",
      },
      {
        raw: "S_GateOpen = Gate_Open",
        format: "equals",
        safetyTag: "S_GateOpen",
        standardTag: "Gate_Open",
        malformed: false,
        safetyTagResolved: true,
        standardTagResolved: true,
        safetyTagDataType: "BOOL",
        standardTagDataType: "BOOL",
        safetyTagSafetyClass: "Safety",
        standardTagSafetyClass: "Standard",
      },
    ]);
    expect(report.rows[0]?.boundaries).toEqual(
      expect.arrayContaining([
        "no-controller-communication",
        "no-controller-verified-tag-resolution",
        "no-safety-standard-data-movement",
        "no-download-preflight",
      ]),
    );
  });

  it("reviews compact StandardTag,SafetyTag comma-pair SafetyTagMap payloads", () => {
    const project = createProject("Comma Pair Map");
    const controller = createController(project.id, "CommaCtl");
    controller.safetyInfo = {
      safetyEnabled: "true",
      safetyTagMap: "StdOK,SafeOK StdRun,SafeRun",
    };
    controller.controllerTags.push(
      tag(controller.id, "StdOK", "Standard"),
      tag(controller.id, "SafeOK", "Safety"),
      tag(controller.id, "StdRun", "Standard"),
      tag(controller.id, "SafeRun", "Safety"),
    );
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);

    expect(report).toMatchObject({
      metadataCount: 1,
      reviewableCount: 1,
      mappingCount: 2,
      resolvedMappingCount: 2,
      issueCount: 0,
    });
    expect(report.rows[0]?.entries).toMatchObject([
      {
        raw: "StdOK,SafeOK",
        format: "comma-pair",
        standardTag: "StdOK",
        safetyTag: "SafeOK",
        safetyTagResolved: true,
        standardTagResolved: true,
      },
      {
        raw: "StdRun,SafeRun",
        format: "comma-pair",
        standardTag: "StdRun",
        safetyTag: "SafeRun",
        safetyTagResolved: true,
        standardTagResolved: true,
      },
    ]);
  });

  it("flags a malformed mapping entry", () => {
    const project = createProject("Malformed Map");
    const controller = createController(project.id, "BadMapCtl");
    controller.safetyInfo = { safetyTagMap: "S_Ok = Standard_Ok, S_Broken, S_Empty = " };
    controller.controllerTags.push(
      tag(controller.id, "S_Ok", "Safety"),
      tag(controller.id, "Standard_Ok", "Standard"),
    );
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.malformedEntryCount).toBe(1);
    expect(report.rows[0]?.status).toBe("needs-attention");
    expect(report.rows[0]?.issues).toEqual(["malformed-mapping-entry"]);
    expect(report.rows[0]?.entries.filter((entry) => entry.malformed)).toHaveLength(2);
    expect(report.warnings.join("\n")).toMatch(/SafetyTag = StandardTag/);
  });

  it("flags a tag mapped more than once (case-insensitive)", () => {
    const project = createProject("Duplicate Map");
    const controller = createController(project.id, "DupCtl");
    controller.safetyInfo = {
      safetyTagMap: "S_EStop = EStop_Status, s_estop = Other_Standard",
    };
    controller.controllerTags.push(
      tag(controller.id, "S_EStop", "Safety"),
      tag(controller.id, "EStop_Status", "Standard"),
      tag(controller.id, "Other_Standard", "Standard"),
    );
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);
    expect(report.issueCount).toBe(1);
    expect(report.duplicateMappedTagCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["duplicate-mapped-tag"]);
    expect(report.rows[0]?.status).toBe("needs-attention");
  });

  it("flags unresolved mapped tags without attempting controller lookup", () => {
    const project = createProject("Unresolved Map");
    const controller = createController(project.id, "UnresolvedCtl");
    controller.safetyInfo = { safetyTagMap: "MissingSafe = StdOK" };
    controller.controllerTags.push(tag(controller.id, "StdOK", "Standard"));
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);

    expect(report.issueCount).toBe(1);
    expect(report.unresolvedMappedTagCount).toBe(1);
    expect(report.rows[0]?.issues).toEqual(["unresolved-mapped-tag"]);
    expect(report.rows[0]?.entries[0]).toMatchObject({
      safetyTag: "MissingSafe",
      standardTag: "StdOK",
      safetyTagResolved: false,
      standardTagResolved: true,
    });
    expect(report.rows[0]?.tagResolutionModelled).toBe(false);
  });

  it("flags mapped tags whose imported Class does not match their map side", () => {
    const project = createProject("Class Mismatch Map");
    const controller = createController(project.id, "ClassCtl");
    controller.safetyInfo = { safetyTagMap: "SafeBad = StdBad" };
    controller.controllerTags.push(
      tag(controller.id, "SafeBad", "Standard"),
      tag(controller.id, "StdBad", "Safety"),
    );
    project.controllers.push(controller);

    const report = controllerSafetyTagMapReviewReport(project);

    expect(report.issueCount).toBe(1);
    expect(report.safetyClassMismatchCount).toBe(2);
    expect(report.rows[0]?.issues).toEqual([
      "safety-tag-not-safety-class",
      "standard-tag-not-standard-class",
    ]);
    expect(report.warnings[0]).toMatch(/Class="Safety"/);
    expect(report.warnings[0]).toMatch(/Class="Standard"/);
  });

  it("marks a controller without a SafetyTagMap as no-metadata", () => {
    const project = createProject("No Map");
    const safetyOnly = createController(project.id, "SafetyOnlyCtl");
    safetyOnly.safetyInfo = { safetyEnabled: "true" };
    const bare = createController(project.id, "BareCtl");
    project.controllers.push(safetyOnly, bare);

    const report = controllerSafetyTagMapReviewReport(project);
    expect(report.metadataCount).toBe(0);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.mappingCount).toBe(0);
    expect(report.resolvedMappingCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      controllerName: "SafetyOnlyCtl",
      safetyTagMapPresent: false,
      status: "no-metadata",
    });
    expect(report.rows[1]).toMatchObject({
      controllerName: "BareCtl",
      safetyTagMapPresent: false,
      status: "no-metadata",
    });
  });
});
