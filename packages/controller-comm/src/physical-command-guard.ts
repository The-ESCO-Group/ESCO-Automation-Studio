import { CONTROLLER_COMMAND_LIST, commandRisk, evaluateCommand } from "./commands";
import type {
  ControllerConnectionCapabilities,
  ControllerConnectionProviderKind,
} from "./connection-provider";
import { commissioningPreflight, preflightSummary } from "./preflight";
import type {
  BlockedReason,
  CommandRisk,
  ConnectionState,
  ControllerCommandKind,
  TransportCapabilities,
} from "./types";

export type PhysicalGuardClassification =
  | "verified-software"
  | "verified-physical"
  | "unverified-physical"
  | "simulation"
  | "unsupported";

export interface PhysicalCommandGuardInput {
  id?: string;
  name?: string;
  kind?: ControllerConnectionProviderKind;
  capabilities: ControllerConnectionCapabilities;
}

export interface PhysicalCommandGuardRow {
  commandKind: ControllerCommandKind;
  label: string;
  risk: CommandRisk;
  available: boolean;
  reason: BlockedReason;
  firstBlocker: BlockedReason;
  cleared: boolean;
  summary: string;
}

export interface PhysicalCommandGuardReport {
  providerId?: string;
  providerName?: string;
  providerKind?: ControllerConnectionProviderKind;
  classification: PhysicalGuardClassification;
  verifiedSoftwareOnly: boolean;
  physicalTransportReady: boolean;
  totalPhysicalCommands: number;
  blockedPhysicalCommands: number;
  clearedPhysicalCommands: number;
  rows: PhysicalCommandGuardRow[];
  message: string;
}

function classify(capabilities: ControllerConnectionCapabilities): PhysicalGuardClassification {
  if (capabilities.realControllerIo && capabilities.verified) return "verified-physical";
  if (capabilities.realControllerIo) return "unverified-physical";
  if (capabilities.verified) return "verified-software";
  if (capabilities.readTags || capabilities.writeTags || capabilities.subscribeTags) return "simulation";
  return "unsupported";
}

function commandCapabilities(capabilities: ControllerConnectionCapabilities): TransportCapabilities {
  return {
    realControllerIo: capabilities.realControllerIo,
    verified: capabilities.verified,
    simulation: !capabilities.realControllerIo && !capabilities.verified && (capabilities.readTags || capabilities.writeTags),
    canRead:
      capabilities.readTags ||
      capabilities.upload ||
      capabilities.browseNetwork ||
      capabilities.discoverModules ||
      capabilities.clearFaults,
    canBrowseNetwork: capabilities.browseNetwork,
    canSelectPath: capabilities.browseNetwork,
    canPathDiagnostics: capabilities.browseNetwork || capabilities.discoverModules,
    canUpload: capabilities.upload,
    canMonitor: capabilities.readTags || capabilities.subscribeTags,
    canReadFaults: capabilities.readTags || capabilities.clearFaults,
    canWrite:
      capabilities.writeTags ||
      capabilities.download ||
      capabilities.onlineEdit ||
      capabilities.modeChange ||
      capabilities.clearFaults,
  };
}

function defaultState(capabilities: ControllerConnectionCapabilities): ConnectionState {
  if (!capabilities.realControllerIo && (capabilities.readTags || capabilities.writeTags)) return "offline-simulation";
  if (!capabilities.realControllerIo) return "disconnected";
  if (!capabilities.verified) return "safety-blocked";
  return capabilities.writeTags || capabilities.download || capabilities.modeChange ? "connected-readonly" : "connected-monitor";
}

function reportMessage(input: PhysicalCommandGuardInput, report: Omit<PhysicalCommandGuardReport, "message">): string {
  const name = input.name ?? "Controller provider";
  if (report.verifiedSoftwareOnly) {
    return `${name} is verified software only; ${report.blockedPhysicalCommands}/${report.totalPhysicalCommands} physical-controller commands remain blocked by the real-transport gate.`;
  }
  if (report.physicalTransportReady) {
    return `${name} reports a verified physical transport; ${report.clearedPhysicalCommands}/${report.totalPhysicalCommands} physical-controller commands clear their current gates.`;
  }
  return `${name} does not report a verified physical transport; ${report.blockedPhysicalCommands}/${report.totalPhysicalCommands} physical-controller commands remain blocked.`;
}

export function physicalCommandGuardReport(
  input: PhysicalCommandGuardInput,
  options: { state?: ConnectionState; confirmed?: boolean } = {},
): PhysicalCommandGuardReport {
  const capabilities = commandCapabilities(input.capabilities);
  const state = options.state ?? defaultState(input.capabilities);
  const confirmed = options.confirmed ?? true;
  const rows = CONTROLLER_COMMAND_LIST
    .filter((command) => command.requiresRealIo)
    .map((command): PhysicalCommandGuardRow => {
      const availability = evaluateCommand(command, { state, capabilities, confirmed });
      const preflight = commissioningPreflight(command, { state, capabilities, confirmed });
      return {
        commandKind: command.kind,
        label: command.label,
        risk: commandRisk(command),
        available: availability.available,
        reason: availability.reason,
        firstBlocker: preflight.firstBlocker,
        cleared: preflight.cleared,
        summary: preflightSummary(preflight),
      };
    });
  const classification = classify(input.capabilities);
  const blockedPhysicalCommands = rows.filter((row) => !row.available).length;
  const reportBase = {
    ...(input.id ? { providerId: input.id } : {}),
    ...(input.name ? { providerName: input.name } : {}),
    ...(input.kind ? { providerKind: input.kind } : {}),
    classification,
    verifiedSoftwareOnly: classification === "verified-software",
    physicalTransportReady: classification === "verified-physical",
    totalPhysicalCommands: rows.length,
    blockedPhysicalCommands,
    clearedPhysicalCommands: rows.length - blockedPhysicalCommands,
    rows,
  };
  return {
    ...reportBase,
    message: reportMessage(input, reportBase),
  };
}
