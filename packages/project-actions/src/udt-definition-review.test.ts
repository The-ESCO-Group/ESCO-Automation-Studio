import { describe, expect, it } from "vitest";
import { createController, createProject, type UserDefinedType } from "@esco/core";
import { udtDefinitionReviewReport } from "./udt-definition-review";

describe("udtDefinitionReviewReport", () => {
  it("reviews UDT Family metadata and valid custom StringFamily layout", () => {
    const project = createProject("UDT Family");
    const controller = createController(project.id, "FamilyCtl");
    controller.dataTypes.push({
      id: "udt_part_number",
      name: "PartNumber",
      family: "StringFamily",
      description: "Custom string type",
      members: [
        { name: "LEN", dataType: "DINT", radix: "Decimal" },
        { name: "DATA", dataType: "SINT", dimensions: [20], radix: "ASCII" },
      ],
    });
    controller.dataTypes.push({
      id: "udt_motor",
      name: "MotorData",
      family: "NoFamily",
      members: [{ name: "Speed", dataType: "REAL" }],
    });
    project.controllers.push(controller);

    const report = udtDefinitionReviewReport(project);
    expect(report.controllerCount).toBe(1);
    expect(report.dataTypeCount).toBe(2);
    expect(report.familyMetadataCount).toBe(2);
    expect(report.stringFamilyCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows.find((row) => row.dataTypeName === "PartNumber")).toMatchObject({
      family: "StringFamily",
      familyKind: "string-family",
      memberCount: 2,
      lenMemberPresent: true,
      dataMemberPresent: true,
      dataMemberDimension: 20,
      status: "string-family",
      customStringRuntimeLayoutModelled: false,
      controllerMemoryLayoutEnforced: false,
      onlineDataTypeEditModelled: false,
      liveDataTypeEditorModelled: false,
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-online-data-type-edit",
      "no-controller-download",
      "no-controller-memory-layout-enforcement",
      "no-custom-string-runtime-layout",
      "no-live-data-type-editor",
    ]));
  });

  it("flags malformed StringFamily and unrecognized data-type families", () => {
    const project = createProject("Bad UDT Family");
    const controller = createController(project.id, "FamilyCtl");
    const badString: UserDefinedType = {
      id: "udt_bad_string",
      name: "BadString",
      family: "StringFamily",
      members: [
        { name: "LEN", dataType: "INT" },
        { name: "DATA", dataType: "DINT" },
      ],
    };
    const missingMembers: UserDefinedType = {
      id: "udt_missing",
      name: "MissingStringMembers",
      family: "StringFamily",
      members: [],
    };
    const unrecognized: UserDefinedType = {
      id: "udt_vendor",
      name: "VendorType",
      family: "VendorFamily",
      members: [{ name: "Value", dataType: "DINT" }],
    };
    controller.dataTypes.push(badString, missingMembers, unrecognized);
    project.controllers.push(controller);

    const report = udtDefinitionReviewReport(project);
    expect(report.issueCount).toBe(3);
    expect(report.unrecognizedFamilyCount).toBe(1);
    expect(report.emptyDataTypeCount).toBe(1);
    expect(report.stringShapeIssueCount).toBe(5);
    const issueMap = new Map(report.rows.map((row) => [row.dataTypeName, row.issues]));
    expect(issueMap.get("BadString")).toEqual([
      "invalid-string-len-member",
      "invalid-string-data-member",
      "missing-string-data-dimension",
    ]);
    expect(issueMap.get("MissingStringMembers")).toEqual([
      "empty-data-type",
      "missing-string-len-member",
      "missing-string-data-member",
    ]);
    expect(issueMap.get("VendorType")).toEqual(["unrecognized-data-type-family"]);
    expect(report.warnings.join("\n")).toMatch(/StringFamily DATA member must be SINT/);
    expect(report.warnings.join("\n")).toMatch(/data-type family is not NoFamily or StringFamily/);
  });

  it("reports UDTs without Family metadata without inventing a family", () => {
    const project = createProject("No Family");
    const controller = createController(project.id, "FamilyCtl");
    controller.dataTypes.push({
      id: "udt_legacy",
      name: "Legacy",
      members: [{ name: "Flag", dataType: "BOOL" }],
    });
    project.controllers.push(controller);

    const report = udtDefinitionReviewReport(project);
    expect(report.familyMetadataCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows[0]).toMatchObject({
      dataTypeName: "Legacy",
      family: undefined,
      familyKind: "unspecified",
      status: "reviewable",
    });
    expect(report.rows[0]?.message).toMatch(/no data-type Family metadata was imported/);
  });
});
