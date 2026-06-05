import { CONTROLLER_COMMAND_LIST } from "./commands";
import {
  NO_HARDWARE_CONNECTION_CAPABILITIES,
  SIMULATOR_CONNECTION_CAPABILITIES,
  SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
  type ControllerConnectionCapabilities,
  type ControllerConnectionProviderKind,
} from "./connection-provider";
import { SHIPPED_DRIVERS, describeDriverReadiness, type DriverDescriptor, type TransportReadiness } from "./drivers";
import { monitorStateMatrixReport } from "./monitor-state-readiness";
import { physicalCommandGuardReport, type PhysicalGuardClassification } from "./physical-command-guard";
import { shippedTransportReadinessReport } from "./transport-readiness";
import type { CommandRisk } from "./types";

export type ControllerSafetyEvidenceStatus = "clear" | "blocked" | "guarded";

export interface ShippedControllerProviderEvidenceInput {
  id: string;
  name: string;
  kind: ControllerConnectionProviderKind;
  capabilities: ControllerConnectionCapabilities;
}

export interface ControllerSafetyProviderEvidence {
  id: string;
  name: string;
  kind: ControllerConnectionProviderKind;
  classification: PhysicalGuardClassification;
  verifiedSoftwareOnly: boolean;
  physicalTransportReady: boolean;
  realControllerIo: boolean;
  verified: boolean;
  blockedPhysicalCommands: number;
  totalPhysicalCommands: number;
  message: string;
}

export interface ControllerSafetyDriverEvidence {
  id: string;
  displayName: string;
  protocol: DriverDescriptor["protocol"];
  realControllerIo: boolean;
  verified: boolean;
  requiresAudit: boolean;
  requiresPermission: boolean;
  readiness: TransportReadiness;
  ready: boolean;
  message: string;
}

export interface ControllerSafetyBoundaryEvidence {
  id: string;
  label: string;
  risk: CommandRisk;
  status: ControllerSafetyEvidenceStatus;
  evidence: string;
}

export interface ControllerSafetyInvariantEvidence {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ControllerSafetyEvidenceReport {
  providerRows: ControllerSafetyProviderEvidence[];
  driverRows: ControllerSafetyDriverEvidence[];
  boundaryRows: ControllerSafetyBoundaryEvidence[];
  invariantRows: ControllerSafetyInvariantEvidence[];
  shippedProviderCount: number;
  shippedDriverCount: number;
  verifiedSoftwareProviderCount: number;
  verifiedPhysicalProviderCount: number;
  verifiedShippedDriverCount: number;
  readyShippedDriverCount: number;
  realTransportGate: "blocked" | "available";
  physicalCommandSurfaceCount: number;
  totalPhysicalCommandRows: number;
  blockedPhysicalCommandRows: number;
  clearedPhysicalCommandRows: number;
  physicalBoundaryCount: number;
  blockedBoundaryCount: number;
  monitorScenarioCount: number;
  blockedMonitorReadGates: number;
  transportCount: number;
  blockedRealCommandCount: number;
  allPhysicalCommandsBlocked: boolean;
  allHardBoundariesBlocked: boolean;
  summary: string;
  nextStep: string;
}

export const SHIPPED_CONTROLLER_PROVIDER_EVIDENCE: readonly ShippedControllerProviderEvidenceInput[] = [
  {
    id: "esco.simulator",
    name: "ESCO Simulator",
    kind: "simulator",
    capabilities: SIMULATOR_CONNECTION_CAPABILITIES,
  },
  {
    id: "esco.soft-controller",
    name: "ESCO SoftController",
    kind: "soft-controller",
    capabilities: SOFT_CONTROLLER_CONNECTION_CAPABILITIES,
  },
  {
    id: "esco.no-hardware",
    name: "No Hardware Adapter",
    kind: "unsupported-hardware",
    capabilities: NO_HARDWARE_CONNECTION_CAPABILITIES,
  },
];

export const CONTROLLER_HARD_BOUNDARY_EVIDENCE: readonly ControllerSafetyBoundaryEvidence[] = [
  {
    id: "physical-upload",
    label: "Physical Upload",
    risk: "read",
    status: "blocked",
    evidence: "No shipped provider exposes a verified real-controller upload path.",
  },
  {
    id: "physical-download",
    label: "Physical Download",
    risk: "destructive",
    status: "blocked",
    evidence: "Download requires verified real I/O and confirmation; no shipped transport clears that gate.",
  },
  {
    id: "physical-go-online",
    label: "Physical Go Online",
    risk: "read",
    status: "blocked",
    evidence: "Go Online remains a visible safety-gated command with zero verified physical transports.",
  },
  {
    id: "physical-online-edit",
    label: "Physical Online Edit",
    risk: "destructive",
    status: "blocked",
    evidence: "Online edit commands are registered for review but cannot run without verified real I/O.",
  },
  {
    id: "physical-force",
    label: "Physical PLC Forces",
    risk: "destructive",
    status: "blocked",
    evidence: "No physical force command is registered; virtual force state is local ESCO software only.",
  },
  {
    id: "proprietary-binary",
    label: "Proprietary Binary Controller Files",
    risk: "destructive",
    status: "blocked",
    evidence: "Controller communication safety is ESCO-native/model-only; proprietary binary project transfer is outside this surface.",
  },
];

export function controllerSafetyEvidenceReport(
  providers: readonly ShippedControllerProviderEvidenceInput[] = SHIPPED_CONTROLLER_PROVIDER_EVIDENCE,
  drivers: readonly DriverDescriptor[] = SHIPPED_DRIVERS,
): ControllerSafetyEvidenceReport {
  const providerRows = providers.map((provider): ControllerSafetyProviderEvidence => {
    const report = physicalCommandGuardReport(provider);
    return {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      classification: report.classification,
      verifiedSoftwareOnly: report.verifiedSoftwareOnly,
      physicalTransportReady: report.physicalTransportReady,
      realControllerIo: provider.capabilities.realControllerIo,
      verified: provider.capabilities.verified,
      blockedPhysicalCommands: report.blockedPhysicalCommands,
      totalPhysicalCommands: report.totalPhysicalCommands,
      message: report.message,
    };
  });
  const driverRows = drivers.map((driver): ControllerSafetyDriverEvidence => {
    const readiness = describeDriverReadiness(driver, {
      permissionGranted: true,
      supported: true,
      hardwarePresent: true,
    });
    return {
      id: driver.id,
      displayName: driver.displayName,
      protocol: driver.protocol,
      realControllerIo: driver.capabilities.realControllerIo,
      verified: driver.capabilities.verified,
      requiresAudit: driver.requiresAudit,
      requiresPermission: driver.requiresPermission,
      readiness,
      ready: readiness === "ready",
      message: driver.note,
    };
  });
  const transportReadiness = shippedTransportReadinessReport();
  const monitorMatrix = monitorStateMatrixReport();
  const physicalCommandSurfaceCount = CONTROLLER_COMMAND_LIST.filter((command) => command.requiresRealIo).length;
  const verifiedSoftwareProviderCount = providerRows.filter((row) => row.verifiedSoftwareOnly).length;
  const verifiedPhysicalProviderCount = providerRows.filter((row) => row.physicalTransportReady).length;
  const verifiedShippedDriverCount = driverRows.filter((row) => row.verified).length;
  const readyShippedDriverCount = driverRows.filter((row) => row.ready).length;
  const totalPhysicalCommandRows = providerRows.reduce((sum, row) => sum + row.totalPhysicalCommands, 0);
  const blockedPhysicalCommandRows = providerRows.reduce((sum, row) => sum + row.blockedPhysicalCommands, 0);
  const clearedPhysicalCommandRows = totalPhysicalCommandRows - blockedPhysicalCommandRows;
  const blockedBoundaryCount = CONTROLLER_HARD_BOUNDARY_EVIDENCE.filter((row) => row.status === "blocked").length;
  const allPhysicalCommandsBlocked = totalPhysicalCommandRows > 0 && blockedPhysicalCommandRows === totalPhysicalCommandRows;
  const allHardBoundariesBlocked = blockedBoundaryCount === CONTROLLER_HARD_BOUNDARY_EVIDENCE.length;
  const invariantRows: ControllerSafetyInvariantEvidence[] = [
    {
      id: "no-verified-physical-transport",
      label: "No verified physical transport ships",
      passed: verifiedPhysicalProviderCount === 0 && transportReadiness.verifiedRealTransportCount === 0,
      detail: `${verifiedPhysicalProviderCount} provider(s) and ${transportReadiness.verifiedRealTransportCount} transport(s) report verified real controller I/O.`,
    },
    {
      id: "no-shipped-driver-ready",
      label: "No shipped driver descriptor is ready",
      passed: verifiedShippedDriverCount === 0 && readyShippedDriverCount === 0,
      detail: `${verifiedShippedDriverCount} shipped driver descriptor(s) are verified and ${readyShippedDriverCount} can be described as ready.`,
    },
    {
      id: "soft-controller-software-only",
      label: "SoftController is verified software only",
      passed: providerRows.some((row) => row.kind === "soft-controller" && row.verifiedSoftwareOnly && !row.realControllerIo),
      detail: "The ESCO SoftController can be verified without becoming a physical-controller transport.",
    },
    {
      id: "all-physical-commands-blocked",
      label: "Every shipped physical command row is blocked",
      passed: allPhysicalCommandsBlocked,
      detail: `${blockedPhysicalCommandRows}/${totalPhysicalCommandRows} provider command rows are blocked by the physical gate.`,
    },
    {
      id: "hard-boundaries-blocked",
      label: "Hard physical/proprietary boundaries stay blocked",
      passed: allHardBoundariesBlocked,
      detail: `${blockedBoundaryCount}/${CONTROLLER_HARD_BOUNDARY_EVIDENCE.length} named hard-boundary rows are blocked.`,
    },
    {
      id: "monitor-states-modeled-offline",
      label: "Monitor/fault gates are modeled offline",
      passed: monitorMatrix.scenarioCount > 0 && monitorMatrix.blockedReadCount > 0,
      detail: `${monitorMatrix.blockedReadCount} monitor/fault-read gates are blocked across ${monitorMatrix.scenarioCount} modeled scenarios.`,
    },
  ];

  return {
    providerRows,
    driverRows,
    boundaryRows: [...CONTROLLER_HARD_BOUNDARY_EVIDENCE],
    invariantRows,
    shippedProviderCount: providerRows.length,
    shippedDriverCount: driverRows.length,
    verifiedSoftwareProviderCount,
    verifiedPhysicalProviderCount,
    verifiedShippedDriverCount,
    readyShippedDriverCount,
    realTransportGate: verifiedPhysicalProviderCount > 0 ? "available" : "blocked",
    physicalCommandSurfaceCount,
    totalPhysicalCommandRows,
    blockedPhysicalCommandRows,
    clearedPhysicalCommandRows,
    physicalBoundaryCount: CONTROLLER_HARD_BOUNDARY_EVIDENCE.length,
    blockedBoundaryCount,
    monitorScenarioCount: monitorMatrix.scenarioCount,
    blockedMonitorReadGates: monitorMatrix.blockedReadCount,
    transportCount: transportReadiness.transportCount,
    blockedRealCommandCount: transportReadiness.blockedRealCommandCount,
    allPhysicalCommandsBlocked,
    allHardBoundariesBlocked,
    summary: `${verifiedPhysicalProviderCount} verified physical transports; ${readyShippedDriverCount}/${driverRows.length} shipped driver descriptors ready; ${blockedPhysicalCommandRows}/${totalPhysicalCommandRows} shipped physical-controller command rows blocked; ${blockedBoundaryCount}/${CONTROLLER_HARD_BOUNDARY_EVIDENCE.length} hard-boundary rows blocked.`,
    nextStep:
      "Keep physical controller operations unavailable until a separately verified real ESCO transport is implemented and audited.",
  };
}

export function shippedControllerSafetyEvidenceReport(): ControllerSafetyEvidenceReport {
  return controllerSafetyEvidenceReport();
}
