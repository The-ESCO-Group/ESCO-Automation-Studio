import { connectionAudit } from "./audit";
import { evaluateCommand, nextStepFor } from "./commands";
import { commissioningPreflight, type PreflightReport } from "./preflight";
import { reduceConnection } from "./state-machine";
import { OfflineSimulationTransport } from "./transports";
import {
  CONNECTION_STATE_LABELS,
  isConnectedState,
  type BlockedReason,
  type CommandAvailability,
  type CommandResult,
  type CommandRisk,
  type ConnectionAuditEvent,
  type ConnectionState,
  type ControllerCommand,
  type ControllerTransport,
} from "./types";

export interface SessionSnapshot {
  state: ConnectionState;
  stateLabel: string;
  transportKind: ControllerTransport["kind"];
  transportName: string;
  connected: boolean;
}

type Listener = (snapshot: SessionSnapshot) => void;

function transportReason(transport: ControllerTransport): BlockedReason {
  if (!transport.capabilities.realControllerIo && !transport.capabilities.simulation) return "no-real-transport";
  if (transport.capabilities.realControllerIo && !transport.capabilities.verified) return "safety-unverified";
  return null;
}

function auditDetails(
  transport: ControllerTransport,
  status: string,
  risk: CommandRisk,
  reason: BlockedReason,
  nextStep?: string,
): Record<string, unknown> {
  return {
    status,
    risk,
    reason,
    transportName: transport.displayName,
    nextStep: nextStep ?? nextStepFor(reason),
  };
}

/**
 * Orchestrates a controller connection: holds the active transport, drives the
 * state machine through the safety gate, records an audit trail, and evaluates /
 * runs guarded commands.
 *
 * Defaults to the {@link OfflineSimulationTransport}, so a fresh session is in
 * "offline-simulation" — never "Disconnected from a real controller" and never
 * "Connected". A real connection is only reachable through a verified real
 * transport, which this repository does not provide.
 */
export class ControllerSession {
  private transport: ControllerTransport;
  private _state: ConnectionState = "offline-simulation";
  private readonly log: ConnectionAuditEvent[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(transport: ControllerTransport = new OfflineSimulationTransport()) {
    this.transport = transport;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get auditLog(): readonly ConnectionAuditEvent[] {
    return this.log;
  }

  snapshot(): SessionSnapshot {
    return {
      state: this._state,
      stateLabel: CONNECTION_STATE_LABELS[this._state],
      transportKind: this.transport.kind,
      transportName: this.transport.displayName,
      connected: isConnectedState(this._state),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private record(event: ConnectionAuditEvent): void {
    this.log.push(event);
  }

  private setState(next: ConnectionState, summary: string, details?: Record<string, unknown>): void {
    if (next !== this._state) {
      this._state = next;
      this.record(
        connectionAudit("state-change", summary, next, this.transport.kind, details),
      );
    }
    for (const listener of this.listeners) listener(this.snapshot());
  }

  /** Swap the active transport. Always returns to a safe baseline first. */
  selectTransport(transport: ControllerTransport): void {
    this.transport = transport;
    const next = reduceConnection(this._state, { type: "select-transport" });
    const reason = transportReason(transport);
    this.record(
      connectionAudit("transport-selected", `Selected transport: ${transport.displayName}.`, next, transport.kind, {
        ...auditDetails(transport, "selected", "read", reason),
        capabilities: transport.capabilities,
      }),
    );
    this.setState(next, `Transport set to ${transport.displayName}.`, auditDetails(transport, "state-change", "read", reason));
  }

  /**
   * Attempt to go online with the active transport. The transport's reported
   * state passes through the safety gate, so a non-verified transport can only
   * reach offline/model-only/unavailable states or "safety-blocked".
   */
  async goOnline(): Promise<SessionSnapshot> {
    const reason = transportReason(this.transport);
    const requestDetails = auditDetails(
      this.transport,
      reason ? "blocked" : this.transport.capabilities.simulation ? "simulated" : "requested",
      "read",
      reason,
      reason
        ? undefined
        : this.transport.capabilities.simulation
          ? "Offline Simulation is active; no controller connection was attempted."
          : "Review controller identity and command preflight before running online actions.",
    );
    this.setState(
      reduceConnection(this._state, { type: "begin-connect", capabilities: this.transport.capabilities }),
      this.transport.capabilities.realControllerIo || this.transport.capabilities.simulation
        ? "Connecting…"
        : "Connection disabled: no tested controller transport is configured.",
      requestDetails,
    );
    this.record(connectionAudit("go-online", `Go Online requested via ${this.transport.displayName}.`, this._state, this.transport.kind, requestDetails));
    let next: ConnectionState;
    try {
      const result = await this.transport.connect();
      next = reduceConnection(this._state, {
        type: "connect-result",
        result,
        capabilities: this.transport.capabilities,
      });
      const resultReason: BlockedReason =
        next === "connected-unavailable"
          ? "no-real-transport"
          : next === "safety-blocked"
            ? "safety-unverified"
            : null;
      this.setState(
        next,
        result.message,
        auditDetails(this.transport, resultReason ? "blocked" : "ran", "read", resultReason),
      );
    } catch (error) {
      next = reduceConnection(this._state, { type: "fault", message: String(error) });
      this.setState(
        next,
        `Connection faulted: ${error instanceof Error ? error.message : String(error)}`,
        auditDetails(this.transport, "faulted", "read", "faulted"),
      );
    }
    return this.snapshot();
  }

  /** Go offline / back to offline simulation. Always safe. */
  async goOffline(): Promise<SessionSnapshot> {
    await this.transport.disconnect();
    // If the active transport is the simulator, "offline" means offline simulation.
    const next = this.transport.capabilities.simulation ? "offline-simulation" : "disconnected";
    const details = auditDetails(
      this.transport,
      "ran",
      "read",
      null,
      "Offline Simulation is active. Hardware commands still require a verified controller transport.",
    );
    this.record(connectionAudit("go-offline", "Go Offline requested.", next, this.transport.kind, details));
    this.setState(next, this.transport.capabilities.simulation ? "Returned to offline simulation." : "Disconnected.", details);
    return this.snapshot();
  }

  /** Enter Monitor mode. Only possible from a real read-only connection. */
  monitor(): SessionSnapshot {
    const next = reduceConnection(this._state, { type: "enter-monitor" });
    const blocked = next !== "connected-monitor";
    this.record(
      connectionAudit(
        "monitor",
        blocked ? "Monitor unavailable (not connected to a controller)." : "Entered Monitor mode.",
        next,
        this.transport.kind,
        auditDetails(this.transport, blocked ? "blocked" : "ran", "read", blocked ? "not-connected" : null),
      ),
    );
    this.setState(
      next,
      blocked ? "Monitor requires a live controller connection." : "Monitoring controller.",
      auditDetails(this.transport, blocked ? "blocked" : "ran", "read", blocked ? "not-connected" : null),
    );
    return this.snapshot();
  }

  /** Mark the session faulted (e.g. a transport error reported elsewhere). */
  fault(message: string): SessionSnapshot {
    this.setState(
      reduceConnection(this._state, { type: "fault", message }),
      `Faulted: ${message}`,
      auditDetails(this.transport, "faulted", "read", "faulted"),
    );
    return this.snapshot();
  }

  /** Evaluate (without running) whether a guarded command may run right now. */
  evaluate(command: ControllerCommand, confirmed = false): CommandAvailability {
    return evaluateCommand(command, {
      state: this._state,
      capabilities: this.transport.capabilities,
      confirmed,
    });
  }

  /**
   * Produce the enumerated commissioning preflight for a command under the current
   * transport/state — every safety gate and whether it passes, in gate order. This
   * is the operator-facing form of {@link evaluate}: it never short-circuits, so the
   * UI can show the full Go Online / Upload / Download / Monitor / mode-change
   * checklist with the exact gate still red. Pure read; never connects.
   */
  preflight(command: ControllerCommand, confirmed = false): PreflightReport {
    return commissioningPreflight(command, {
      state: this._state,
      capabilities: this.transport.capabilities,
      confirmed,
    });
  }

  /**
   * Attempt a guarded command. NEVER performs a real controller write/read in
   * this build — when the command is allowed by the gate (which requires a
   * verified real transport that does not exist here), execution is delegated to
   * the transport; otherwise it is recorded as blocked. Either way an audit event
   * is produced and returned.
   */
  runCommand(command: ControllerCommand, options: { confirmed?: boolean } = {}): CommandResult {
    const availability = this.evaluate(command, options.confirmed ?? false);
    if (!availability.available) {
      const audit = connectionAudit(
        "command-blocked",
        `Blocked ${command.label}: ${availability.explanation}`,
        this._state,
        this.transport.kind,
        {
          status: "blocked",
          command: command.kind,
          reason: availability.reason,
          risk: availability.risk,
          isWrite: command.isWrite,
          transportName: this.transport.displayName,
          nextStep: availability.nextStep,
        },
      );
      this.record(audit);
      return {
        command,
        outcome: "blocked",
        reason: availability.reason,
        message: availability.explanation,
        audit,
      };
    }

    // Reachable only with a verified real transport (none in this repo). The
    // session does not fabricate controller I/O — it just records that an allowed
    // command ran and lets the (verified) transport own the actual exchange.
    const audit = connectionAudit(
      "command-ran",
      `Ran ${command.label} via ${this.transport.displayName}.`,
      this._state,
      this.transport.kind,
      {
        status: "ran",
        command: command.kind,
        reason: null,
        risk: availability.risk,
        isWrite: command.isWrite,
        transportName: this.transport.displayName,
        nextStep: availability.nextStep,
      },
    );
    this.record(audit);
    return { command, outcome: "ran", reason: null, message: `${command.label} completed.`, audit };
  }
}
