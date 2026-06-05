import { CONTROLLER_COMMAND_LIST, evaluateCommand, nextStepFor } from "./commands";
import { ModelOnlyTransport, OfflineSimulationTransport, UnavailableTransport } from "./transports";
import type {
  BlockedReason,
  CommandAvailability,
  ConnectionState,
  ControllerCommand,
  ControllerTransport,
  TransportCapabilities,
  TransportKind,
} from "./types";

export type TransportReadinessStatus =
  | "simulation-ready"
  | "model-only"
  | "blocked"
  | "safety-blocked"
  | "verified-readonly"
  | "verified-readwrite";

export interface TransportReadinessInput {
  kind: TransportKind;
  displayName: string;
  capabilities: TransportCapabilities;
  assumedState?: ConnectionState;
}

export interface TransportReadinessIssue {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface TransportReadinessRow {
  id: string;
  kind: TransportKind;
  displayName: string;
  status: TransportReadinessStatus;
  assumedState: ConnectionState;
  capabilities: TransportCapabilities;
  commandCount: number;
  availableCommandCount: number;
  blockedCommandCount: number;
  realCommandCount: number;
  blockedRealCommandCount: number;
  destructiveAvailableCount: number;
  firstBlocker: BlockedReason;
  blockerCounts: Record<NonNullable<BlockedReason>, number>;
  issues: TransportReadinessIssue[];
  issueCount: number;
  errorCount: number;
  summary: string;
  nextStep: string;
  commandGate: Pick<CommandAvailability, "command" | "available" | "blocked" | "reason" | "risk" | "nextStep">[];
}

export interface TransportReadinessReport {
  rows: TransportReadinessRow[];
  transportCount: number;
  verifiedRealTransportCount: number;
  safetyBlockedTransportCount: number;
  unsupportedTransportCount: number;
  simulationTransportCount: number;
  modelOnlyTransportCount: number;
  realCommandCount: number;
  blockedRealCommandCount: number;
}

const BLOCKED_REASONS: NonNullable<BlockedReason>[] = [
  "model-only",
  "no-real-transport",
  "not-connected",
  "safety-unverified",
  "safety-blocked-state",
  "capability-missing",
  "needs-confirmation",
  "faulted",
];

function readinessInputFromTransport(transport: ControllerTransport, assumedState?: ConnectionState): TransportReadinessInput {
  return {
    kind: transport.kind,
    displayName: transport.displayName,
    capabilities: transport.capabilities,
    ...(assumedState ? { assumedState } : {}),
  };
}

function defaultAssumedState(input: TransportReadinessInput): ConnectionState {
  if (input.assumedState) return input.assumedState;
  if (input.kind === "model-only") return "model-only";
  if (input.capabilities.simulation) return "offline-simulation";
  if (input.capabilities.realControllerIo && !input.capabilities.verified) return "safety-blocked";
  if (input.capabilities.realControllerIo && input.capabilities.verified) {
    return input.capabilities.canRead ? "connected-monitor" : "connected-readonly";
  }
  return "connected-unavailable";
}

function readinessStatus(input: TransportReadinessInput): TransportReadinessStatus {
  if (input.capabilities.realControllerIo && input.capabilities.verified && input.capabilities.canWrite) {
    return "verified-readwrite";
  }
  if (input.capabilities.realControllerIo && input.capabilities.verified) return "verified-readonly";
  if (input.capabilities.realControllerIo && !input.capabilities.verified) return "safety-blocked";
  if (input.kind === "model-only") return "model-only";
  if (input.capabilities.simulation) return "simulation-ready";
  return "blocked";
}

function transportIssues(input: TransportReadinessInput): TransportReadinessIssue[] {
  const issues: TransportReadinessIssue[] = [];
  if (input.capabilities.realControllerIo && !input.capabilities.verified) {
    issues.push({
      code: "unverified-real-transport",
      severity: "error",
      message: "Real controller I/O is declared but the transport is not verified against tested hardware.",
    });
  }
  if (input.capabilities.realControllerIo && input.capabilities.canWrite && !input.capabilities.verified) {
    issues.push({
      code: "unverified-write-capability",
      severity: "error",
      message: "Write-capable real transport remains blocked until the hardware link is verified.",
    });
  }
  if (!input.capabilities.realControllerIo && input.capabilities.verified) {
    issues.push({
      code: "verified-software-only",
      severity: "info",
      message: "Verified capability is local/software only; it is not a physical controller transport.",
    });
  }
  if (!input.capabilities.realControllerIo && !input.capabilities.simulation && input.kind !== "model-only") {
    issues.push({
      code: "no-real-transport",
      severity: "warning",
      message: "No physical controller I/O is available from this transport.",
    });
  }
  return issues;
}

function rowSummary(status: TransportReadinessStatus, input: TransportReadinessInput): string {
  switch (status) {
    case "simulation-ready":
      return "Simulation transport is usable for offline tag reads; real controller commands stay blocked.";
    case "model-only":
      return "Model-only transport preserves imported controller context for review without simulation or hardware I/O.";
    case "safety-blocked":
      return "Real controller I/O is declared, but the transport is blocked until hardware verification is complete.";
    case "verified-readonly":
      return "Verified real transport can clear read/monitor gates; write and destructive commands remain blocked.";
    case "verified-readwrite":
      return "Verified real transport can clear read, write, and destructive command gates after confirmation.";
    case "blocked":
    default:
      return input.capabilities.realControllerIo
        ? "Controller transport is blocked by the safety gate."
        : "No real controller transport is configured for this provider.";
  }
}

function nextStepForStatus(status: TransportReadinessStatus): string {
  if (status === "safety-blocked") return nextStepFor("safety-unverified");
  if (status === "verified-readonly" || status === "verified-readwrite") {
    return "Review command preflight and operator confirmation before online actions.";
  }
  if (status === "model-only") return nextStepFor("model-only");
  return nextStepFor("no-real-transport");
}

export function transportReadinessReport(
  transports: readonly TransportReadinessInput[],
  commands: readonly ControllerCommand[] = CONTROLLER_COMMAND_LIST,
): TransportReadinessReport {
  const realCommandCount = commands.filter((command) => command.requiresRealIo).length;
  const rows = transports.map((input): TransportReadinessRow => {
    const assumedState = defaultAssumedState(input);
    const commandGate = commands.map((command) => {
      const availability = evaluateCommand(command, {
        state: assumedState,
        capabilities: input.capabilities,
        confirmed: true,
      });
      return {
        command,
        available: availability.available,
        blocked: availability.blocked,
        reason: availability.reason,
        risk: availability.risk,
        nextStep: availability.nextStep,
      };
    });
    const blockerCounts = Object.fromEntries(BLOCKED_REASONS.map((reason) => [reason, 0])) as Record<
      NonNullable<BlockedReason>,
      number
    >;
    for (const gate of commandGate) {
      if (gate.reason) blockerCounts[gate.reason] += 1;
    }
    const firstBlocker = commandGate.find((gate) => gate.reason)?.reason ?? null;
    const status = readinessStatus(input);
    const issues = transportIssues(input);
    const availableCommandCount = commandGate.filter((gate) => gate.available).length;
    const blockedRealCommandCount = commandGate.filter(
      (gate) => gate.command.requiresRealIo && gate.blocked,
    ).length;
    return {
      id: `${input.kind}:${input.displayName}`,
      kind: input.kind,
      displayName: input.displayName,
      status,
      assumedState,
      capabilities: input.capabilities,
      commandCount: commands.length,
      availableCommandCount,
      blockedCommandCount: commandGate.length - availableCommandCount,
      realCommandCount,
      blockedRealCommandCount,
      destructiveAvailableCount: commandGate.filter((gate) => gate.risk === "destructive" && gate.available).length,
      firstBlocker,
      blockerCounts,
      issues,
      issueCount: issues.length,
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      summary: rowSummary(status, input),
      nextStep: nextStepForStatus(status),
      commandGate,
    };
  });

  return {
    rows,
    transportCount: rows.length,
    verifiedRealTransportCount: rows.filter(
      (row) => row.capabilities.realControllerIo && row.capabilities.verified,
    ).length,
    safetyBlockedTransportCount: rows.filter((row) => row.status === "safety-blocked").length,
    unsupportedTransportCount: rows.filter((row) => row.status === "blocked").length,
    simulationTransportCount: rows.filter((row) => row.status === "simulation-ready").length,
    modelOnlyTransportCount: rows.filter((row) => row.status === "model-only").length,
    realCommandCount,
    blockedRealCommandCount: rows.reduce((total, row) => total + row.blockedRealCommandCount, 0),
  };
}

export function shippedTransportReadinessReport(): TransportReadinessReport {
  return transportReadinessReport([
    readinessInputFromTransport(new OfflineSimulationTransport(), "offline-simulation"),
    readinessInputFromTransport(new ModelOnlyTransport(), "model-only"),
    readinessInputFromTransport(new UnavailableTransport(), "connected-unavailable"),
  ]);
}
