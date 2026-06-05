import { describe, expect, it } from "vitest";
import {
  CONTROLLER_COMMAND_LIST,
  NO_HARDWARE_CONNECTION_CAPABILITIES,
  SIMULATOR_CONNECTION_CAPABILITIES,
  SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
  physicalCommandGuardReport,
  type ControllerConnectionCapabilities,
} from "./index";

const physicalCommandCount = CONTROLLER_COMMAND_LIST.filter((command) => command.requiresRealIo).length;

function fullyVerifiedPhysicalCapabilities(): ControllerConnectionCapabilities {
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

/**
 * The shape the planned first online release targets: a verified PHYSICAL link
 * that can read/monitor live values but publishes no write capability of any
 * kind (no tag writes, download, online edits, mode changes, or fault clearing).
 */
function verifiedReadOnlyPhysicalCapabilities(): ControllerConnectionCapabilities {
  return {
    realControllerIo: true,
    verified: true,
    browseNetwork: false,
    discoverModules: false,
    upload: false,
    download: false,
    restoreBackup: false,
    onlineEdit: false,
    modeChange: false,
    clearFaults: false,
    readTags: true,
    writeTags: false,
    subscribeTags: true,
  };
}

describe("physicalCommandGuardReport", () => {
  it("keeps the verified ESCO SoftController classified as software-only", () => {
    const report = physicalCommandGuardReport({
      id: "esco.soft-controller",
      name: "ESCO SoftController",
      kind: "soft-controller",
      capabilities: SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
    });

    expect(report).toMatchObject({
      providerId: "esco.soft-controller",
      providerName: "ESCO SoftController",
      providerKind: "soft-controller",
      classification: "verified-software",
      verifiedSoftwareOnly: true,
      physicalTransportReady: false,
      totalPhysicalCommands: physicalCommandCount,
      blockedPhysicalCommands: physicalCommandCount,
      clearedPhysicalCommands: 0,
    });
    expect(report.message).toMatch(/verified software only/i);
    expect(report.rows.every((row) => row.reason === "no-real-transport")).toBe(true);
    expect(report.rows.every((row) => row.firstBlocker === "no-real-transport")).toBe(true);
    expect(report.rows.find((row) => row.commandKind === "download")).toMatchObject({
      available: false,
      cleared: false,
      reason: "no-real-transport",
      firstBlocker: "no-real-transport",
    });
  });

  it("blocks every physical command for simulator and no-hardware providers", () => {
    for (const [name, capabilities, classification] of [
      ["ESCO Simulator", SIMULATOR_CONNECTION_CAPABILITIES, "simulation"],
      ["No Hardware Adapter", NO_HARDWARE_CONNECTION_CAPABILITIES, "unsupported"],
    ] as const) {
      const report = physicalCommandGuardReport({ name, capabilities });
      expect(report.classification).toBe(classification);
      expect(report.totalPhysicalCommands).toBe(physicalCommandCount);
      expect(report.blockedPhysicalCommands).toBe(physicalCommandCount);
      expect(report.clearedPhysicalCommands).toBe(0);
      expect(report.rows.every((row) => row.available === false)).toBe(true);
      expect(report.rows.every((row) => row.firstBlocker === row.reason)).toBe(true);
    }
  });

  it("only a verified physical provider can clear physical command gates", () => {
    const report = physicalCommandGuardReport(
      {
        id: "esco.test-physical",
        name: "Verified physical transport (test only)",
        kind: "hardware-adapter",
        capabilities: fullyVerifiedPhysicalCapabilities(),
      },
      { state: "connected-readonly", confirmed: true },
    );

    expect(report).toMatchObject({
      classification: "verified-physical",
      verifiedSoftwareOnly: false,
      physicalTransportReady: true,
      totalPhysicalCommands: physicalCommandCount,
      blockedPhysicalCommands: 0,
      clearedPhysicalCommands: physicalCommandCount,
    });
    expect(report.rows.every((row) => row.available === true)).toBe(true);
    expect(report.rows.every((row) => row.cleared === true)).toBe(true);
  });

  it("allows a future verified read-only provider to clear only read commands", () => {
    const report = physicalCommandGuardReport({
      id: "esco.test-readonly",
      name: "Verified read-only physical transport (test only)",
      kind: "hardware-adapter",
      capabilities: verifiedReadOnlyPhysicalCapabilities(),
    });
    const availableRows = report.rows.filter((row) => row.available);
    const writeRows = report.rows.filter((row) => row.risk !== "read");

    expect(report.classification).toBe("verified-physical");
    expect(report.physicalTransportReady).toBe(true);
    expect(availableRows.length).toBeGreaterThan(0);
    expect(availableRows.every((row) => row.risk === "read" && row.cleared === true)).toBe(true);
    expect(writeRows.every((row) => row.available === false && row.reason === "capability-missing")).toBe(true);
    expect(report.rows.find((row) => row.commandKind === "go-online")).toMatchObject({
      available: true,
      reason: null,
    });
    expect(report.rows.find((row) => row.commandKind === "monitor")).toMatchObject({
      available: true,
      reason: null,
    });
    expect(report.rows.find((row) => row.commandKind === "fault-diagnostics")).toMatchObject({
      available: true,
      reason: null,
    });
    expect(report.rows.find((row) => row.commandKind === "network-browser")).toMatchObject({
      available: false,
      reason: "capability-missing",
    });
    expect(report.rows.find((row) => row.commandKind === "upload")).toMatchObject({
      available: false,
      reason: "capability-missing",
    });
    expect(report.rows.find((row) => row.commandKind === "download")).toMatchObject({
      available: false,
      reason: "capability-missing",
    });
    expect(report.rows.find((row) => row.commandKind === "online-edit")).toMatchObject({
      available: false,
      reason: "capability-missing",
    });
  });
});
