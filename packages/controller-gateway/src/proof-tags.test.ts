import { describe, expect, it } from "vitest";
import type { PlcProject } from "@esco/core";
import {
  DEFAULT_IDENTITY_PROOF_TAGS,
  IDENTITY_PROOF_TAG_EXPORT_SCHEMA,
  buildIdentityProofTagExport,
} from "./proof-tags";

function project(overrides: Partial<PlcProject> = {}): PlcProject {
  return {
    id: "project-1",
    name: "Line1",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    controllers: [
      {
        id: "controller-1",
        projectId: "project-1",
        name: "PLC_1",
        processorType: "ControlLogix 5580",
        firmwareRevision: "36.011",
        tasks: [],
        programs: [],
        controllerTags: [],
        dataTypes: [],
        addOnInstructions: [],
        ioConfiguration: { modules: [] },
        trends: [],
        quickWatchLists: [],
        parameterConnections: [],
      },
    ],
    ...overrides,
  };
}

describe("identity proof tag export", () => {
  it("generates a review-only L5X tag component with split signature proof values", () => {
    const bundle = buildIdentityProofTagExport(project(), "2026-06-15T12:00:00.000Z");

    expect(bundle.schema).toBe(IDENTITY_PROOF_TAG_EXPORT_SCHEMA);
    expect(bundle.format).toBe("studio5000-l5x-controller-tags");
    expect(bundle.fileName).toBe("Line1-identity-proof-tags.L5X");
    expect(bundle.identityTags).toEqual(DEFAULT_IDENTITY_PROOF_TAGS);
    expect(bundle.evidence).toEqual({
      generatedOffline: true,
      physicalControllerWrite: false,
      proprietaryBinaryTouched: false,
      purpose: "read-only-controller-identity-proof",
    });
    expect(bundle.rows.map((row) => [row.field, row.tagName, row.dataType])).toEqual([
      ["controllerName", "ESCO_ControllerName", "STRING"],
      ["controllerType", "ESCO_ControllerType", "STRING"],
      ["firmwareRevision", "ESCO_FirmwareRevision", "STRING"],
      ["projectName", "ESCO_ProjectName", "STRING"],
      ["projectSignature", "ESCO_ProjectSignatureDigest", "STRING"],
      ["projectSignatureAlgorithm", "ESCO_ProjectSignatureAlgorithm", "STRING"],
    ]);

    const digestRow = bundle.rows.find((row) => row.field === "projectSignature");
    expect(digestRow?.value).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.identity.projectSignature).toBe(`esco-sha256-stable-project-v1:${digestRow?.value}`);
    expect(bundle.l5x).toContain('TargetType="Tag"');
    expect(bundle.l5x).toContain('TargetCount="6"');
    expect(bundle.l5x).toContain('<Tags Use="Target">');
    expect(bundle.l5x).toContain(
      '<Tag Name="ESCO_ProjectSignatureDigest" TagType="Base" DataType="STRING" Constant="true" ExternalAccess="Read Only">',
    );
    expect(bundle.l5x).toContain(`<Data Format="String" Length="64"><![CDATA[${digestRow?.value}]]></Data>`);
    expect(bundle.l5x).toContain(
      '<Data Format="String" Length="29"><![CDATA[esco-sha256-stable-project-v1]]></Data>',
    );
    expect(bundle.l5x).toContain("never downloads, writes, forces, changes modes, or opens a controller connection");
    expect(bundle.warnings).toEqual([]);
  });

  it("surfaces missing or too-long proof fields instead of silently producing reliable-looking proof", () => {
    const bundle = buildIdentityProofTagExport(
      project({
        name: "x".repeat(90),
        controllers: [],
      }),
      "2026-06-15T12:00:00.000Z",
    );

    expect(bundle.rows.find((row) => row.field === "controllerName")?.value).toBe("");
    expect(bundle.warnings.join("\n")).toContain("Controller name is empty");
    expect(bundle.warnings.join("\n")).toContain("Project name is 90 characters");
    expect(bundle.warnings.join("\n")).toContain("standard Logix STRING holds 82");
  });

  it("keeps generated XML well-formed when proof values contain CDATA sentinels", () => {
    const bundle = buildIdentityProofTagExport(
      project({
        name: "Line]]>1",
      }),
      "2026-06-15T12:00:00.000Z",
    );

    expect(bundle.l5x).toContain("<![CDATA[Line]]]]><![CDATA[>1]]>");
  });
});
