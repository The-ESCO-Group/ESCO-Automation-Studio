import { describe, expect, it } from "vitest";
import {
  STUDIO5000_DOWNLOAD_PHASES,
  describeControllerDownloadCapabilities,
  planSoftControllerTransfer,
} from "./controller-download-lifecycle";

describe("controller download lifecycle capabilities", () => {
  it("keeps the four Studio 5000-style phases explicit", () => {
    expect(STUDIO5000_DOWNLOAD_PHASES.map((phase) => phase.id)).toEqual([
      "compile",
      "take-control-clear",
      "transfer",
      "verify-finalize",
    ]);
  });

  it("marks ESCO SoftController download/upload as software-only implemented", () => {
    const report = describeControllerDownloadCapabilities("esco-soft-controller");
    expect(report.physicalHardware).toBe(false);
    expect(report.canExecuteDownload).toBe(true);
    expect(report.canExecuteUpload).toBe(true);
    expect(report.phases.every((phase) => phase.status === "implemented")).toBe(true);
    expect(report.allowedOperations.some((operation) => /easruntime/i.test(operation))).toBe(true);
    expect(report.blockedOperations.some((operation) => /Allen-Bradley|Rockwell/i.test(operation))).toBe(true);
  });

  it("blocks Allen-Bradley physical transfer without official Rockwell tooling", () => {
    const report = describeControllerDownloadCapabilities("allen-bradley-logix");
    expect(report.physicalHardware).toBe(true);
    expect(report.canExecuteDownload).toBe(false);
    expect(report.canExecuteUpload).toBe(false);
    expect(report.requiresRockwellSdk).toBe(true);
    expect(report.usesUnpublishedRockwellCipServices).toBe(true);
    expect(report.phases.every((phase) => phase.status === "blocked")).toBe(true);
    expect(report.blockedOperations).toContain("Use unpublished Rockwell CIP download/upload services.");
  });
});

describe("planSoftControllerTransfer", () => {
  it("splits runtime text into audited software chunks", () => {
    const plan = planSoftControllerTransfer("abcdefghij", 4);
    expect(plan.softwareOnly).toBe(true);
    expect(plan.protocol).toBe("esco-softcontroller-runtime-chunks-v1");
    expect(plan.totalBytes).toBe(10);
    expect(plan.chunkCount).toBe(3);
    expect(plan.chunks.map((chunk) => [chunk.index, chunk.offset, chunk.bytes, chunk.final])).toEqual([
      [0, 0, 4, false],
      [1, 4, 4, false],
      [2, 8, 2, true],
    ]);
    expect(plan.chunks.every((chunk) => /^[0-9a-f]{8}$/.test(chunk.fingerprint))).toBe(true);
  });

  it("rejects invalid chunk sizes", () => {
    expect(() => planSoftControllerTransfer("abc", 0)).toThrow(/chunkSize/i);
  });
});
