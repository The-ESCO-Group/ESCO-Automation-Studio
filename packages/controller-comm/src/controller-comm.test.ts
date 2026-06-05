import { describe, expect, it } from "vitest";
import {
  ASSEMBLE_EDITS_COMMAND,
  CANCEL_EDITS_COMMAND,
  CLEAR_FAULTS_COMMAND,
  CONTROLLER_COMMAND_LIST,
  CONTROLLER_COMMANDS,
  ControllerSession,
  FAULT_DIAGNOSTICS_COMMAND,
  FINALIZE_EDITS_COMMAND,
  commandRisk,
  nextStepFor,
  DOWNLOAD_COMMAND,
  GO_OFFLINE_COMMAND,
  GO_TO_FAULTS_COMMAND,
  GO_ONLINE_COMMAND,
  LOCK_CONTROLLER_COMMAND,
  ModelOnlyTransport,
  MONITOR_COMMAND,
  NETWORK_BROWSER_COMMAND,
  ONLINE_EDIT_COMMAND,
  OfflineSimulationTransport,
  PATH_DIAGNOSTICS_COMMAND,
  PROGRAM_MODE_COMMAND,
  ReadOnlyControllerTransport,
  RealControllerTransport,
  REMOTE_PROGRAM_MODE_COMMAND,
  REMOTE_RUN_MODE_COMMAND,
  RUN_MODE_COMMAND,
  SELECT_RECENT_PATH_COMMAND,
  TEST_EDITS_COMMAND,
  TEST_MODE_COMMAND,
  UPLOAD_COMMAND,
  UnavailableTransport,
  isConnectedState,
  resolveConnectState,
  type ControllerTransport,
  type TransportCapabilities,
  type TransportConnectResult,
} from "./index";

/**
 * A LYING transport: it claims to have reached "connected-monitor" but has no
 * real, verified capabilities. The safety gate must refuse to honour the lie.
 */
class FakeConnectedTransport implements ControllerTransport {
  readonly kind = "unavailable" as const;
  readonly displayName = "Definitely Real Controller (not)";
  readonly capabilities: TransportCapabilities = {
    realControllerIo: false,
    verified: false,
    simulation: false,
    canRead: true,
    canWrite: true,
  };
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-monitor", message: "Totally connected, trust me." };
  }
  async disconnect(): Promise<void> {}
}

/** A real transport that claims real I/O but has NOT been verified against hardware. */
class UnverifiedRealTransport extends RealControllerTransport {
  readonly displayName = "Unverified CIP link";
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "Link opened (unverified)." };
  }
  async disconnect(): Promise<void> {}
}

/** A read-only real transport (read capability only), also unverified. */
class UnverifiedReadOnlyTransport extends ReadOnlyControllerTransport {
  readonly displayName = "Unverified read-only link";
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "Read-only link (unverified)." };
  }
  async disconnect(): Promise<void> {}
}

/** A hypothetical VERIFIED read-only real transport: monitor/fault reads only. */
class VerifiedReadOnlyTransport extends ReadOnlyControllerTransport {
  readonly displayName = "Verified read-only (test-only) link";
  readonly capabilities: TransportCapabilities = {
    realControllerIo: true,
    verified: true,
    simulation: false,
    canRead: true,
    canMonitor: true,
    canReadFaults: true,
    canWrite: false,
  };
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-monitor", message: "Verified monitor link open." };
  }
  async disconnect(): Promise<void> {}
}

/**
 * A hypothetical VERIFIED real transport — exists ONLY in this test to prove the
 * gate is the single path to a real connection. No such transport ships in the
 * app. It overrides `verified` to true (something no shipped transport does).
 */
class VerifiedRealTransport extends RealControllerTransport {
  readonly displayName = "Verified (test-only) link";
  readonly capabilities: TransportCapabilities = {
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
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "Verified link open." };
  }
  async disconnect(): Promise<void> {}
}

const REAL_IO_COMMANDS = CONTROLLER_COMMAND_LIST.filter((command) => command.requiresRealIo);

describe("safety gate: fake/unavailable transports cannot reach a real Connected state", () => {
  it("a default session is in offline-simulation, not Connected", () => {
    const session = new ControllerSession();
    expect(session.state).toBe("offline-simulation");
    expect(session.snapshot().connected).toBe(false);
  });

  it("a lying transport is downgraded — never Connected", async () => {
    const session = new ControllerSession(new FakeConnectedTransport());
    session.selectTransport(new FakeConnectedTransport());
    const snap = await session.goOnline();
    expect(isConnectedState(snap.state)).toBe(false);
    expect(snap.connected).toBe(false);
    // A non-real transport that claims Connected collapses to disconnected.
    expect(snap.state).toBe("disconnected");
  });

  it("the offline simulation transport never reports Connected", async () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("offline-simulation");
    expect(isConnectedState(snap.state)).toBe(false);
  });

  it("the unavailable transport reports controller-link unavailable without saying Connected", async () => {
    const session = new ControllerSession(new UnavailableTransport());
    session.selectTransport(new UnavailableTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("connected-unavailable");
    expect(snap.stateLabel).toBe("Controller Link Unavailable");
    expect(snap.stateLabel).not.toMatch(/connected/i);
    expect(snap.connected).toBe(false);
  });

  it("model-only review is distinct from offline simulation and is never Connected", async () => {
    const session = new ControllerSession(new ModelOnlyTransport());
    session.selectTransport(new ModelOnlyTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("model-only");
    expect(snap.stateLabel).toBe("Model-only Review");
    expect(snap.connected).toBe(false);
  });

  it("an unverified REAL transport is routed to safety-blocked, not Connected", async () => {
    const session = new ControllerSession(new UnverifiedRealTransport());
    session.selectTransport(new UnverifiedRealTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("safety-blocked");
    expect(isConnectedState(snap.state)).toBe(false);
  });

  it("an unverified read-only real transport is also routed to safety-blocked", async () => {
    const session = new ControllerSession(new UnverifiedReadOnlyTransport());
    session.selectTransport(new UnverifiedReadOnlyTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("safety-blocked");
    expect(snap.transportKind).toBe("readonly-monitor");
  });

  it("monitor cannot be entered without a real connection", async () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    await session.goOnline();
    const snap = session.monitor();
    expect(snap.state).toBe("offline-simulation"); // unchanged
  });

  it("resolveConnectState is the single chokepoint and rejects unverified Connected", () => {
    const connected: TransportConnectResult = {
      ok: true,
      reportedState: "connected-monitor",
      message: "",
    };
    expect(
      resolveConnectState(connected, {
        realControllerIo: true,
        verified: false,
        simulation: false,
        canRead: true,
        canWrite: true,
      }),
    ).toBe("safety-blocked");
    expect(
      resolveConnectState(connected, {
        realControllerIo: false,
        verified: false,
        simulation: false,
        canRead: false,
        canWrite: false,
      }),
    ).toBe("disconnected");
  });

  it("ONLY a verified real transport can reach Connected (proves the gate is the path)", async () => {
    const session = new ControllerSession(new VerifiedRealTransport());
    session.selectTransport(new VerifiedRealTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("connected-readonly");
    expect(isConnectedState(snap.state)).toBe(true);
    // ...and only this verified path can enter Monitor.
    expect(session.monitor().state).toBe("connected-monitor");
  });

  it("a verified read-only transport can monitor but cannot upload, download, browse, or edit", async () => {
    const session = new ControllerSession(new VerifiedReadOnlyTransport());
    session.selectTransport(new VerifiedReadOnlyTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("connected-monitor");
    expect(session.runCommand(MONITOR_COMMAND, { confirmed: true }).outcome).toBe("ran");
    for (const command of [
      NETWORK_BROWSER_COMMAND,
      SELECT_RECENT_PATH_COMMAND,
      PATH_DIAGNOSTICS_COMMAND,
      UPLOAD_COMMAND,
      DOWNLOAD_COMMAND,
      TEST_EDITS_COMMAND,
      ASSEMBLE_EDITS_COMMAND,
      FINALIZE_EDITS_COMMAND,
      CANCEL_EDITS_COMMAND,
      PROGRAM_MODE_COMMAND,
      RUN_MODE_COMMAND,
      REMOTE_PROGRAM_MODE_COMMAND,
      REMOTE_RUN_MODE_COMMAND,
      TEST_MODE_COMMAND,
      LOCK_CONTROLLER_COMMAND,
      CLEAR_FAULTS_COMMAND,
    ]) {
      const result = session.runCommand(command, { confirmed: true });
      expect(result.outcome).toBe("blocked");
      expect(result.reason).toBe("capability-missing");
    }
  });
});

describe("guarded commands: Studio 5000 communication actions are blocked without a verified real transport", () => {
  for (const command of REAL_IO_COMMANDS) {
    it(`${command.kind} is blocked under offline simulation`, () => {
      const session = new ControllerSession(new OfflineSimulationTransport());
      const result = session.runCommand(command, { confirmed: true });
      expect(result.outcome).toBe("blocked");
      expect(result.reason).toBe("no-real-transport");
      expect(result.audit.type).toBe("command-blocked");
    });

    it(`${command.kind} is blocked with the unavailable transport`, () => {
      const session = new ControllerSession(new UnavailableTransport());
      const result = session.runCommand(command, { confirmed: true });
      expect(result.outcome).toBe("blocked");
      expect(result.reason).toBe("no-real-transport");
    });

    it(`${command.kind} is blocked (safety-unverified) with an unverified real transport`, () => {
      const session = new ControllerSession(new UnverifiedRealTransport());
      const result = session.runCommand(command, { confirmed: true });
      expect(result.outcome).toBe("blocked");
      expect(result.reason).toBe("safety-unverified");
    });
  }

  it("go-offline is a local audited workflow and does not require real controller I/O", async () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    expect(session.evaluate(GO_OFFLINE_COMMAND, true).available).toBe(true);
    const result = session.runCommand(GO_OFFLINE_COMMAND, { confirmed: true });
    expect(result.outcome).toBe("ran");
    expect(result.audit.details).toMatchObject({
      status: "ran",
      command: "go-offline",
      reason: null,
      risk: "read",
    });
    await session.goOffline();
    const offlineAudit = session.auditLog.find((event) => event.type === "go-offline");
    expect(offlineAudit?.details).toMatchObject({
      status: "ran",
      reason: null,
      risk: "read",
    });
  });

  it("exposes the Studio 5000 communication menu commands in a stable order", () => {
    expect(CONTROLLER_COMMAND_LIST.map((command) => command.kind)).toEqual([
      "network-browser",
      "select-recent-path",
      "path-diagnostics",
      "go-online",
      "go-offline",
      "monitor",
      "upload",
      "download",
      "online-edit",
      "test-edits",
      "assemble-edits",
      "finalize-edits",
      "cancel-edits",
      "program-mode",
      "run-mode",
      "remote-program-mode",
      "remote-run-mode",
      "test-mode",
      "lock-controller",
      "clear-faults",
      "fault-diagnostics",
      "go-to-faults",
    ]);
    expect(CONTROLLER_COMMANDS["network-browser"]).toBe(NETWORK_BROWSER_COMMAND);
    expect(CONTROLLER_COMMANDS["select-recent-path"]).toBe(SELECT_RECENT_PATH_COMMAND);
    expect(CONTROLLER_COMMANDS["path-diagnostics"]).toBe(PATH_DIAGNOSTICS_COMMAND);
    expect(CONTROLLER_COMMANDS["go-offline"]).toBe(GO_OFFLINE_COMMAND);
    expect(CONTROLLER_COMMANDS["online-edit"]).toBe(ONLINE_EDIT_COMMAND);
    expect(CONTROLLER_COMMANDS["test-edits"]).toBe(TEST_EDITS_COMMAND);
    expect(CONTROLLER_COMMANDS["assemble-edits"]).toBe(ASSEMBLE_EDITS_COMMAND);
    expect(CONTROLLER_COMMANDS["finalize-edits"]).toBe(FINALIZE_EDITS_COMMAND);
    expect(CONTROLLER_COMMANDS["cancel-edits"]).toBe(CANCEL_EDITS_COMMAND);
    expect(CONTROLLER_COMMANDS["program-mode"]).toBe(PROGRAM_MODE_COMMAND);
    expect(CONTROLLER_COMMANDS["run-mode"]).toBe(RUN_MODE_COMMAND);
    expect(CONTROLLER_COMMANDS["remote-program-mode"]).toBe(REMOTE_PROGRAM_MODE_COMMAND);
    expect(CONTROLLER_COMMANDS["remote-run-mode"]).toBe(REMOTE_RUN_MODE_COMMAND);
    expect(CONTROLLER_COMMANDS["test-mode"]).toBe(TEST_MODE_COMMAND);
    expect(CONTROLLER_COMMANDS["lock-controller"]).toBe(LOCK_CONTROLLER_COMMAND);
    expect(CONTROLLER_COMMANDS["clear-faults"]).toBe(CLEAR_FAULTS_COMMAND);
    expect(CONTROLLER_COMMANDS["fault-diagnostics"]).toBe(FAULT_DIAGNOSTICS_COMMAND);
    expect(CONTROLLER_COMMANDS["go-to-faults"]).toBe(GO_TO_FAULTS_COMMAND);
  });

  it("every blocked attempt is recorded in the audit log", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    session.runCommand(GO_ONLINE_COMMAND, { confirmed: true });
    session.runCommand(DOWNLOAD_COMMAND, { confirmed: true });
    session.runCommand(UPLOAD_COMMAND, { confirmed: true });
    session.runCommand(TEST_EDITS_COMMAND, { confirmed: true });
    session.runCommand(ASSEMBLE_EDITS_COMMAND, { confirmed: true });
    session.runCommand(FINALIZE_EDITS_COMMAND, { confirmed: true });
    session.runCommand(CANCEL_EDITS_COMMAND, { confirmed: true });
    const blocked = session.auditLog.filter((e) => e.type === "command-blocked");
    expect(blocked.length).toBe(7);
    expect(blocked.map((event) => event.details?.command)).toEqual([
      "go-online",
      "download",
      "upload",
      "test-edits",
      "assemble-edits",
      "finalize-edits",
      "cancel-edits",
    ]);
  });

  it("model-only state blocks real commands with a specific reason", async () => {
    const session = new ControllerSession(new ModelOnlyTransport());
    session.selectTransport(new ModelOnlyTransport());
    await session.goOnline();
    const result = session.runCommand(GO_ONLINE_COMMAND, { confirmed: true });
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("model-only");
  });

  it("a write command still needs confirmation even on a verified transport", () => {
    const session = new ControllerSession(new VerifiedRealTransport());
    session.selectTransport(new VerifiedRealTransport());
    // Not connected yet → blocked on connection first.
    expect(session.evaluate(DOWNLOAD_COMMAND, true).reason).toBe("not-connected");
  });

  it("monitor is also a real-controller command and cannot run offline", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const result = session.runCommand(MONITOR_COMMAND, { confirmed: true });
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("no-real-transport");
  });

  it("path, mode, lock, fault, and fault-navigation commands are also guarded", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    for (const command of [
      NETWORK_BROWSER_COMMAND,
      SELECT_RECENT_PATH_COMMAND,
      PATH_DIAGNOSTICS_COMMAND,
      TEST_EDITS_COMMAND,
      ASSEMBLE_EDITS_COMMAND,
      FINALIZE_EDITS_COMMAND,
      CANCEL_EDITS_COMMAND,
      PROGRAM_MODE_COMMAND,
      RUN_MODE_COMMAND,
      REMOTE_PROGRAM_MODE_COMMAND,
      REMOTE_RUN_MODE_COMMAND,
      TEST_MODE_COMMAND,
      LOCK_CONTROLLER_COMMAND,
      CLEAR_FAULTS_COMMAND,
      FAULT_DIAGNOSTICS_COMMAND,
      GO_TO_FAULTS_COMMAND,
    ]) {
      const result = session.runCommand(command, { confirmed: true });
      expect(result.outcome).toBe("blocked");
      expect(result.reason).toBe("no-real-transport");
    }
  });

  it("availability is descriptive so the UI can show commands but safely block them", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const availability = session.evaluate(DOWNLOAD_COMMAND, true);
    expect(availability.blocked).toBe(true);
    expect(availability.command.label).toBe("Download to Controller");
    expect(availability.explanation).toMatch(/no tested controller transport/i);
  });
});

describe("command risk classification + required next step", () => {
  it("classifies reads, writes, and destructive commands", () => {
    expect(commandRisk(MONITOR_COMMAND)).toBe("read");
    expect(commandRisk(UPLOAD_COMMAND)).toBe("read");
    expect(commandRisk(NETWORK_BROWSER_COMMAND)).toBe("read");
    expect(commandRisk(PATH_DIAGNOSTICS_COMMAND)).toBe("read");
    expect(commandRisk(GO_OFFLINE_COMMAND)).toBe("read");
    expect(commandRisk(FAULT_DIAGNOSTICS_COMMAND)).toBe("read");
    expect(commandRisk(GO_TO_FAULTS_COMMAND)).toBe("read");
    expect(commandRisk(LOCK_CONTROLLER_COMMAND)).toBe("write");
    expect(commandRisk(CLEAR_FAULTS_COMMAND)).toBe("write");
    expect(commandRisk(DOWNLOAD_COMMAND)).toBe("destructive");
    expect(commandRisk(TEST_EDITS_COMMAND)).toBe("destructive");
    expect(commandRisk(ASSEMBLE_EDITS_COMMAND)).toBe("destructive");
    expect(commandRisk(FINALIZE_EDITS_COMMAND)).toBe("destructive");
    expect(commandRisk(CANCEL_EDITS_COMMAND)).toBe("destructive");
    expect(commandRisk(PROGRAM_MODE_COMMAND)).toBe("destructive");
    expect(commandRisk(RUN_MODE_COMMAND)).toBe("destructive");
    expect(commandRisk(REMOTE_PROGRAM_MODE_COMMAND)).toBe("destructive");
    expect(commandRisk(REMOTE_RUN_MODE_COMMAND)).toBe("destructive");
    expect(commandRisk(TEST_MODE_COMMAND)).toBe("destructive");
  });

  it("gives a concrete next step for every blocked reason and a note when available", () => {
    expect(nextStepFor("no-real-transport")).toMatch(/verified ESCO controller transport/i);
    expect(nextStepFor("not-connected")).toMatch(/go online/i);
    expect(nextStepFor("safety-unverified")).toMatch(/validate the selected transport/i);
    expect(nextStepFor("safety-blocked-state")).toMatch(/safety blocked/i);
    expect(nextStepFor("needs-confirmation")).toMatch(/confirm/i);
    expect(nextStepFor("faulted")).toMatch(/reconnect/i);
    expect(nextStepFor("model-only")).toMatch(/model-only/i);
    expect(nextStepFor(null)).toMatch(/available to run/i);
    // No vague placeholders.
    for (const reason of [
      "no-real-transport",
      "not-connected",
      "safety-unverified",
      "safety-blocked-state",
      "needs-confirmation",
      "faulted",
      "model-only",
    ] as const) {
      expect(nextStepFor(reason)).not.toMatch(/coming soon|not implemented|todo/i);
    }
  });

  it("availability carries risk + next step so the panel can render them", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const availability = session.evaluate(DOWNLOAD_COMMAND, true);
    expect(availability.risk).toBe("destructive");
    expect(availability.nextStep).toMatch(/verified ESCO controller transport/i);
  });

  it("records risk, write flag, transport, and next step in the blocked audit details", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const result = session.runCommand(DOWNLOAD_COMMAND, { confirmed: true });
    expect(result.audit.type).toBe("command-blocked");
    expect(result.audit.details).toMatchObject({
      status: "blocked",
      command: "download",
      reason: "no-real-transport",
      risk: "destructive",
      isWrite: true,
    });
    expect(String(result.audit.details?.nextStep)).toMatch(/verified ESCO controller transport/i);
    expect(String(result.audit.details?.transportName)).toMatch(/.+/);
  });
});

describe("audit + lifecycle", () => {
  it("records go-online / go-offline transitions", async () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    await session.goOnline();
    await session.goOffline();
    const types = session.auditLog.map((e) => e.type);
    expect(types).toContain("go-online");
    expect(types).toContain("go-offline");
  });

  it("notifies subscribers on state changes", async () => {
    const session = new ControllerSession(new UnverifiedRealTransport());
    const seen: string[] = [];
    session.subscribe((snap) => seen.push(snap.state));
    session.selectTransport(new UnverifiedRealTransport());
    await session.goOnline();
    expect(seen).toContain("safety-blocked");
  });
});
