import { describe, expect, it } from "vitest";
import {
  CONTROLLER_COMMAND_LIST,
  controllerSafetyEvidenceReport,
  shippedControllerSafetyEvidenceReport,
  type ControllerConnectionCapabilities,
} from "./index";

const physicalCommandCount = CONTROLLER_COMMAND_LIST.filter((command) => command.requiresRealIo).length;

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

describe("controller safety evidence report", () => {
  it("proves the shipped controller surface has no verified physical transport", () => {
    const report = shippedControllerSafetyEvidenceReport();

    expect(report.shippedProviderCount).toBe(3);
    expect(report.shippedDriverCount).toBe(3);
    expect(report.verifiedSoftwareProviderCount).toBe(1);
    expect(report.verifiedPhysicalProviderCount).toBe(0);
    expect(report.verifiedShippedDriverCount).toBe(0);
    expect(report.readyShippedDriverCount).toBe(0);
    expect(report.realTransportGate).toBe("blocked");
    expect(report.transportCount).toBe(3);
    expect(report.providerRows.every((row) => row.realControllerIo === false)).toBe(true);
    expect(report.driverRows.map((row) => row.id)).toEqual(["offline-sim", "unavailable", "model-only"]);
    expect(report.driverRows.every((row) => row.verified === false && row.ready === false)).toBe(true);
    expect(report.driverRows.every((row) => row.readiness !== "ready")).toBe(true);
    expect(report.providerRows.find((row) => row.kind === "soft-controller")).toMatchObject({
      verifiedSoftwareOnly: true,
      physicalTransportReady: false,
    });
  });

  it("keeps every shipped physical command row and hard boundary blocked", () => {
    const report = shippedControllerSafetyEvidenceReport();

    expect(report.physicalCommandSurfaceCount).toBe(physicalCommandCount);
    expect(report.totalPhysicalCommandRows).toBe(physicalCommandCount * report.shippedProviderCount);
    expect(report.blockedPhysicalCommandRows).toBe(report.totalPhysicalCommandRows);
    expect(report.clearedPhysicalCommandRows).toBe(0);
    expect(report.allPhysicalCommandsBlocked).toBe(true);
    expect(report.allHardBoundariesBlocked).toBe(true);
    expect(report.boundaryRows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "physical-upload",
        "physical-download",
        "physical-go-online",
        "physical-online-edit",
        "physical-force",
        "proprietary-binary",
      ]),
    );
    expect(report.boundaryRows.every((row) => row.status === "blocked")).toBe(true);
    expect(report.invariantRows.every((row) => row.passed)).toBe(true);
    expect(report.invariantRows.find((row) => row.id === "no-shipped-driver-ready")).toMatchObject({
      passed: true,
    });
  });

  it("detects when a future verified physical provider clears the real transport gate", () => {
    const report = controllerSafetyEvidenceReport([
      {
        id: "esco.future-hardware-test",
        name: "Future verified hardware test",
        kind: "hardware-adapter",
        capabilities: verifiedPhysicalCapabilities(),
      },
    ]);

    expect(report.verifiedPhysicalProviderCount).toBe(1);
    expect(report.realTransportGate).toBe("available");
    expect(report.readyShippedDriverCount).toBe(0);
    expect(report.allPhysicalCommandsBlocked).toBe(false);
    expect(report.clearedPhysicalCommandRows).toBe(physicalCommandCount);
    expect(report.invariantRows.find((row) => row.id === "no-verified-physical-transport")?.passed).toBe(false);
  });
});
