import { useCallback, useEffect, useRef, useState } from "react";
import {
  ControllerSession,
  DOWNLOAD_COMMAND,
  ONLINE_EDIT_COMMAND,
  OfflineSimulationTransport,
  ReadOnlyControllerTransport,
  UPLOAD_COMMAND,
  type CommandResult,
  type ConnectionAuditEvent,
  type ControllerCommand,
  type SessionSnapshot,
  type TransportConnectResult,
} from "@esco/controller-comm";

/**
 * A demonstration read-only transport. It models what a real EtherNet/IP read-only
 * link *would* report, but it is deliberately UNVERIFIED (it inherits
 * `verified: false` from {@link ReadOnlyControllerTransport}). Because of the
 * safety gate, attempting to go online with it lands in "Safety Blocked" — never
 * "Connected" — which is exactly the honest behaviour for a build with no tested
 * controller transport.
 */
class DemoReadOnlyTransport extends ReadOnlyControllerTransport {
  readonly displayName = "Read-Only Controller Link (unverified)";
  async connect(): Promise<TransportConnectResult> {
    return {
      ok: true,
      reportedState: "connected-readonly",
      message: "A read-only link was requested, but this transport is not verified against hardware.",
    };
  }
  async disconnect(): Promise<void> {}
}

export interface ControllerSessionApi {
  snapshot: SessionSnapshot;
  audit: ConnectionAuditEvent[];
  /** Availability of each guarded command, for rendering enabled/disabled buttons. */
  commands: { command: ControllerCommand; blocked: boolean; explanation: string }[];
  goOnlineSimulation: () => void;
  requestRealReadonly: () => void;
  goOffline: () => void;
  monitor: () => void;
  runCommand: (command: ControllerCommand) => CommandResult;
}

const GUARDED = [UPLOAD_COMMAND, DOWNLOAD_COMMAND, ONLINE_EDIT_COMMAND];

/**
 * React hook over a single {@link ControllerSession}. The session lives outside
 * React (the comm logic is pure and UI-free); this hook just mirrors its snapshot
 * and audit log into render state. It never fabricates a connection — every state
 * comes from the session's safety gate.
 */
export function useControllerSession(): ControllerSessionApi {
  const sessionRef = useRef<ControllerSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new ControllerSession(new OfflineSimulationTransport());
  }
  const session = sessionRef.current;
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => session.snapshot());
  const [audit, setAudit] = useState<ConnectionAuditEvent[]>(() => session.auditLog.slice());

  const sync = useCallback(() => {
    setSnapshot(session.snapshot());
    setAudit(session.auditLog.slice());
  }, [session]);

  useEffect(() => session.subscribe(() => sync()), [session, sync]);

  const goOnlineSimulation = useCallback(() => {
    session.selectTransport(new OfflineSimulationTransport());
    void session.goOnline().then(sync);
    sync();
  }, [session, sync]);

  const requestRealReadonly = useCallback(() => {
    session.selectTransport(new DemoReadOnlyTransport());
    void session.goOnline().then(sync);
    sync();
  }, [session, sync]);

  const goOffline = useCallback(() => {
    session.selectTransport(new OfflineSimulationTransport());
    void session.goOffline().then(sync);
    sync();
  }, [session, sync]);

  const monitor = useCallback(() => {
    session.monitor();
    sync();
  }, [session, sync]);

  const runCommand = useCallback(
    (command: ControllerCommand): CommandResult => {
      // Destructive/real commands always go through with a confirmation flag set;
      // the session's gate still blocks them because no verified transport exists.
      const result = session.runCommand(command, { confirmed: true });
      sync();
      return result;
    },
    [session, sync],
  );

  const commands = GUARDED.map((command) => {
    const availability = session.evaluate(command, true);
    return { command, blocked: availability.blocked, explanation: availability.explanation };
  });

  return {
    snapshot,
    audit,
    commands,
    goOnlineSimulation,
    requestRealReadonly,
    goOffline,
    monitor,
    runCommand,
  };
}
