import type {
  ControllerTransport,
  TransportCapabilities,
  TransportConnectResult,
  TransportKind,
} from "./types";

/**
 * The transports shipped with ESCO Automation Studio. None of them communicates
 * with a real controller — that is by design (see types.ts safety model). They
 * exist so the connection UI, state machine, and command guards have something
 * concrete to drive while staying honest about the absence of a tested link.
 */

/**
 * Offline simulation transport — the default. It "connects" instantly to the
 * in-app simulator, never touches hardware, and reports `offline-simulation`. It
 * may expose simulated reads via a value supplier, but it is NEVER verified, so
 * it can never satisfy the real-I/O safety gate.
 */
export class OfflineSimulationTransport implements ControllerTransport {
  readonly kind: TransportKind = "offline-sim";
  readonly displayName = "Offline Simulation";
  readonly capabilities: TransportCapabilities = {
    realControllerIo: false,
    verified: false,
    simulation: true,
    canRead: true,
    canWrite: false,
  };

  constructor(private readonly readValue?: (path: string) => number | boolean | undefined) {}

  async connect(): Promise<TransportConnectResult> {
    return {
      ok: true,
      reportedState: "offline-simulation",
      message: "Offline simulation active. No controller is connected.",
    };
  }

  async disconnect(): Promise<void> {
    /* nothing to tear down */
  }

  readTag(path: string): number | boolean | undefined {
    return this.readValue?.(path);
  }
}

/**
 * The "no real transport" transport. Selected when the user asks to go online but
 * no tested controller link is configured. It refuses to connect and reports
 * `disconnected` with a clear message. This is what every real upload/download
 * attempt ultimately hits in this build.
 */
export class UnavailableTransport implements ControllerTransport {
  readonly kind: TransportKind = "unavailable";
  readonly displayName = "No Controller Transport";
  readonly capabilities: TransportCapabilities = {
    realControllerIo: false,
    verified: false,
    simulation: false,
    canRead: false,
    canWrite: false,
  };

  constructor(private readonly note = "No tested controller transport is configured in this build.") {}

  async connect(): Promise<TransportConnectResult> {
    return { ok: false, reportedState: "connected-unavailable", message: this.note };
  }

  async disconnect(): Promise<void> {
    /* nothing to tear down */
  }
}

/**
 * Model-only transport — used when imported hardware/device state is preserved
 * for review but cannot be simulated or contacted. It is distinct from Offline
 * Simulation: the project model is visible, but there is no executable scan and
 * no controller communication.
 */
export class ModelOnlyTransport implements ControllerTransport {
  readonly kind: TransportKind = "model-only";
  readonly displayName = "Model-only Review";
  readonly capabilities: TransportCapabilities = {
    realControllerIo: false,
    verified: false,
    simulation: false,
    canRead: false,
    canWrite: false,
  };

  constructor(private readonly note = "Model-only content is preserved for review and is not simulated.") {}

  async connect(): Promise<TransportConnectResult> {
    return { ok: false, reportedState: "model-only", message: this.note };
  }

  async disconnect(): Promise<void> {
    /* nothing to tear down */
  }
}

/**
 * Abstract base for a REAL read-only controller transport (the "read-only
 * transport abstraction"). A genuine implementation would open an EtherNet/IP
 * (CIP) session, read the controller's tag image, and stream values for the
 * Monitor view. It declares `realControllerIo: true`, but `verified` defaults to
 * false: a subclass must override `verified` to true ONLY after its link has been
 * validated against tested hardware. Until then the safety gate routes every
 * connect attempt to `safety-blocked`, and writes are impossible (`canWrite`
 * false).
 *
 * No concrete subclass exists in this repository, so no real connection is
 * reachable.
 */
export abstract class ReadOnlyControllerTransport implements ControllerTransport {
  readonly kind: TransportKind = "readonly-monitor";
  abstract readonly displayName: string;
  readonly capabilities: TransportCapabilities = {
    realControllerIo: true,
    verified: false,
    simulation: false,
    canRead: true,
    canMonitor: true,
    canReadFaults: true,
    canWrite: false,
  };

  abstract connect(): Promise<TransportConnectResult>;
  abstract disconnect(): Promise<void>;
}

/**
 * Abstract base for a full real-controller transport (read + the *capability* to
 * write). Same rules as the read-only base, but with `canWrite: true`. Capability
 * is NOT permission: even a verified write transport still requires explicit
 * confirmation per command, and an unverified one is `safety-blocked`. No
 * concrete subclass exists in this repository.
 */
export abstract class RealControllerTransport implements ControllerTransport {
  readonly kind: TransportKind = "real-controller";
  abstract readonly displayName: string;
  readonly capabilities: TransportCapabilities = {
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

  abstract connect(): Promise<TransportConnectResult>;
  abstract disconnect(): Promise<void>;
}
