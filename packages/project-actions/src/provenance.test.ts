import { describe, expect, it } from "vitest";
import { createProject } from "@esco/core";
import { detectUnsupportedProjectFormat } from "./format-guard";
import {
  buildBlockedImportRecord,
  describeProjectSource,
  recordBlockedImport,
  recordImportProvenance,
} from "./provenance";

const AT = "2026-06-02T12:00:00.000Z";
const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "A", "C", "D"].join("");
const blockedBinaryProjectName = (stem: string) => `${stem}${BLOCKED_BINARY_PROJECT_EXTENSION}`;

describe("recordImportProvenance", () => {
  it("stamps an L5X import origin without mutating the input project", () => {
    const project = createProject("Demo");
    const next = recordImportProvenance(project, {
      sourceType: "xml-review-import",
      fileName: "Plant.L5X",
      importedAt: AT,
    });

    expect(project.provenance).toBeUndefined();
    expect(next.provenance).toEqual({
      sourceType: "xml-review-import",
      fileName: "Plant.L5X",
      importedAt: AT,
    });
  });

  it("records a desktop file path when provided", () => {
    const next = recordImportProvenance(createProject("Demo"), {
      sourceType: "esco-project",
      fileName: "Line.plcproj.json",
      path: "C:/projects/Line.plcproj.json",
      importedAt: AT,
    });
    expect(next.provenance?.path).toBe("C:/projects/Line.plcproj.json");
    expect(next.provenance?.sourceType).toBe("esco-project");
  });

  it("preserves a prior blocked-import audit record across a re-import", () => {
    const blockedName = blockedBinaryProjectName("Line");
    const guard = detectUnsupportedProjectFormat(blockedName);
    const blocked = recordBlockedImport(createProject("Demo"), {
      fileName: blockedName,
      guard,
      blockedAt: AT,
    });
    const reimported = recordImportProvenance(blocked, {
      sourceType: "xml-review-import",
      fileName: "Line.L5X",
      importedAt: AT,
    });
    expect(reimported.provenance?.sourceType).toBe("xml-review-import");
    expect(reimported.provenance?.blockedImport?.fileName).toBe(blockedName);
  });
});

describe("recordBlockedImport / buildBlockedImportRecord", () => {
  it("captures the source type, filename, path, timestamp, and blocked reason of a proprietary-binary attempt", () => {
    const blockedName = blockedBinaryProjectName("ProductionLine");
    const guard = detectUnsupportedProjectFormat(blockedName);
    const project = recordImportProvenance(createProject("Demo"), {
      sourceType: "xml-review-import",
      fileName: "Demo.L5X",
      importedAt: AT,
    });
    const next = recordBlockedImport(project, {
      fileName: blockedName,
      path: `C:/lines/${blockedName}`,
      guard,
      blockedAt: AT,
    });

    // The project's origin is unchanged — a blocked attempt never becomes the source.
    expect(next.provenance?.sourceType).toBe("xml-review-import");
    expect(next.provenance?.fileName).toBe("Demo.L5X");
    expect(next.provenance?.blockedImport).toEqual({
      fileName: blockedName,
      path: `C:/lines/${blockedName}`,
      format: "binary-project",
      formatLabel: "Proprietary binary controller project",
      reason: expect.stringMatching(/cannot open, read, write, compile, decompile, or convert it/i),
      blockedAt: AT,
    });
  });

  it("works when no project provenance exists yet (defaults to a new-project origin)", () => {
    const blockedArchiveName = `Backup${BLOCKED_BINARY_PROJECT_EXTENSION.toLowerCase()}.zip`;
    const guard = detectUnsupportedProjectFormat(blockedArchiveName);
    const record = buildBlockedImportRecord({ fileName: blockedArchiveName, guard, blockedAt: AT });
    expect(record.format).toBe("binary-project-archive");

    const next = recordBlockedImport(createProject("Demo"), {
      fileName: blockedArchiveName,
      guard,
      blockedAt: AT,
    });
    expect(next.provenance?.sourceType).toBe("new");
    expect(next.provenance?.blockedImport?.format).toBe("binary-project-archive");
  });
});

describe("describeProjectSource", () => {
  it("gives a human label for every source type", () => {
    expect(describeProjectSource("xml-review-import")).toMatch(/XML review/);
    expect(describeProjectSource("esco-project")).toMatch(/ESCO/);
    expect(describeProjectSource("new")).toMatch(/New/);
    expect(describeProjectSource("recovered")).toMatch(/Recovered/);
    expect(describeProjectSource("binary-project-open-blocked")).toMatch(/Unsupported binary project/);
    expect(describeProjectSource("external-conversion-import")).toMatch(/Unsupported external conversion/);
  });
});

describe("bridge-aware provenance", () => {
  it("records a legacy converting tool when a project was opened via an external conversion", () => {
    const next = recordImportProvenance(createProject("Demo"), {
      sourceType: "external-conversion-import",
      fileName: blockedBinaryProjectName("Line"),
      importedAt: AT,
      bridgeTool: { kind: "licensed-engineering-tool", name: "Licensed engineering tool", version: "1.0.0" },
    });
    expect(next.provenance?.sourceType).toBe("external-conversion-import");
    expect(next.provenance?.bridgeTool?.kind).toBe("licensed-engineering-tool");
    expect(next.provenance?.bridgeTool?.version).toBe("1.0.0");
  });

  it("records a legacy bridge-unavailable outcome and the closest detected tool on a blocked binary source", () => {
    const guard = detectUnsupportedProjectFormat(blockedBinaryProjectName("Line"));
    const next = recordBlockedImport(createProject("Demo"), {
      fileName: blockedBinaryProjectName("Line"),
      guard,
      blockedAt: AT,
      outcome: "binary-project-conversion-unavailable",
      tool: { kind: "licensed-engineering-tool", name: "Licensed engineering software", version: "36.00" },
    });
    expect(next.provenance?.blockedImport?.outcome).toBe("binary-project-conversion-unavailable");
    expect(next.provenance?.blockedImport?.tool?.kind).toBe("licensed-engineering-tool");
  });
});
