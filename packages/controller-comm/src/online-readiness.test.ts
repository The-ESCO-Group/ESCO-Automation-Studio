import { describe, expect, it } from "vitest";
import {
  controllerSafetyEvidenceReport,
  onlineReadinessReport,
  shippedOnlineReadinessReport,
  type ControllerConnectionCapabilities,
} from "./index";

function verifiedPhysicalCapabilities(): ControllerConnectionCapabilities {
  return {
    realControllerIo: true,
    verified: true,
    browseNetwork: true,
    discoverModules: true,
    upload: true,
    download: true,
    restoreBackup: true,
    onlineEdit: true,
    modeChange: true,
    clearFaults: true,
    readTags: true,
    writeTags: true,
    subscribeTags: true,
  };
}

describe("online readiness report", () => {
  it("shows the shipped build as half prepared but not online-enabled", () => {
    const report = shippedOnlineReadinessReport();

    expect(report.stageCount).toBe(10);
    expect(report.completedStageCount).toBe(5);
    expect(report.firstHalfPrepared).toBe(true);
    expect(report.onlineEnabled).toBe(false);
    expect(report.readOnlyOnlinePossible).toBe(false);
    expect(report.destructiveOnlinePossible).toBe(false);
    expect(report.verifiedPhysicalTransportCount).toBe(0);
    expect(report.blockedBoundaryCount).toBe(report.physicalBoundaryCount);
    expect(report.stages.find((stage) => stage.id === "verified-readonly-driver")?.status).toBe("blocked");
    expect(report.topology.edges.find((edge) => edge.to === "real-controller")?.status).toBe("blocked");
    expect(report.summary).toMatch(/5\/10/);
  });

  it("can model a future verified read-only online path without enabling destructive operations", () => {
    const safetyEvidence = controllerSafetyEvidenceReport([
      {
        id: "esco.future-readonly",
        name: "Future verified read-only hardware",
        kind: "hardware-adapter",
        capabilities: {
          ...verifiedPhysicalCapabilities(),
          download: false,
          onlineEdit: false,
          modeChange: false,
          clearFaults: false,
          writeTags: false,
        },
      },
    ]);
    const report = onlineReadinessReport({ safetyEvidence });

    expect(report.onlineEnabled).toBe(true);
    expect(report.readOnlyOnlinePossible).toBe(true);
    expect(report.destructiveOnlinePossible).toBe(false);
    expect(report.stages.find((stage) => stage.id === "verified-readonly-driver")?.status).toBe("complete");
    expect(report.stages.find((stage) => stage.id === "controlled-writes")?.status).toBe("blocked");
    expect(report.topology.edges.find((edge) => edge.to === "real-controller")?.status).toBe("complete");
    expect(report.topology.edges.find((edge) => edge.to === "write-ops")?.status).toBe("blocked");
  });

  it("keeps online edits separate even after destructive validation starts", () => {
    const safetyEvidence = controllerSafetyEvidenceReport([
      {
        id: "esco.future-write",
        name: "Future verified write hardware",
        kind: "hardware-adapter",
        capabilities: verifiedPhysicalCapabilities(),
      },
    ]);
    const report = onlineReadinessReport({
      safetyEvidence,
      destructiveValidationComplete: true,
      onlineEditValidationComplete: false,
    });

    expect(report.onlineEnabled).toBe(true);
    expect(report.destructiveOnlinePossible).toBe(false);
    expect(report.stages.find((stage) => stage.id === "controlled-writes")?.status).toBe("partial");
    expect(report.stages.find((stage) => stage.id === "online-edits-forces")?.status).toBe("blocked");
  });
});
