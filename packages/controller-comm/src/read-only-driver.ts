import type {
  ControllerTransport,
  TransportCapabilities,
  TransportConnectResult,
  TransportKind,
} from "./types";

/**
 * READ-ONLY DRIVER SEAM — the safe extension point for a FUTURE verified read-only
 * controller link (e.g. an EtherNet/IP CIP monitor for ControlLogix/CompactLogix).
 *
 * SAFETY — read before changing anything here.
 *
 * This file contains NO networking, NO sockets, NO controller IP hosts, and NO
 * CIP/protocol code. It ships NO verified instance. It defines only:
 *   1. the INTERFACE a separately-implemented, separately-audited read-only comms
 *      stack must satisfy ({@link ReadOnlyControllerComms}), and
 *   2. a transport that DELEGATES to an injected instance of that interface
 *      ({@link InjectedReadOnlyControllerTransport}).
 *
 * The live protocol implementation lives outside this package. Use ESCO-owned
 * EtherNet/IP/CIP code from @esco/driver-ethernetip and a backend-only transport
 * such as @esco/driver-ethernetip-node, then inject a validated comms instance at
 * construction time.
 *
 * Two structural guarantees keep this honest:
 *   - READ-ONLY BY CONSTRUCTION: the comms interface has no write / download /
 *     online-edit / mode-change method to call, and the transport hard-codes
 *     `canWrite: false`. There is no code path here that can change a controller.
 *   - UNVERIFIED BY DEFAULT: `verified` defaults to false, so the safety gate
 *     (`resolveConnectState` / `evaluateCommand`) routes every connect attempt to
 *     `safety-blocked` until a caller supplies `verified: true` — which must come
 *     ONLY from real hardware-validation evidence, never as a convenience. No
 *     shipped/default construction sets it true, so the shipped-transport guard
 *     stays green.
 */

/**
 * The read capabilities a concrete read-only comms stack DECLARES it actually
 * supports for the first safe online milestone. Anything omitted/false stays
 * capability-blocked at the command gate.
 *
 * This seam is deliberately limited to identity/tag/fault monitoring. It does
 * not expose upload, network browse, path selection, path diagnostics, writes,
 * downloads, online edits, mode changes, or forces. Those require separate
 * designs, legal review, hardware validation, and their own conformance suites.
 */
export interface ReadOnlyCommsCapabilities {
  /** Can read a single tag value. The base read capability. */
  canRead: boolean;
  /** Can stream/poll live tag values for a Monitor view. */
  canMonitor?: boolean;
  /** Can read controller fault/status diagnostics. */
  canReadFaults?: boolean;
}

/** Controller identity a read-only stack may return (all optional). */
export interface ReadOnlyControllerIdentity {
  vendor?: string;
  productName?: string;
  catalogNumber?: string;
  revision?: string;
  serialNumber?: string;
  controllerMode?: string;
}

/** Outcome of opening the read-only link. On failure, `message` carries the reason. */
export interface ReadOnlyCommsOpenResult {
  ok: boolean;
  message: string;
}

/**
 * The contract a vetted, read-only controller comms implementation must satisfy.
 * Implement this OUTSIDE this safety-gated package with your EtherNet/IP CIP
 * reader. It is read-only by construction: there is deliberately no write /
 * download / mode-change / online-edit method.
 *
 * Recommended first validation target: ESCO fake-target/loopback coverage for
 * functional proof, followed by signed physical AB controller lab validation.
 */
export interface ReadOnlyControllerComms {
  readonly displayName: string;
  readonly capabilities: ReadOnlyCommsCapabilities;
  /** Open the link (TCP/CIP session, register, forward-open, …). */
  open(): Promise<ReadOnlyCommsOpenResult>;
  /** Tear the link down (forward-close, unregister, …). Always safe to call. */
  close(): Promise<void>;
  /** Read controller identity, if the stack supports it. */
  readIdentity?(): Promise<ReadOnlyControllerIdentity>;
  /** Read a single tag value, if `capabilities.canRead`. */
  readTag?(path: string): Promise<number | boolean | string | undefined>;
  /** Enumerate readable tag names, if the stack supports it. */
  listTags?(): Promise<readonly string[]>;
}

export interface InjectedReadOnlyTransportOptions {
  /**
   * Whether this comms link has been VALIDATED AGAINST TESTED HARDWARE. Defaults
   * to false. Setting it true is the single act that lets the safety gate reach a
   * Connected state and is the meaning of `verified` throughout this package — set
   * it true ONLY from real, signed hardware-validation evidence (emulator
   * validation is NOT sufficient; see docs/controller-readonly-driver.md). No
   * shipped/default construction sets this true.
   */
  verified?: boolean;
}

/**
 * Concrete read-only controller transport that delegates I/O to an injected
 * {@link ReadOnlyControllerComms}. It is the capability-accurate, testable form of
 * the abstract {@link ReadOnlyControllerTransport}: its capabilities mirror exactly
 * what the comms declares, `canWrite` is always false, and `verified` is false
 * unless explicitly supplied. The transport performs NO protocol work itself — it
 * only drives the connection lifecycle through the safety gate.
 */
export class InjectedReadOnlyControllerTransport implements ControllerTransport {
  readonly kind: TransportKind = "readonly-monitor";
  readonly displayName: string;
  readonly capabilities: TransportCapabilities;
  private opened = false;

  constructor(
    private readonly comms: ReadOnlyControllerComms,
    options: InjectedReadOnlyTransportOptions = {},
  ) {
    this.displayName = comms.displayName;
    const declared = comms.capabilities;
    // Mirror only the monitor/fault-read capabilities this seam is allowed to
    // expose. Real upload/browse/path capabilities remain false even if an
    // injected object tries to over-declare them; those are separate products, not
    // a monitor-only link.
    this.capabilities = {
      realControllerIo: true,
      verified: options.verified === true,
      simulation: false,
      canRead: declared.canRead,
      canMonitor: declared.canMonitor,
      canReadFaults: declared.canReadFaults,
      canUpload: false,
      canBrowseNetwork: false,
      canSelectPath: false,
      canPathDiagnostics: false,
      // Read-only by construction. This is never derived from the comms and can
      // never be true here — a write-capable link must be a different transport.
      canWrite: false,
    };
  }

  async connect(): Promise<TransportConnectResult> {
    const result = await this.comms.open();
    if (!result.ok) {
      // The link could not be opened — surface "Controller Link Unavailable".
      return { ok: false, reportedState: "connected-unavailable", message: result.message };
    }
    this.opened = true;
    // Report a read-only / monitor link. The safety gate RE-DERIVES the legal state
    // from capabilities: if `verified` is false, resolveConnectState returns
    // `safety-blocked`, never Connected. This transport cannot talk its way online.
    const reportedState = this.capabilities.canMonitor ? "connected-monitor" : "connected-readonly";
    return { ok: true, reportedState, message: result.message };
  }

  async disconnect(): Promise<void> {
    if (this.opened) {
      await this.comms.close();
      this.opened = false;
    }
  }
}
