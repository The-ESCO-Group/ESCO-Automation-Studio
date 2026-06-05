import { describe, expect, it } from "vitest";
import {
  CONTROLLER_COMMAND_LIST,
  ControllerSession,
  DOWNLOAD_COMMAND,
  GO_ONLINE_COMMAND,
  MONITOR_COMMAND,
  UPLOAD_COMMAND,
  OfflineSimulationTransport,
  UnavailableTransport,
  commissioningPreflight,
  evaluateCommand,
  preflightSummary,
  type CommandContext,
  type ControllerCommand,
  type TransportCapabilities,
} from "./index";

const SIM_CAPS: TransportCapabilities = {
  realControllerIo: false,
  verified: false,
  simulation: true,
  canRead: true,
  canWrite: false,
};
const UNAVAILABLE_CAPS: TransportCapabilities = {
  realControllerIo: false,
  verified: false,
  simulation: false,
  canRead: false,
  canWrite: false,
};
const UNVERIFIED_REAL_CAPS: TransportCapabilities = {
  realControllerIo: true,
  verified: false,
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
const VERIFIED_READONLY_CAPS: TransportCapabilities = {
  realControllerIo: true,
  verified: true,
  simulation: false,
  canRead: true,
  canMonitor: true,
  canReadFaults: true,
  canWrite: false,
};
const VERIFIED_WRITE_CAPS: TransportCapabilities = {
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

const COMMANDS: ControllerCommand[] = [...CONTROLLER_COMMAND_LIST];

const CONTEXTS: { name: string; ctx: CommandContext }[] = [
  { name: "offline simulation", ctx: { state: "offline-simulation", capabilities: SIM_CAPS, confirmed: true } },
  { name: "unavailable transport", ctx: { state: "disconnected", capabilities: UNAVAILABLE_CAPS, confirmed: true } },
  { name: "model-only", ctx: { state: "model-only", capabilities: UNAVAILABLE_CAPS, confirmed: true } },
  { name: "unverified real", ctx: { state: "safety-blocked", capabilities: UNVERIFIED_REAL_CAPS, confirmed: true } },
  {
    name: "verified read-only, not connected",
    ctx: { state: "disconnected", capabilities: VERIFIED_READONLY_CAPS, confirmed: true },
  },
  {
    name: "verified write, connected, unconfirmed",
    ctx: { state: "connected-readonly", capabilities: VERIFIED_WRITE_CAPS, confirmed: false },
  },
  {
    name: "verified write, connected, confirmed",
    ctx: { state: "connected-readonly", capabilities: VERIFIED_WRITE_CAPS, confirmed: true },
  },
  {
    name: "verified read-only download (no write capability)",
    ctx: { state: "connected-readonly", capabilities: VERIFIED_READONLY_CAPS, confirmed: true },
  },
];

describe("commissioningPreflight agrees with the command gate (the key invariant)", () => {
  for (const command of COMMANDS) {
    for (const { name, ctx } of CONTEXTS) {
      it(`${command.kind} under ${name}: firstBlocker === evaluateCommand reason`, () => {
        const report = commissioningPreflight(command, ctx);
        const availability = evaluateCommand(command, ctx);
        // The preflight never disagrees with the authoritative gate.
        expect(report.firstBlocker).toBe(availability.reason);
        expect(report.cleared).toBe(availability.available);
      });
    }
  }
});

describe("commissioningPreflight enumerates every gate honestly", () => {
  it("offline simulation blocks a real command at the transport gate, but shows all gates", () => {
    const report = commissioningPreflight(DOWNLOAD_COMMAND, {
      state: "offline-simulation",
      capabilities: SIM_CAPS,
      confirmed: true,
    });
    expect(report.cleared).toBe(false);
    expect(report.firstBlocker).toBe("no-real-transport");
    // Every gate is enumerated (not just the first blocker), so a UI checklist is honest.
    const ids = report.checks.map((c) => c.id);
    expect(ids).toContain("real-transport");
    expect(ids).toContain("verified");
    expect(ids).toContain("write-capable");
    expect(ids).toContain("connected");
    expect(ids).toContain("confirmed");
    // The unmet gates are clearly marked failed.
    expect(report.checks.find((c) => c.id === "real-transport")?.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "verified")?.passed).toBe(false);
  });

  it("a read-only verified transport fails the write-capable gate for downloads", () => {
    const report = commissioningPreflight(DOWNLOAD_COMMAND, {
      state: "connected-readonly",
      capabilities: VERIFIED_READONLY_CAPS,
      confirmed: true,
    });
    expect(report.firstBlocker).toBe("capability-missing");
    expect(report.checks.find((c) => c.id === "write-capable")?.passed).toBe(false);
  });

  it("a read-only monitor transport does not satisfy upload or browse-style reads", () => {
    const upload = commissioningPreflight(UPLOAD_COMMAND, {
      state: "connected-monitor",
      capabilities: VERIFIED_READONLY_CAPS,
      confirmed: true,
    });
    expect(upload.firstBlocker).toBe("capability-missing");
    expect(upload.checks.find((c) => c.id === "read-capable")?.passed).toBe(false);
  });

  it("a fully verified + connected + confirmed write command clears every gate", () => {
    const report = commissioningPreflight(DOWNLOAD_COMMAND, {
      state: "connected-readonly",
      capabilities: VERIFIED_WRITE_CAPS,
      confirmed: true,
    });
    expect(report.cleared).toBe(true);
    expect(report.firstBlocker).toBeNull();
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("a read-only command (monitor) has no write-capable gate", () => {
    const report = commissioningPreflight(MONITOR_COMMAND, {
      state: "connected-monitor",
      capabilities: VERIFIED_READONLY_CAPS,
      confirmed: true,
    });
    expect(report.cleared).toBe(true);
    expect(report.checks.map((c) => c.id)).not.toContain("write-capable");
  });

  it("preflightSummary reports counts and the blocking detail", () => {
    const blocked = commissioningPreflight(DOWNLOAD_COMMAND, {
      state: "offline-simulation",
      capabilities: SIM_CAPS,
      confirmed: true,
    });
    expect(preflightSummary(blocked)).toMatch(/blocked:/i);
    const cleared = commissioningPreflight(DOWNLOAD_COMMAND, {
      state: "connected-readonly",
      capabilities: VERIFIED_WRITE_CAPS,
      confirmed: true,
    });
    expect(preflightSummary(cleared)).toMatch(/all \d+ safety checks passed/i);
  });
});

describe("ControllerSession.preflight surfaces the same gate as the live session", () => {
  it("session.preflight agrees with session.evaluate for every command (offline sim)", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    for (const command of CONTROLLER_COMMAND_LIST) {
      const report = session.preflight(command, true);
      const availability = session.evaluate(command, true);
      expect(report.firstBlocker).toBe(availability.reason);
      expect(report.cleared).toBe(availability.available);
    }
  });

  it("no shipped transport can clear the Go Online / Download preflight", () => {
    for (const transport of [new OfflineSimulationTransport(), new UnavailableTransport()]) {
      const session = new ControllerSession(transport);
      session.selectTransport(transport);
      for (const command of [GO_ONLINE_COMMAND, DOWNLOAD_COMMAND, MONITOR_COMMAND]) {
        const report = session.preflight(command, true);
        expect(report.cleared).toBe(false);
        // The real-transport gate must be one of the failing checks.
        expect(report.checks.some((check) => check.id === "real-transport" && !check.passed)).toBe(true);
      }
    }
  });

  it("preflight enumerates more than one gate so the operator sees the full checklist", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const report = session.preflight(DOWNLOAD_COMMAND, true);
    expect(report.checks.length).toBeGreaterThan(3);
    // Every check has a human-readable label + detail (no blank rows).
    for (const check of report.checks) {
      expect(check.label.length).toBeGreaterThan(0);
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });
});
