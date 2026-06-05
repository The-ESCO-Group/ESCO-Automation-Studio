import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTROLLER_COMMAND_LIST,
  CONTROLLER_COMMANDS,
  ControllerSession,
  OfflineSimulationTransport,
  UnavailableTransport,
  type CommandResult,
  type CommandRisk,
  type ConnectionAuditEvent,
  type ControllerCommand,
  type ControllerCommandKind,
  type PreflightReport,
  type SessionSnapshot,
} from "@esco/controller-comm";

export type ControllerCommunicationAction =
  | ControllerCommandKind
  | "go-online-simulation";

export interface ControllerCommunicationActionResult {
  kind: "info" | "success" | "warning" | "error";
  message: string;
  snapshot: SessionSnapshot;
  audit?: ConnectionAuditEvent;
}

export interface ControllerSessionApi {
  snapshot: SessionSnapshot;
  audit: ConnectionAuditEvent[];
  /** Availability of each guarded command, for rendering enabled/disabled buttons. */
  commands: {
    command: ControllerCommand;
    blocked: boolean;
    explanation: string;
    risk: CommandRisk;
    nextStep: string;
    /** Enumerated commissioning preflight: every safety gate and its pass/fail. */
    preflight: PreflightReport;
  }[];
  goOnlineSimulation: () => Promise<SessionSnapshot>;
  requestRealReadonly: () => Promise<SessionSnapshot>;
  goOffline: () => Promise<SessionSnapshot>;
  monitor: () => void;
  runCommand: (command: ControllerCommand) => CommandResult;
  runCommunicationAction: (action: ControllerCommunicationAction) => Promise<ControllerCommunicationActionResult>;
}

const GUARDED = CONTROLLER_COMMAND_LIST;
const NO_TESTED_TRANSPORT =
  "No tested controller transport is configured. Hardware Go Online is unavailable.";

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

  const latestAudit = useCallback(
    () => session.auditLog[session.auditLog.length - 1],
    [session],
  );

  const goOnlineSimulation = useCallback(async () => {
    session.selectTransport(new OfflineSimulationTransport());
    const next = await session.goOnline();
    sync();
    return next;
  }, [session, sync]);

  const requestRealReadonly = useCallback(async () => {
    session.selectTransport(new UnavailableTransport(NO_TESTED_TRANSPORT));
    const next = await session.goOnline();
    sync();
    return next;
  }, [session, sync]);

  const goOffline = useCallback(async () => {
    session.selectTransport(new OfflineSimulationTransport());
    const next = await session.goOffline();
    sync();
    return next;
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

  const runCommunicationAction = useCallback(
    async (action: ControllerCommunicationAction): Promise<ControllerCommunicationActionResult> => {
      if (action === "go-online-simulation") {
        const next = await goOnlineSimulation();
        return {
          kind: "success",
          message: "Offline Simulation is active. No controller connection was attempted.",
          snapshot: next,
          audit: latestAudit(),
        };
      }

      if (action === "go-offline") {
        const next = await goOffline();
        return {
          kind: "info",
          message: "Offline Simulation is active.",
          snapshot: next,
          audit: latestAudit(),
        };
      }

      if (action === "go-online") {
        await requestRealReadonly();
      }

      const command = CONTROLLER_COMMANDS[action];
      const result = session.runCommand(command, { confirmed: true });
      sync();

      if (result.outcome === "blocked") {
        return {
          kind: "warning",
          message: `${command.label} is blocked: ${result.message}`,
          snapshot: session.snapshot(),
          audit: result.audit,
        };
      }

      return {
        kind: "success",
        message: result.message,
        snapshot: session.snapshot(),
        audit: result.audit,
      };
    },
    [goOffline, goOnlineSimulation, latestAudit, requestRealReadonly, session, sync],
  );

  const commands = GUARDED.map((command) => {
    const availability = session.evaluate(command, true);
    return {
      command,
      blocked: availability.blocked,
      explanation: availability.explanation,
      risk: availability.risk,
      nextStep: availability.nextStep,
      preflight: session.preflight(command, true),
    };
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
    runCommunicationAction,
  };
}
