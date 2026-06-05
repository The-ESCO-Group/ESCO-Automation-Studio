import { describe, expect, it } from "vitest";
import type { AddOnInstruction, PlcProject } from "@esco/core";
import {
  aoiMetadataReviewBoundaryLabel,
  aoiMetadataReviewIssueLabel,
  aoiMetadataReviewReport,
  describeAoiMetadataReview,
} from "./aoi-metadata-review";

function aoi(patch: Partial<AddOnInstruction> = {}): AddOnInstruction {
  return {
    id: "aoi",
    name: "ScaleAOI",
    parameters: [],
    localTags: [],
    routineNames: [],
    ...patch,
  };
}

function projectWith(aois: AddOnInstruction[]): PlcProject {
  return { controllers: [{ id: "ctrl", name: "Controller", addOnInstructions: aois }] } as unknown as PlcProject;
}

describe("AOI metadata review", () => {
  it("projects imported identity/documentation metadata read-only with offline boundaries", () => {
    const review = describeAoiMetadataReview(aoi({
      revision: "2.7",
      revisionExtension: "-beta",
      softwareRevision: "v32.11",
      vendor: "ESCO",
      signature: "AABBCCDD",
      createdDate: "2024-01-01",
      createdBy: "ENG\\alice",
      editedDate: "2024-06-01",
      editedBy: "ENG\\bob",
      revisionNote: "Initial release",
      additionalHelpText: "Scales an analog input.",
      executePrescan: true,
      executeEnableInFalse: false,
    }));

    expect(review).toMatchObject({
      aoiName: "ScaleAOI",
      protectedSource: false,
      revision: "2.7",
      revisionExtension: "-beta",
      softwareRevision: "v32.11",
      revisionMajor: 2,
      revisionMinor: 7,
      vendor: "ESCO",
      signaturePresent: true,
      safetyPartition: "unspecified",
      identityMetadataPresent: true,
      documentationMetadataPresent: true,
      authoringMetadataPresent: true,
      scanModeMetadataPresent: true,
      status: "reviewable",
      issues: [],
      signatureEnforcementModelled: false,
      sourceProtectionBypassModelled: false,
      scanModeExecutionModelled: false,
      safetyPartitionEnforcementModelled: false,
    });
    expect(review.scanModes).toEqual({ executePrescan: true, executeEnableInFalse: false });
    expect(review.boundaries).toEqual(expect.arrayContaining([
      "metadata-display-only",
      "no-signature-enforcement",
      "no-source-protection-bypass",
      "no-scan-mode-execution",
      "no-safety-partition-enforcement",
    ]));
  });

  it("surfaces protected-AOI metadata while keeping the logic body sealed", () => {
    const review = describeAoiMetadataReview(aoi({
      name: "VendorBlock",
      protected: true,
      protectionType: "Protected",
      revision: "1.0",
      vendor: "Acme",
    }));

    expect(review.protectedSource).toBe(true);
    expect(review.protectionType).toBe("Protected");
    expect(review.status).toBe("reviewable");
    expect(review.sourceProtectionBypassModelled).toBe(false);
    expect(review.message).toContain("source-protected");
    expect(review.message).toContain("logic body stays sealed");
  });

  it("normalizes the safety/standard partition from the Class attribute", () => {
    expect(describeAoiMetadataReview(aoi({ safetyClass: "Safety" })).safetyPartition).toBe("safety");
    expect(describeAoiMetadataReview(aoi({ safetyClass: "Standard" })).safetyPartition).toBe("standard");
    expect(describeAoiMetadataReview(aoi({ safetyClass: "  " })).safetyPartition).toBe("unspecified");
    expect(describeAoiMetadataReview(aoi()).safetyPartition).toBe("unspecified");
  });

  it("treats SoftwareRevision alone as reviewable identity metadata", () => {
    const review = describeAoiMetadataReview(aoi({ softwareRevision: "v32.11" }));
    expect(review.softwareRevision).toBe("v32.11");
    expect(review.identityMetadataPresent).toBe(true);
    expect(review.status).toBe("reviewable");
  });

  it("flags an unparseable revision and partial authoring identity", () => {
    const review = describeAoiMetadataReview(aoi({
      revision: "v2",
      createdDate: "2024-01-01",
      editedBy: "ENG\\bob",
    }));

    expect(review.status).toBe("needs-attention");
    expect(review.issues).toEqual(
      expect.arrayContaining(["invalid-revision-format", "partial-created-identity", "partial-edited-identity"]),
    );
    expect(review.revisionMajor).toBeUndefined();
  });

  it("flags a safety-class AOI that carries no instruction signature", () => {
    const review = describeAoiMetadataReview(aoi({ name: "SafetyBlock", safetyClass: "Safety" }));
    expect(review.safetyPartition).toBe("safety");
    expect(review.signaturePresent).toBe(false);
    expect(review.status).toBe("needs-attention");
    expect(review.issues).toContain("unsigned-safety-aoi");
    expect(review.message).toContain("instruction signature");
  });

  it("does not flag a safety-class AOI once it carries a signature", () => {
    const review = describeAoiMetadataReview(aoi({ safetyClass: "Safety", signature: "AABBCCDD" }));
    expect(review.signaturePresent).toBe(true);
    expect(review.issues).not.toContain("unsigned-safety-aoi");
    expect(review.status).toBe("reviewable");
  });

  it("does not flag a standard AOI for a missing signature", () => {
    const review = describeAoiMetadataReview(aoi({ safetyClass: "Standard" }));
    expect(review.issues).not.toContain("unsigned-safety-aoi");
  });

  it("reports no-metadata for a bare AOI", () => {
    const review = describeAoiMetadataReview(aoi());
    expect(review.status).toBe("no-metadata");
    expect(review.issues).toEqual([]);
    expect(review.message).toContain("no imported identity/documentation metadata");
  });

  it("aggregates a project-level report", () => {
    const report = aoiMetadataReviewReport(projectWith([
      aoi({ name: "A", revision: "1.2", signature: "S1", safetyClass: "Safety" }),
      aoi({ name: "B", protected: true, revision: "bad" }),
      aoi({ name: "C" }),
      aoi({ name: "D", safetyClass: "Safety" }),
    ]));

    expect(report.aoiCount).toBe(4);
    expect(report.protectedCount).toBe(1);
    expect(report.signedCount).toBe(1);
    expect(report.safetyClassCount).toBe(2);
    expect(report.invalidRevisionCount).toBe(1);
    expect(report.unsignedSafetyCount).toBe(1);
    expect(report.issueCount).toBe(2);
    expect(report.warnings).toHaveLength(2);
  });

  it("exposes human-readable boundary and issue labels", () => {
    expect(aoiMetadataReviewBoundaryLabel("no-signature-enforcement")).toContain("never verified");
    expect(aoiMetadataReviewIssueLabel("invalid-revision-format")).toContain("Major");
    expect(aoiMetadataReviewIssueLabel("unsigned-safety-aoi")).toContain("signature");
  });
});
