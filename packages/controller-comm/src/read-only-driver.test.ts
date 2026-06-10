import { describe, expect, it } from "vitest";
import { CONTROLLER_COMMANDS } from "./commands";
import { ControllerSession } from "./session";
import {
  InjectedReadOnlyControllerTransport,
  type ReadOnlyCommsCapabilities,
  type ReadOnlyControllerComms,
} from "./read-only-driver";

/**
 * Conformance tests for the read-only driver seam. These prove — WITHOUT any
 * hardware or networking — that a future verified read-only comms link clears ONLY
 * read/monitor/fault-read commands and keeps every write/destructive/upload/browse
 * command capability-blocked, and that an UNVERIFIED link can never reach a
 * Connected state. A real EtherNet/IP CIP implementation of
 * {@link ReadOnlyControllerComms} must pass this same suite.
 */

/** In-memory fake comms — NO network. Stands in for a vetted CIP reader. */
class FakeReadOnlyComms implements ReadOnlyControllerComms {
  readonly displayName = "Fake Read-only Echo Link";
  opened = false;
  closed = false;
  constructor(readonly capabilities: ReadOnlyCommsCapabilities) {}
  async open() {
    this.opened = true;
    return { ok: true, message: "Read-only link open (fake)." };
  }
  async close() {
    this.closed = true;
  }
  async readIdentity() {
    return { productName: "EmulatedController", controllerMode: "Run" };
  }
  async readTag(path: string) {
    return path === "StartPB" ? true : 0;
  }
  async listTags() {
    return ["StartPB", "SpeedCmd"];
  }
}

const cmd = (kind: keyof typeof CONTROLLER_COMMANDS) => CONTROLLER_COMMANDS[kind];

describe("InjectedReadOnlyControllerTransport — defaults are safe", () => {
  it("ships read-only and unverified by default", () => {
    const t = new InjectedReadOnlyControllerTransport(new FakeReadOnlyComms({ canRead: true }));
    expect(t.kind).toBe("readonly-monitor");
    expect(t.capabilities.realControllerIo).toBe(true);
    expect(t.capabilities.verified).toBe(false); // hard gate stays closed
    expect(t.capabilities.canWrite).toBe(false); // read-only by construction
  });

  it("forces command families outside the monitor-only seam to stay unavailable even if a comms object over-declares them", () => {
    const overDeclared = {
      canRead: true,
      canMonitor: true,
      canUpload: true,
      canBrowseNetwork: true,
      canSelectPath: true,
      canPathDiagnostics: true,
    } as ReadOnlyCommsCapabilities;
    const t = new InjectedReadOnlyControllerTransport(
      new FakeReadOnlyComms(overDeclared),
      { verified: true },
    );
    expect(t.capabilities.canWrite).toBe(false);
    expect(t.capabilities.canUpload).toBe(false);
    expect(t.capabilities.canBrowseNetwork).toBe(false);
    expect(t.capabilities.canSelectPath).toBe(false);
    expect(t.capabilities.canPathDiagnostics).toBe(false);
  });
});

describe("an UNVERIFIED read-only link can never reach Connected", () => {
  it("routes go-online to safety-blocked, never a connected state", async () => {
    const comms = new FakeReadOnlyComms({ canRead: true, canMonitor: true });
    const session = new ControllerSession(new InjectedReadOnlyControllerTransport(comms));
    await session.goOnline();
    expect(session.state).toBe("safety-blocked");
    expect(session.snapshot().connected).toBe(false);
    // Even monitor is blocked, with the honest unverified reason.
    expect(session.evaluate(cmd("monitor")).reason).toBe("safety-unverified");
  });
});

describe("a VERIFIED read-only link clears only reads, blocks everything else", () => {
  // Minimal link: base read capability only. Monitor/fault reads piggyback on
  // canRead; upload/browse/path/write do NOT and must each be opted into.
  const minimalReadCaps: ReadOnlyCommsCapabilities = { canRead: true };

  const connectVerified = async (caps: ReadOnlyCommsCapabilities) => {
    const comms = new FakeReadOnlyComms(caps);
    const session = new ControllerSession(
      new InjectedReadOnlyControllerTransport(comms, { verified: true }),
    );
    await session.goOnline();
    return { session, comms };
  };

  it("reaches a connected read-only state", async () => {
    const { session } = await connectVerified(minimalReadCaps);
    expect(session.snapshot().connected).toBe(true);
    expect(session.state).toBe("connected-readonly");
  });

  it("clears monitor / fault-diagnostics / go-to-faults", async () => {
    const { session } = await connectVerified(minimalReadCaps);
    expect(session.evaluate(cmd("monitor")).available).toBe(true);
    expect(session.evaluate(cmd("fault-diagnostics")).available).toBe(true);
    expect(session.evaluate(cmd("go-to-faults")).available).toBe(true);
  });

  it("keeps every write / destructive / mode command capability-blocked (even confirmed)", async () => {
    const { session } = await connectVerified(minimalReadCaps);
    const blockedWrites = [
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
    ] as const;
    for (const kind of blockedWrites) {
      const a = session.evaluate(cmd(kind), true); // confirmed:true — proves it's capability, not confirmation
      expect(a.available, `${kind} must be blocked`).toBe(false);
      expect(a.reason, `${kind} must be capability-missing`).toBe("capability-missing");
    }
  });

  it("keeps upload / network-browser / select-recent-path / path-diagnostics blocked for the monitor-only seam", async () => {
    const { session } = await connectVerified(minimalReadCaps);
    for (const kind of ["upload", "network-browser", "select-recent-path", "path-diagnostics"] as const) {
      const a = session.evaluate(cmd(kind), true);
      expect(a.available, `${kind} must be blocked`).toBe(false);
      expect(a.reason, `${kind} must be capability-missing`).toBe("capability-missing");
    }
  });

  it("honors explicit monitor/fault-read opt-ins while upload/browse/path and writes stay blocked", async () => {
    const { session } = await connectVerified({ canRead: true, canMonitor: true, canReadFaults: true });
    expect(session.state).toBe("connected-monitor");
    expect(session.evaluate(cmd("monitor")).available).toBe(true);
    expect(session.evaluate(cmd("fault-diagnostics")).available).toBe(true);
    for (const kind of ["upload", "network-browser", "select-recent-path", "path-diagnostics"] as const) {
      expect(session.evaluate(cmd(kind), true).reason).toBe("capability-missing");
    }
    // download is a write — it never clears from a monitor-only link.
    expect(session.evaluate(cmd("download"), true).reason).toBe("capability-missing");
  });
});

describe("transport lifecycle delegates to the injected comms", () => {
  it("connect opens and disconnect closes the comms link", async () => {
    const comms = new FakeReadOnlyComms({ canRead: true });
    const transport = new InjectedReadOnlyControllerTransport(comms, { verified: true });
    await transport.connect();
    expect(comms.opened).toBe(true);
    await transport.disconnect();
    expect(comms.closed).toBe(true);
  });

  it("surfaces an unopenable link as Controller Link Unavailable, not Connected", async () => {
    const failing: ReadOnlyControllerComms = {
      displayName: "Unreachable Link",
      capabilities: { canRead: true },
      async open() {
        return { ok: false, message: "Echo controller not reachable." };
      },
      async close() {},
    };
    const session = new ControllerSession(
      new InjectedReadOnlyControllerTransport(failing, { verified: true }),
    );
    await session.goOnline();
    expect(session.snapshot().connected).toBe(false);
    expect(session.state).toBe("connected-unavailable");
  });
});
