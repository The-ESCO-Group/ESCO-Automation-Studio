import { useCallback, useEffect, useRef, useState } from "react";
import {
  ControllerSession,
  DOWNLOAD_COMMAND,
  GO_ONLINE_COMMAND,
  ONLINE_EDIT_COMMAND,
  OfflineSimulationTransport,
  UPLOAD_COMMAND,
  UnavailableTransport,
  type CommandResult,
  type ConnectionAuditEvent,
  type ControllerCommand,
  type SessionSnapshot,
} from "@esco/controller-comm";

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

const GUARDED = [GO_ONLINE_COMMAND, UPLOAD_COMMAND, DOWNLOAD_COMMAND, ONLINE_EDIT_COMMAND];

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
    session.selectTransport(
      new UnavailableTransport("No tested controller transport is configured. Hardware Go Online is unavailable."),
    );
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
