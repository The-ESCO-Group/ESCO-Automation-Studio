import { describe, expect, it } from "vitest";
import type { ControllerDriverSummary } from "./types";
import { createDefaultControllerDrivers } from "./drivers";
import { describeControllerDriver } from "./gateway";
import { gatewayValidationReadinessReport } from "./validation-readiness";

function capabilities(): ControllerDriverSummary["capabilities"] {
  return {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: true,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: true,
    canSubscribeTags: true,
    canUploadSnapshot: false,
    canCompareProject: true,
    canWriteTags: false,
    canDownloadProject: false,
    canOnlineEdit: false,
    canForceTags: false,
    canModeChange: false,
    canClearFaults: false,
  };
}

describe("gateway validation readiness", () => {
  it("keeps software-wired real-controller routes blocked without lab or field evidence", () => {
    const report = gatewayValidationReadinessReport([
      {
        id: "ethernetip-cip-readonly",
        name: "ESCO EtherNet/IP CIP Read-Only Driver",
        kind: "ethernetip",
        capabilities: capabilities(),
        readOnly: true,
        safetyNote: "Read-only route.",
        connectionEvidence: {
          transportValidation: "software-wired",
          realControllerIo: true,
          hardwareValidated: false,
          verified: false,
          label: "Software-wired, not field-validated",
          message: "No lab or field evidence is attached.",
          limitations: ["Engineering preview only."],
        },
      },
    ]);

    const ethernetip = report.drivers.find((driver) => driver.driverId === "ethernetip-cip-readonly");

    expect(report.destructiveOperationsEnabled).toBe(false);
    expect(report.hardwareValidatedRouteCount).toBe(0);
    expect(ethernetip?.realControllerIo).toBe(true);
    expect(ethernetip?.readOnlyReleaseEligible).toBe(false);
    expect(ethernetip?.gates.find((gate) => gate.id === "hardware-validation-evidence")).toMatchObject({
      state: "blocked",
    });
    expect(ethernetip?.gates.find((gate) => gate.id === "mutation-safety")).toMatchObject({
      state: "passed",
    });
  });

  it("allows verified software-only paths without pretending they validate physical PLC routes", () => {
    const report = gatewayValidationReadinessReport(
      createDefaultControllerDrivers().map((driver) => describeControllerDriver(driver)),
      "2026-06-15T12:00:00.000Z",
    );
    const simulator = report.drivers.find((driver) => driver.driverId === "esco-simulator");

    expect(simulator?.realControllerIo).toBe(false);
    expect(simulator?.readOnlyReleaseEligible).toBe(true);
    expect(simulator?.summary).toContain("software-only");
    expect(simulator?.gates.find((gate) => gate.id === "hardware-validation-evidence")?.state).toBe("passed");
  });

  it("marks a future lab-verified real route read-only eligible while writes remain disabled", () => {
    const report = gatewayValidationReadinessReport([
      {
        id: "lab-ethernetip",
        name: "Lab EtherNet/IP",
        kind: "ethernetip",
        capabilities: capabilities(),
        readOnly: true,
        safetyNote: "Read-only lab route.",
        connectionEvidence: {
          transportValidation: "lab-verified",
          realControllerIo: true,
          hardwareValidated: true,
          verified: true,
          label: "Lab verified",
          message: "Validated on a lab CompactLogix fixture.",
          evidenceId: "LAB-AB-001",
          validatedAt: "2026-06-15T12:00:00.000Z",
          limitations: ["Read-only validation only."],
        },
      },
    ]);

    expect(report.hardwareValidatedRouteCount).toBe(1);
    expect(report.readOnlyReleaseEligibleRouteCount).toBe(1);
    expect(report.destructiveOperationsEnabled).toBe(false);
    expect(report.drivers[0]?.readOnlyReleaseEligible).toBe(true);
    expect(report.drivers[0]?.gates.find((gate) => gate.id === "mutation-safety")?.state).toBe("passed");
  });

  it("blocks readiness when mutation capabilities appear before destructive validation exists", () => {
    const unsafe = capabilities();
    unsafe.canWriteTags = true;
    const report = gatewayValidationReadinessReport([
      {
        id: "unsafe",
        name: "Unsafe Route",
        kind: "ethernetip",
        capabilities: unsafe,
        readOnly: false,
        safetyNote: "Unsafe.",
        connectionEvidence: {
          transportValidation: "lab-verified",
          realControllerIo: true,
          hardwareValidated: true,
          verified: true,
          label: "Lab verified",
          message: "Validated.",
          limitations: [],
        },
      },
    ]);

    expect(report.readOnlyReleaseEligibleRouteCount).toBe(0);
    expect(report.drivers[0]?.gates.find((gate) => gate.id === "mutation-safety")?.state).toBe("blocked");
  });
});
