import { describe, expect, it } from "vitest";
import {
  CONTROLLER_COMMAND_LIST,
  DOWNLOAD_COMMAND,
  GO_OFFLINE_COMMAND,
  MONITOR_COMMAND,
  shippedTransportReadinessReport,
  transportReadinessReport,
  type TransportCapabilities,
} from "./index";

const UNVERIFIED_READONLY: TransportCapabilities = {
  realControllerIo: true,
  verified: false,
  simulation: false,
  canRead: true,
  canWrite: false,
};

const VERIFIED_WRITE: TransportCapabilities = {
  realControllerIo: true,
  verified: true,
  simulation: false,
  canRead: true,
  canBrowseNetwork: true,
  canSelectPath: true,
  canPathDiagnostics: true,
  canUpload: true,
  canMonitor: true,
  canReadFaults: true,
  canWrite: true,
};

describe("transport readiness report", () => {
  it("shows every shipped transport as offline/model-only/unsupported, never verified real I/O", () => {
    const report = shippedTransportReadinessReport();
    expect(report.transportCount).toBe(3);
    expect(report.verifiedRealTransportCount).toBe(0);
    expect(report.simulationTransportCount).toBe(1);
    expect(report.modelOnlyTransportCount).toBe(1);
    expect(report.unsupportedTransportCount).toBe(1);
    expect(report.rows.every((row) => row.capabilities.realControllerIo === false)).toBe(true);
  });

  it("keeps real controller commands blocked for the shipped offline simulation transport", () => {
    const report = shippedTransportReadinessReport();
    const row = report.rows.find((item) => item.kind === "offline-sim");
    expect(row?.status).toBe("simulation-ready");
    expect(row?.commandGate.find((gate) => gate.command === GO_OFFLINE_COMMAND)?.available).toBe(true);
    expect(row?.commandGate.find((gate) => gate.command === MONITOR_COMMAND)?.reason).toBe("no-real-transport");
    expect(row?.blockedRealCommandCount).toBe(row?.realCommandCount);
    expect(row?.nextStep).toMatch(/verified ESCO controller transport/i);
  });

  it("flags an unverified real read-only transport as safety-blocked", () => {
    const report = transportReadinessReport([
      {
        kind: "readonly-monitor",
        displayName: "Unverified read-only harness",
        capabilities: UNVERIFIED_READONLY,
      },
    ]);
    const [row] = report.rows;
    expect(row.status).toBe("safety-blocked");
    expect(row.firstBlocker).toBe("safety-unverified");
    expect(row.errorCount).toBe(1);
    expect(row.commandGate.find((gate) => gate.command === MONITOR_COMMAND)?.reason).toBe("safety-unverified");
    expect(row.commandGate.find((gate) => gate.command === DOWNLOAD_COMMAND)?.reason).toBe("safety-unverified");
  });

  it("can model the future verified transport gate without shipping one", () => {
    const report = transportReadinessReport([
      {
        kind: "real-controller",
        displayName: "Verified test harness",
        capabilities: VERIFIED_WRITE,
        assumedState: "connected-monitor",
      },
    ]);
    const [row] = report.rows;
    expect(row.status).toBe("verified-readwrite");
    expect(row.errorCount).toBe(0);
    expect(row.blockedRealCommandCount).toBe(0);
    expect(row.destructiveAvailableCount).toBeGreaterThan(0);
    expect(row.commandGate.length).toBe(CONTROLLER_COMMAND_LIST.length);
  });
});
