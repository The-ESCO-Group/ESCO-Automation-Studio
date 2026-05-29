import { describe, expect, it } from "vitest";
import {
  ControllerSession,
  DOWNLOAD_COMMAND,
  ONLINE_EDIT_COMMAND,
  OfflineSimulationTransport,
  ReadOnlyControllerTransport,
  RealControllerTransport,
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
    canWrite: true,
  };
  async connect(): Promise<TransportConnectResult> {
    return { ok: true, reportedState: "connected-readonly", message: "Verified link open." };
  }
  async disconnect(): Promise<void> {}
}

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

  it("the unavailable transport stays disconnected", async () => {
    const session = new ControllerSession(new UnavailableTransport());
    session.selectTransport(new UnavailableTransport());
    const snap = await session.goOnline();
    expect(snap.state).toBe("disconnected");
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
});

describe("guarded commands: upload/download/online-edit are blocked without a verified real transport", () => {
  for (const command of [UPLOAD_COMMAND, DOWNLOAD_COMMAND, ONLINE_EDIT_COMMAND]) {
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

  it("every blocked attempt is recorded in the audit log", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    session.runCommand(DOWNLOAD_COMMAND, { confirmed: true });
    session.runCommand(UPLOAD_COMMAND, { confirmed: true });
    const blocked = session.auditLog.filter((e) => e.type === "command-blocked");
    expect(blocked.length).toBe(2);
  });

  it("a write command still needs confirmation even on a verified transport", () => {
    const session = new ControllerSession(new VerifiedRealTransport());
    session.selectTransport(new VerifiedRealTransport());
    // Not connected yet → blocked on connection first.
    expect(session.evaluate(DOWNLOAD_COMMAND, true).reason).toBe("not-connected");
  });

  it("availability is descriptive so the UI can show commands but disable them", () => {
    const session = new ControllerSession(new OfflineSimulationTransport());
    const availability = session.evaluate(DOWNLOAD_COMMAND, true);
    expect(availability.blocked).toBe(true);
    expect(availability.command.label).toBe("Download to Controller");
    expect(availability.explanation).toMatch(/no tested controller transport/i);
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
