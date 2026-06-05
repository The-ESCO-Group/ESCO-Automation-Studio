import { describe, expect, it } from "vitest";
import { createController, createProject, type UserDefinedType } from "@esco/core";
import { udtMemberMetadataReviewReport } from "./udt-member-metadata-review";

describe("udtMemberMetadataReviewReport", () => {
  it("reviews UDT member display metadata and bit-overlay layout with offline boundaries", () => {
    const project = createProject("UDT Layout");
    const controller = createController(project.id, "LayoutCtl");
    const udt: UserDefinedType = {
      id: "udt_flags",
      name: "FlagData",
      family: "NoFamily",
      members: [
        { name: "ZZZZZZZZZZFlagData0", dataType: "SINT", radix: "Decimal", hidden: true },
        { name: "Run", dataType: "BOOL", radix: "Decimal", target: "ZZZZZZZZZZFlagData0", bitNumber: 0 },
        { name: "Speed", dataType: "REAL", dimensions: [2], radix: "Float", externalAccess: "read-only" },
      ],
    };
    controller.dataTypes.push(udt);
    project.controllers.push(controller);

    const report = udtMemberMetadataReviewReport(project);
    expect(report.dataTypeCount).toBe(1);
    expect(report.memberCount).toBe(3);
    expect(report.displayMetadataMemberCount).toBe(3);
    expect(report.layoutMetadataMemberCount).toBe(3);
    expect(report.hiddenHostCount).toBe(1);
    expect(report.bitOverlayMemberCount).toBe(1);
    expect(report.issueCount).toBe(0);
    expect(report.rows.find((row) => row.memberName === "Run")).toMatchObject({
      dataTypeName: "FlagData",
      memberDataType: "BOOL",
      target: "ZZZZZZZZZZFlagData0",
      bitNumber: 0,
      overlayRole: "bit-overlay",
      bitPackingExecutionModelled: false,
      controllerMemoryLayoutEnforced: false,
      liveDisplayFormattingModelled: false,
      controllerExternalAccessEnforced: false,
      status: "reviewable",
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-controller-communication",
      "no-online-data-type-edit",
      "no-controller-download",
      "no-controller-memory-layout-enforcement",
      "no-bit-packing-execution",
      "no-live-display-formatting",
      "no-controller-external-access-enforcement",
    ]));
  });

  it("flags malformed bit-overlay member layout", () => {
    const project = createProject("Bad UDT Layout");
    const controller = createController(project.id, "LayoutCtl");
    controller.dataTypes.push({
      id: "udt_bad",
      name: "BadFlags",
      members: [
        { name: "SIntHost", dataType: "SINT", hidden: true },
        { name: "RealHost", dataType: "REAL", hidden: true },
        { name: "MissingTarget", dataType: "BOOL", target: "Ghost", bitNumber: 0 },
        { name: "NoBit", dataType: "BOOL", target: "SIntHost" },
        { name: "BitOnly", dataType: "BOOL", bitNumber: 1 },
        { name: "OutOfRange", dataType: "BOOL", target: "SIntHost", bitNumber: 8 },
        { name: "NotBool", dataType: "DINT", target: "SIntHost", bitNumber: 2 },
        { name: "DupA", dataType: "BOOL", target: "SIntHost", bitNumber: 0 },
        { name: "DupB", dataType: "BOOL", target: "SIntHost", bitNumber: 0 },
        { name: "RealOverlay", dataType: "BOOL", target: "RealHost", bitNumber: 0 },
        { name: "HiddenOverlay", dataType: "SINT", hidden: true, target: "SIntHost", bitNumber: 3 },
      ],
    });
    project.controllers.push(controller);

    const report = udtMemberMetadataReviewReport(project);
    expect(report.issueCount).toBe(9);
    expect(report.duplicateOverlayBitCount).toBe(2);
    expect(report.missingOverlayTargetCount).toBe(1);
    expect(report.invalidOverlayCount).toBe(7);
    const issueMap = new Map(report.rows.map((row) => [row.memberName, row.issues]));
    expect(issueMap.get("MissingTarget")).toEqual(["missing-overlay-target"]);
    expect(issueMap.get("NoBit")).toEqual(["target-without-bit-number"]);
    expect(issueMap.get("BitOnly")).toEqual(["bit-number-without-target"]);
    expect(issueMap.get("OutOfRange")).toEqual(["bit-number-out-of-range"]);
    expect(issueMap.get("NotBool")).toEqual(["overlay-member-not-bool"]);
    expect(issueMap.get("DupA")).toEqual(["duplicate-overlay-bit"]);
    expect(issueMap.get("DupB")).toEqual(["duplicate-overlay-bit"]);
    expect(issueMap.get("RealOverlay")).toEqual(["overlay-target-not-integer"]);
    expect(issueMap.get("HiddenOverlay")).toEqual(["hidden-member-has-overlay-target", "overlay-member-not-bool"]);
    expect(report.warnings.join("\n")).toMatch(/overlay target member is missing/);
    expect(report.warnings.join("\n")).toMatch(/more than one member overlays the same host bit/);
  });

  it("reports empty UDTs without fabricating member rows", () => {
    const project = createProject("Empty UDT");
    const controller = createController(project.id, "LayoutCtl");
    controller.dataTypes.push({ id: "udt_empty", name: "EmptyType", members: [] });
    project.controllers.push(controller);

    const report = udtMemberMetadataReviewReport(project);
    expect(report.dataTypeCount).toBe(1);
    expect(report.memberCount).toBe(0);
    expect(report.issueCount).toBe(0);
    expect(report.rows).toEqual([]);
  });
});
