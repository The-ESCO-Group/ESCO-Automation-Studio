import {
  DOWNLOAD_COMMAND,
  FAULT_DIAGNOSTICS_COMMAND,
  GO_OFFLINE_COMMAND,
  GO_TO_FAULTS_COMMAND,
  MONITOR_COMMAND,
  PATH_DIAGNOSTICS_COMMAND,
  evaluateCommand,
  nextStepFor,
} from "./commands";
import { CONNECTION_STATE_LABELS, type BlockedReason, type CommandAvailability, type ConnectionState, type TransportCapabilities } from "./types";

export type MonitorStateScenarioId =
  | "offline-simulation"
  | "model-only-review"
  | "future-verified-readonly"
  | "future-faulted-readonly"
  | "unverified-safety-blocked";

export interface MonitorStateScenario {
  id: MonitorStateScenarioId;
  label: string;
  state: ConnectionState;
  capabilities: TransportCapabilities;
  note: string;
}

export interface MonitorStateCommandCell {
  commandKind: CommandAvailability["command"]["kind"];
  label: string;
  available: boolean;
  reason: BlockedReason;
  explanation: string;
}

export interface MonitorStateMatrixRow {
  id: MonitorStateScenarioId;
  label: string;
  state: ConnectionState;
  stateLabel: string;
  note: string;
  realControllerIo: boolean;
  verified: boolean;
  monitorAvailable: boolean;
  faultDiagnosticsAvailable: boolean;
  goOfflineAvailable: boolean;
  downloadBlocked: boolean;
  firstBlocker: BlockedReason;
  blockedReadCount: number;
  availableReadCount: number;
  summary: string;
  nextStep: string;
  cells: MonitorStateCommandCell[];
}

export interface MonitorStateMatrixReport {
  rows: MonitorStateMatrixRow[];
  scenarioCount: number;
  verifiedRealScenarioCount: number;
  faultedScenarioCount: number;
  blockedReadCount: number;
  summary: string;
}

const READ_COMMANDS = [
  GO_OFFLINE_COMMAND,
  MONITOR_COMMAND,
  FAULT_DIAGNOSTICS_COMMAND,
  GO_TO_FAULTS_COMMAND,
  PATH_DIAGNOSTICS_COMMAND,
] as const;

const OFFLINE_SIM_CAPABILITIES: TransportCapabilities = {
  realControllerIo: false,
  verified: false,
  simulation: true,
  canRead: true,
  canWrite: false,
};

const MODEL_ONLY_CAPABILITIES: TransportCapabilities = {
  realControllerIo: false,
  verified: false,
  simulation: false,
  canRead: false,
  canWrite: false,
};

const VERIFIED_READONLY_CAPABILITIES: TransportCapabilities = {
  realControllerIo: true,
  verified: true,
  simulation: false,
  canRead: true,
  canMonitor: true,
  canReadFaults: true,
  canWrite: false,
};

const UNVERIFIED_READONLY_CAPABILITIES: TransportCapabilities = {
  realControllerIo: true,
  verified: false,
  simulation: false,
  canRead: true,
  canWrite: false,
};

export const DEFAULT_MONITOR_STATE_SCENARIOS: readonly MonitorStateScenario[] = [
  {
    id: "offline-simulation",
    label: "Offline simulation",
    state: "offline-simulation",
    capabilities: OFFLINE_SIM_CAPABILITIES,
    note: "Shipped state: local simulation is available, but physical monitor commands stay behind the real-transport gate.",
  },
  {
    id: "model-only-review",
    label: "Model-only review",
    state: "model-only",
    capabilities: MODEL_ONLY_CAPABILITIES,
    note: "Imported/review-only state: commands remain descriptive and blocked.",
  },
  {
    id: "future-verified-readonly",
    label: "Verified read-only harness",
    state: "connected-monitor",
    capabilities: VERIFIED_READONLY_CAPABILITIES,
    note: "Future test-only state: read/monitor gates clear, write/destructive gates remain blocked.",
  },
  {
    id: "future-faulted-readonly",
    label: "Faulted read-only harness",
    state: "faulted",
    capabilities: VERIFIED_READONLY_CAPABILITIES,
    note: "Future test-only state: a faulted session blocks monitor/fault reads until reconnect.",
  },
  {
    id: "unverified-safety-blocked",
    label: "Unverified physical link",
    state: "safety-blocked",
    capabilities: UNVERIFIED_READONLY_CAPABILITIES,
    note: "Future safety-blocked state: real I/O is declared but not verified, so every physical read stays blocked.",
  },
];

function rowSummary(row: Omit<MonitorStateMatrixRow, "summary" | "nextStep">): string {
  if (!row.realControllerIo) {
    return `${row.stateLabel}: no real controller I/O is available; monitor/fault reads are blocked.`;
  }
  if (!row.verified) {
    return `${row.stateLabel}: real controller I/O is unverified, so safety gates block monitor reads.`;
  }
  if (row.state === "faulted") {
    return `${row.stateLabel}: verified transport exists, but the faulted session blocks reads until reconnect.`;
  }
  if (row.monitorAvailable) {
    return `${row.stateLabel}: monitor/fault reads can run; upload, browse/path, and write paths remain independently gated.`;
  }
  return `${row.stateLabel}: read-only monitoring is not available until the required read capability is explicit.`;
}

function nextStep(row: Omit<MonitorStateMatrixRow, "summary" | "nextStep">): string {
  if (row.firstBlocker && !row.monitorAvailable) return nextStepFor(row.firstBlocker);
  if (row.downloadBlocked) return "Read-only monitor gates are clear; keep write/destructive commands blocked unless a verified write transport and confirmation exist.";
  return "Monitor-state row is fully clear.";
}

export function monitorStateMatrixReport(
  scenarios: readonly MonitorStateScenario[] = DEFAULT_MONITOR_STATE_SCENARIOS,
): MonitorStateMatrixReport {
  const rows = scenarios.map((scenario): MonitorStateMatrixRow => {
    const cells = READ_COMMANDS.map((command): MonitorStateCommandCell => {
      const availability = evaluateCommand(command, {
        state: scenario.state,
        capabilities: scenario.capabilities,
        confirmed: true,
      });
      return {
        commandKind: command.kind,
        label: command.label,
        available: availability.available,
        reason: availability.reason,
        explanation: availability.explanation,
      };
    });
    const download = evaluateCommand(DOWNLOAD_COMMAND, {
      state: scenario.state,
      capabilities: scenario.capabilities,
      confirmed: true,
    });
    const readCells = cells.filter((cell) => cell.commandKind !== "go-offline");
    const base = {
      id: scenario.id,
      label: scenario.label,
      state: scenario.state,
      stateLabel: CONNECTION_STATE_LABELS[scenario.state],
      note: scenario.note,
      realControllerIo: scenario.capabilities.realControllerIo,
      verified: scenario.capabilities.verified,
      monitorAvailable: cells.find((cell) => cell.commandKind === "monitor")?.available ?? false,
      faultDiagnosticsAvailable: cells.find((cell) => cell.commandKind === "fault-diagnostics")?.available ?? false,
      goOfflineAvailable: cells.find((cell) => cell.commandKind === "go-offline")?.available ?? false,
      downloadBlocked: download.blocked,
      firstBlocker: readCells.find((cell) => cell.reason)?.reason ?? null,
      blockedReadCount: readCells.filter((cell) => cell.reason).length,
      availableReadCount: readCells.filter((cell) => cell.available).length,
      cells,
    };
    return {
      ...base,
      summary: rowSummary(base),
      nextStep: nextStep(base),
    };
  });
  const blockedReadCount = rows.reduce((sum, row) => sum + row.blockedReadCount, 0);
  return {
    rows,
    scenarioCount: rows.length,
    verifiedRealScenarioCount: rows.filter((row) => row.realControllerIo && row.verified).length,
    faultedScenarioCount: rows.filter((row) => row.state === "faulted").length,
    blockedReadCount,
    summary: `${blockedReadCount} monitor/fault-read gates are blocked across ${rows.length} offline and future-state scenarios.`,
  };
}
