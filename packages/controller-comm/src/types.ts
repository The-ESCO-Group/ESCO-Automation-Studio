/**
 * Controller-communication contracts.
 *
 * SAFETY MODEL — read before changing anything here.
 *
 * ESCO Automation Studio is offline-first. It ships with NO tested transport to a
 * real Logix controller, and this package must never pretend otherwise. The whole
 * type system below is built around a single invariant:
 *
 *   A session can only enter a "Connected" state, and a real upload / download /
 *   online-edit command can only run, when the active transport reports BOTH
 *   `realControllerIo: true` AND `verified: true`.
 *
 * The offline simulation transport and the "unavailable" transport both report
 * `verified: false`, so they can never satisfy that gate. Real transports must be
 * implemented against a genuine, tested communication stack and flip `verified`
 * to true only after hardware validation — which is out of scope for this repo.
 */

/** The connection state surfaced to the UI status bar / controller panel. */
export type ConnectionState =
  | "offline-simulation"
  | "model-only"
  | "disconnected"
  | "connecting-disabled"
  | "connecting"
  | "connected-unavailable"
  | "connected-readonly"
  | "connected-monitor"
  | "faulted"
  | "safety-blocked";

/** Human-readable label for each connection state (matches the UI badges). */
export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  "offline-simulation": "Offline Simulation",
  "model-only": "Model-only Review",
  disconnected: "Disconnected",
  "connecting-disabled": "Connection Disabled",
  connecting: "Connecting…",
  "connected-unavailable": "Controller Link Unavailable",
  "connected-readonly": "Connected — Read Only",
  "connected-monitor": "Connected — Monitor",
  faulted: "Faulted",
  "safety-blocked": "Safety Blocked",
};

/** True for states that represent a live link to a real controller. */
export function isConnectedState(state: ConnectionState): boolean {
  return state === "connected-readonly" || state === "connected-monitor";
}

/** What a transport is permitted to do. The gate for everything real. */
export interface TransportCapabilities {
  /**
   * Can this transport exchange data with a REAL controller? Offline transports
   * are always false.
   */
  realControllerIo: boolean;
  /**
   * Has this transport's real-controller path been validated against tested
   * hardware? This is the hard gate for any state change to "Connected" and for
   * any upload/download/online-edit. No transport in this repo sets it true.
   */
  verified: boolean;
  /** Can this transport drive an offline simulation (the sim transport). */
  simulation: boolean;
  /** Can this transport read live tag values (real reads, or simulated reads). */
  canRead: boolean;
  /** Can this transport browse a real controller network/path tree. */
  canBrowseNetwork?: boolean;
  /** Can this transport select or reuse a real controller communication path. */
  canSelectPath?: boolean;
  /** Can this transport inspect real path/route diagnostics. */
  canPathDiagnostics?: boolean;
  /** Can this transport upload/read a controller project image. */
  canUpload?: boolean;
  /** Can this transport monitor live controller tag values. */
  canMonitor?: boolean;
  /** Can this transport read live fault/status diagnostics. */
  canReadFaults?: boolean;
  /**
   * Can this transport write to a controller? Even when true, writes still
   * require `verified` and explicit confirmation — capability alone is not
   * permission.
   */
  canWrite: boolean;
}

export type TransportKind =
  | "offline-sim"
  | "model-only"
  | "readonly-monitor"
  | "real-controller"
  | "unavailable";

/** The outcome a transport reports from a connect attempt. */
export interface TransportConnectResult {
  /** Did the transport establish whatever link it represents? */
  ok: boolean;
  /**
   * The connection state this transport believes it reached. The session
   * re-validates this against capabilities — a transport cannot talk its way
   * into "Connected" without being verified + real.
   */
  reportedState: ConnectionState;
  /** One-line human-readable detail (shown to the user / logged). */
  message: string;
}

/**
 * A controller transport. Concrete transports own the actual link (or absence of
 * one). The session never trusts a transport's reported state blindly — it always
 * re-derives the legal state from {@link TransportCapabilities}.
 */
export interface ControllerTransport {
  readonly kind: TransportKind;
  readonly displayName: string;
  readonly capabilities: TransportCapabilities;
  /** Attempt to establish the link this transport represents. */
  connect(): Promise<TransportConnectResult>;
  /** Tear down the link. Always safe to call. */
  disconnect(): Promise<void>;
  /**
   * Read a tag value, if `capabilities.canRead`. Implementations that cannot read
   * should leave this undefined; callers must check the capability first.
   */
  readTag?(path: string): number | boolean | undefined;
}

/** A guarded controller command (the actions that can touch a real controller). */
export type ControllerCommandKind =
  | "network-browser"
  | "select-recent-path"
  | "path-diagnostics"
  | "upload"
  | "download"
  | "online-edit"
  | "test-edits"
  | "assemble-edits"
  | "finalize-edits"
  | "cancel-edits"
  | "go-online"
  | "go-offline"
  | "monitor"
  | "program-mode"
  | "run-mode"
  | "remote-program-mode"
  | "remote-run-mode"
  | "test-mode"
  | "lock-controller"
  | "clear-faults"
  | "fault-diagnostics"
  | "go-to-faults";

export interface ControllerCommand {
  kind: ControllerCommandKind;
  label: string;
  description: string;
  /** True when carrying this command out would read from / write to real hardware. */
  requiresRealIo: boolean;
  /** True when this command writes to or changes state on the controller. */
  isWrite: boolean;
  /** True when this command must be explicitly confirmed before running. */
  requiresConfirmation: boolean;
}

/**
 * How dangerous a command is, for UI badging and the audit trail:
 * - `read` — reads from the controller, never changes it (browse, monitor, upload).
 * - `write` — changes controller state but does not overwrite logic (lock, clear faults).
 * - `destructive` — overwrites the running program or live logic / changes run state
 *   (download, online edit, mode changes). Always confirmation-gated.
 */
export type CommandRisk = "read" | "write" | "destructive";

/** Why a command is unavailable. `null` means it is available to run. */
export type BlockedReason =
  | null
  | "model-only"
  | "no-real-transport"
  | "not-connected"
  | "safety-unverified"
  | "safety-blocked-state"
  | "capability-missing"
  | "needs-confirmation"
  | "faulted";

export interface CommandAvailability {
  command: ControllerCommand;
  /** True only when the command can actually run right now. */
  available: boolean;
  /** True when the command is intentionally blocked (visible but disabled). */
  blocked: boolean;
  reason: BlockedReason;
  /** A user-facing explanation of the availability/blocked status. */
  explanation: string;
  /** Read / write / destructive classification of the command, for UI + audit. */
  risk: CommandRisk;
  /**
   * The exact next setup step required to enable this command (when blocked), or a
   * confirmation note (when available). Never a vague "coming soon" — always the
   * concrete action that would unblock it.
   */
  nextStep: string;
}

export type CommandOutcome = "ran" | "blocked";

export interface CommandResult {
  command: ControllerCommand;
  outcome: CommandOutcome;
  reason: BlockedReason;
  message: string;
  /** The audit event recorded for this attempt (always produced). */
  audit: ConnectionAuditEvent;
}

/** An audit record for a connection lifecycle or command event. */
export interface ConnectionAuditEvent {
  id: string;
  at: string;
  type:
    | "transport-selected"
    | "go-online"
    | "go-offline"
    | "monitor"
    | "state-change"
    | "command-blocked"
    | "command-ran";
  summary: string;
  state: ConnectionState;
  transportKind: TransportKind;
  details?: Record<string, unknown>;
}
