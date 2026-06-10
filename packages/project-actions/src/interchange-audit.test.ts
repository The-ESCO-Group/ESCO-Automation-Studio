import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import type { ImportSummary } from "@esco/parser-l5x";
import {
  buildExportAuditReport,
  buildImportAuditReport,
  exportProjectL5X,
  formatInterchangeAuditReport,
} from "./index";

function sampleImportSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    sourceFormat: "L5X",
    offlineOnly: true,
    proprietaryBinarySupported: false,
    evidence: {
      format: "L5X",
      rootElement: "RSLogix5000Content",
      offlineOnly: true,
      proprietaryBinarySupported: false,
      targetName: "PlantLine",
      contentType: "Controller",
      softwareRevision: "v36",
    },
    programs: 2,
    routines: 5,
    rungs: 40,
    tags: 120,
    unsupportedInstructions: ["PIDE", "SFR"],
    warnings: ["Nested/complex branch flattened to a series."],
    ...overrides,
  };
}

describe("buildImportAuditReport", () => {
  it("summarises kept / dropped / changed from an import summary", () => {
    const report = buildImportAuditReport(sampleImportSummary());
    expect(report.direction).toBe("import");
    expect(report.offlineOnly).toBe(true);
    expect(report.proprietaryBinaryTouched).toBe(false);
    expect(report.kept.find((l) => l.label === "Programs")!.detail).toBe("2 programs");
    expect(report.kept.find((l) => l.label === "Routines")!.detail).toBe("5 routines");
    expect(report.kept.find((l) => l.label === "Source controller")!.detail).toBe("PlantLine");
    // Unsupported instructions are reported as preserved-but-not-executed.
    expect(report.dropped.map((l) => l.label)).toEqual(["Instruction PIDE", "Instruction SFR"]);
    expect(report.dropped[0]!.detail).toMatch(/preserved verbatim/i);
    expect(report.changed).toHaveLength(1);
  });

  it("singularises counts of one", () => {
    const report = buildImportAuditReport(
      sampleImportSummary({ programs: 1, routines: 1, rungs: 1, tags: 1, unsupportedInstructions: [], warnings: [] }),
    );
    expect(report.kept.find((l) => l.label === "Programs")!.detail).toBe("1 program");
    expect(report.dropped).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
  });

  it("renders a readable text receipt that asserts the offline boundary", () => {
    const text = formatInterchangeAuditReport(buildImportAuditReport(sampleImportSummary()));
    expect(text).toContain("Offline: yes");
    expect(text).toContain("Proprietary binary touched: no");
    expect(text).toContain("Kept (");
    expect(text).toContain("Dropped (preserved, not executed)");
    expect(text).toContain("PIDE");
  });
});

describe("buildExportAuditReport", () => {
  it("builds an export audit from real offline export evidence", () => {
    const project = createProject("PlantLine");
    const controller = createController(project.id, "Ctrl");
    const program = createProgram(controller.id, "MainProgram");
    const routine = createRoutine(program.id, "MainRoutine", "ladder");
    program.routines.push(routine);
    controller.programs.push(program);
    project.controllers.push(controller);

    const exported = exportProjectL5X(project);
    expect(exported.ok).toBe(true);

    const report = buildExportAuditReport(exported.data!.evidence, exported.data!.warnings);
    expect(report.direction).toBe("export");
    expect(report.offlineOnly).toBe(true);
    // The export must never touch a proprietary binary — the report proves it.
    expect(report.proprietaryBinaryTouched).toBe(false);
    expect(report.kept.find((l) => l.label === "Exported by")!.detail).toBe("ESCO Automation Studio");
  });
});
