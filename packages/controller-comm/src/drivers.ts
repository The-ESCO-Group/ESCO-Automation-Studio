import type { TransportCapabilities } from "./types";

/**
 * Driver / readiness model — the descriptive layer on top of the safety gate.
 *
 * `types.ts`/`state-machine.ts` decide the LIVE session state (the safety gate),
 * and they never grant a real "Connected" without a verified real transport. This
 * module is the complementary *descriptive* layer: it says, for a given transport
 * or future driver, **how close to a real controller link it could ever get** and
 * **what is still missing**. It introduces no new way to reach hardware — a
 * descriptor with `verified: false` can never report `ready`, exactly like the
 * gate refuses a non-verified Connected state.
 *
 * It exists so the foundation is honest about the *shape* of a future EtherNet/IP
 * (CIP) driver — protocol, controller families, the access grant it would need,
 * and the hardware-validation (audit) it must pass — without shipping one.
 */

/** The wire protocol a driver speaks. Sentinels (`none`/`offline-sim`) are not real links. */
export type ProtocolKind =
  | "none" // no controller protocol (model-only / unconfigured)
  | "offline-sim" // in-app simulator; no wire protocol, never touches hardware
  | "ethernet-ip-cip"; // EtherNet/IP + CIP — the real Logix path (no audited impl ships)

/** Controller families a real driver could target. Empty for non-real drivers. */
export type ControllerFamily =
  | "ControlLogix"
  | "CompactLogix"
  | "GuardLogix"
  | "Micro800"
  | "unknown";

/**
 * The explicit readiness states the foundation surfaces, ordered loosely from
 * "safe and working" to "could be real once everything is satisfied":
 *
 * - `offline-simulation` — the safe default; simulation only, never a controller.
 * - `unconfigured`        — no real transport/driver is configured (the ship state).
 * - `hardware-unavailable`— a real driver exists but no device/route was found.
 * - `permission-required` — reachable + verified, but operator access isn't granted.
 * - `audit-required`      — a real driver that has NOT been validated against tested
 *                           hardware (the hard safety gate; `verified: false`).
 * - `unsupported`         — the controller family/protocol has no driver.
 * - `ready`               — verified + permitted: a real link is allowable. No
 *                           shipped driver reaches this, by design.
 */
export type TransportReadiness =
  | "offline-simulation"
  | "unconfigured"
  | "hardware-unavailable"
  | "permission-required"
  | "audit-required"
  | "unsupported"
  | "ready";

export const TRANSPORT_READINESS_LABELS: Record<TransportReadiness, string> = {
  "offline-simulation": "Offline Simulation",
  unconfigured: "Unconfigured",
  "hardware-unavailable": "Hardware Unavailable",
  "permission-required": "Permission Required",
  "audit-required": "Audit Required",
  unsupported: "Unsupported",
  ready: "Ready",
};

/** Human-readable, honest explanation for each readiness state. */
export const TRANSPORT_READINESS_EXPLAIN: Record<TransportReadiness, string> = {
  "offline-simulation":
    "Offline simulation is active. Logic runs against the in-app simulator and never contacts a controller.",
  unconfigured:
    "No tested controller transport is configured. Real go-online/upload/download/online-edit is unavailable in this build.",
  "hardware-unavailable":
    "A controller driver is selected but no reachable device or route was found.",
  "permission-required":
    "The controller is reachable and the link is verified, but the required operator access (keyswitch / access level) has not been granted.",
  "audit-required":
    "This driver's controller link has not been validated against tested hardware. It is blocked for safety until audited.",
  unsupported: "No driver supports the requested controller family or protocol.",
  ready: "A verified, permitted controller link is available.",
};

/**
 * A declarative description of a controller driver. Concrete transports
 * ({@link ControllerTransport}) own behaviour; a descriptor describes *what a
 * driver is and requires* so the UI and tests can reason about it without
 * instantiating a live link. `requiresAudit`/`verified` are the honesty hooks:
 * any real driver ships with `verified: false` and must stay that way until its
 * link is validated against tested hardware.
 */
export interface DriverDescriptor {
  /** Stable id, e.g. "offline-sim", "ethernet-ip-cip". */
  id: string;
  displayName: string;
  protocol: ProtocolKind;
  /** Controller families this driver targets (empty for non-real drivers). */
  families: ControllerFamily[];
  /** The capability profile the driver publishes. Mirrors the transport's. */
  capabilities: TransportCapabilities;
  /** Does using this driver require an explicit operator access grant (keyswitch / access level)? */
  requiresPermission: boolean;
  /** Must the driver's link be validated against tested hardware before any real I/O? */
  requiresAudit: boolean;
  /** One-line honest note about the driver's status. */
  note: string;
}

/** Descriptor for the default offline simulation transport. */
export const OFFLINE_SIM_DRIVER: DriverDescriptor = {
  id: "offline-sim",
  displayName: "Offline Simulation",
  protocol: "offline-sim",
  families: [],
  capabilities: { realControllerIo: false, verified: false, simulation: true, canRead: true, canWrite: false },
  requiresPermission: false,
  requiresAudit: false,
  note: "In-app simulation. Never contacts a controller.",
};

/** Descriptor for the "no tested transport configured" transport. */
export const UNAVAILABLE_DRIVER: DriverDescriptor = {
  id: "unavailable",
  displayName: "No Controller Transport",
  protocol: "none",
  families: [],
  capabilities: { realControllerIo: false, verified: false, simulation: false, canRead: false, canWrite: false },
  requiresPermission: false,
  requiresAudit: false,
  note: "No tested controller transport is configured in this build.",
};

/** Descriptor for the model-only review transport (preserved model, no live link). */
export const MODEL_ONLY_DRIVER: DriverDescriptor = {
  id: "model-only",
  displayName: "Model-only Review",
  protocol: "none",
  families: [],
  capabilities: { realControllerIo: false, verified: false, simulation: false, canRead: false, canWrite: false },
  requiresPermission: false,
  requiresAudit: false,
  note: "Imported model preserved for review. Not simulated and not connected.",
};

/**
 * SPECIFICATION ONLY — the shape a real EtherNet/IP (CIP) driver must declare.
 *
 * This is data, not an instantiable transport: there is no audited implementation
 * in this repository. It declares `realControllerIo: true` (a CIP driver would
 * exchange data with hardware) but `verified: false` and `requiresAudit: true`, so
 * {@link describeReadiness} maps it to `audit-required` and the safety gate would
 * route any connect attempt to `safety-blocked`. A genuine driver must implement
 * {@link RealControllerTransport}, pass hardware validation, and only then publish
 * `verified: true`.
 */
export const ETHERNET_IP_CIP_DRIVER: DriverDescriptor = {
  id: "ethernet-ip-cip",
  displayName: "EtherNet/IP (CIP) — specification only",
  protocol: "ethernet-ip-cip",
  families: ["ControlLogix", "CompactLogix", "GuardLogix"],
  capabilities: {
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
  },
  requiresPermission: true,
  requiresAudit: true,
  note: "Specification only. No audited implementation ships; verified must stay false until validated against tested hardware.",
};

/**
 * The drivers actually wired to shipped transports. Every entry MUST have
 * `verified: false` (a guard test enforces this). The CIP descriptor is
 * deliberately NOT here — it is a spec, listed in {@link DRIVER_CATALOG}.
 */
export const SHIPPED_DRIVERS: readonly DriverDescriptor[] = [
  OFFLINE_SIM_DRIVER,
  UNAVAILABLE_DRIVER,
  MODEL_ONLY_DRIVER,
];

/** Everything the foundation knows about, shipped or specified (for UI/discovery). */
export const DRIVER_CATALOG: readonly DriverDescriptor[] = [
  ...SHIPPED_DRIVERS,
  ETHERNET_IP_CIP_DRIVER,
];

/** Runtime facts that refine readiness for a real driver. All optional/honest-defaulting. */
export interface ReadinessContext {
  /** Has the operator's access (keyswitch / access level) been granted for this driver? */
  permissionGranted?: boolean;
  /** Is the requested controller family/protocol supported? Defaults to true. */
  supported?: boolean;
  /** Did a real link attempt find a reachable device/route? Defaults to true (untested). */
  hardwarePresent?: boolean;
}

type ReadinessDriver = Pick<DriverDescriptor, "requiresPermission" | "requiresAudit">;

/**
 * Map a transport's capabilities (and optional driver descriptor + runtime facts)
 * to one explicit {@link TransportReadiness}. Pure and honest:
 *
 *   - simulation                      → `offline-simulation`
 *   - no real I/O, not simulation     → `unconfigured`
 *   - real I/O, unsupported family    → `unsupported`
 *   - real I/O, no device/route       → `hardware-unavailable`
 *   - real I/O, not verified          → `audit-required`   (the hard gate)
 *   - real I/O, verified, no access   → `permission-required`
 *   - real I/O, verified, access ok   → `ready`
 *
 * `ready` is reachable ONLY with `verified: true`, which mirrors the safety gate.
 */
export function describeReadiness(
  capabilities: TransportCapabilities,
  driver?: ReadinessDriver | null,
  ctx: ReadinessContext = {},
): TransportReadiness {
  if (capabilities.simulation) return "offline-simulation";
  if (!capabilities.realControllerIo) return "unconfigured";

  // From here the transport claims real controller I/O.
  if (ctx.supported === false) return "unsupported";
  if (ctx.hardwarePresent === false) return "hardware-unavailable";

  // The hard safety gate: a real driver must be validated against tested hardware.
  if (!capabilities.verified) return "audit-required";

  const requiresPermission = driver?.requiresPermission ?? true;
  if (requiresPermission && ctx.permissionGranted !== true) return "permission-required";

  return "ready";
}

/** Convenience: readiness for a descriptor (uses its own capabilities + requirements). */
export function describeDriverReadiness(
  driver: DriverDescriptor,
  ctx: ReadinessContext = {},
): TransportReadiness {
  return describeReadiness(driver.capabilities, driver, ctx);
}
