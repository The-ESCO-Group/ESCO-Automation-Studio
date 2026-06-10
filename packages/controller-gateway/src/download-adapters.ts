import type {
  DownloadPreflightGateResult,
  DownloadPreflightRequest,
  DownloadPreflightResult,
  ExecutableTargetAdapterRegistry,
  PlcDownloadAdapterDescriptor,
  TargetAdapter,
  TargetAdapterCapabilities,
  TargetAdapterMetadata,
  TargetAdapterRegistry,
  TargetAdapterSafetyProfile,
} from "./types";

export const TARGET_ADAPTER_REQUIRED_GATES = [
  "adapter-policy-approval",
  "target-family-and-firmware-match",
  "zero-blocking-project-diagnostics",
  "target-compile-or-export-success",
  "backup-or-approved-backup-skip",
  "local-target-identity-compare",
  "operator-permission",
  "operator-confirmation",
  "pre-action-audit",
  "download-result-verification",
  "post-action-audit",
] as const;

export const PLC_DOWNLOAD_REQUIRED_GATES = TARGET_ADAPTER_REQUIRED_GATES;

const PHYSICAL_DOWNLOAD_BLOCKED =
  "Physical PLC download is blocked until this target adapter has compile/export, compare, backup, permission, audit, read-back, and lab/field validation evidence.";

const NO_EXECUTION =
  "This target adapter is metadata-only in the current build. No executable physical-controller download path is registered.";

const BLOCKED_CAPABILITIES: TargetAdapterCapabilities = {
  projectModelImport: false,
  projectModelExport: false,
  validate: false,
  compile: false,
  compareOfflineOnline: false,
  backup: false,
  uploadSnapshot: false,
  physicalDownload: false,
  onlineMonitor: false,
  onlineTagRead: false,
  onlineTagWrite: false,
  onlineEdit: false,
  modeChange: false,
  faultReset: false,
  ioTreeRead: false,
  ioTreeWrite: false,
  safetyControllerSupport: false,
  motionSupport: false,
};

type PlannedTargetAdapterInput = Omit<
  TargetAdapterMetadata,
  | "capabilities"
  | "safety"
  | "executionAvailable"
  | "physicalDownloadEnabled"
  | "verified"
  | "realControllerIo"
  | "blockedReason"
  | "requiredGates"
> & {
  capabilities?: Partial<TargetAdapterCapabilities>;
  safety?: Partial<TargetAdapterSafetyProfile>;
  realControllerIo?: boolean;
  blockedReason?: string;
  requiredGates?: readonly string[];
};

function capabilities(patch: Partial<TargetAdapterCapabilities> = {}): TargetAdapterCapabilities {
  return { ...BLOCKED_CAPABILITIES, ...patch };
}

function safetyProfile(
  realControllerIo: boolean,
  patch: Partial<TargetAdapterSafetyProfile> = {},
): TargetAdapterSafetyProfile {
  return {
    executionAvailable: false,
    physicalDownloadEnabled: false,
    verified: false,
    requiresBackupBeforeDownload: realControllerIo,
    requiresCompareBeforeDownload: realControllerIo,
    requiresExplicitUserApproval: realControllerIo,
    supportsDryRun: false,
    defaultMode: realControllerIo ? "read-only" : "simulation-only",
    riskLevel: realControllerIo ? "critical" : "low",
    safetyMessage: realControllerIo ? PHYSICAL_DOWNLOAD_BLOCKED : NO_EXECUTION,
    ...patch,
  };
}

function plannedAdapter(descriptor: PlannedTargetAdapterInput): TargetAdapterMetadata {
  const realControllerIo = descriptor.realControllerIo ?? true;
  const safety = safetyProfile(realControllerIo, descriptor.safety);
  const targetCapabilities = capabilities(descriptor.capabilities);
  return {
    ...descriptor,
    capabilities: targetCapabilities,
    safety,
    executionAvailable: safety.executionAvailable,
    physicalDownloadEnabled: safety.physicalDownloadEnabled,
    verified: safety.verified,
    realControllerIo,
    blockedReason: descriptor.blockedReason ?? safety.safetyMessage,
    requiredGates: [...(descriptor.requiredGates ?? TARGET_ADAPTER_REQUIRED_GATES)],
  };
}

export const TARGET_ADAPTERS: readonly TargetAdapterMetadata[] = [
  plannedAdapter({
    id: "esco-runtime",
    name: "ESCO Runtime / SoftController",
    vendor: "esco",
    families: ["ESCO SoftController", "ESCO Runtime"],
    strategy: "esco-runtime",
    validationState: "virtual-only",
    realControllerIo: false,
    capabilities: {
      projectModelImport: true,
      projectModelExport: true,
      validate: true,
      compile: true,
      compareOfflineOnline: true,
      uploadSnapshot: true,
      onlineMonitor: true,
      onlineTagRead: true,
    },
    safety: {
      defaultMode: "simulation-only",
      riskLevel: "low",
      safetyMessage:
        "No physical PLC is involved. Use the ESCO Virtual Controller or runtime package surfaces for virtual workflows.",
    },
    notes:
      "ESCO-owned virtual/runtime target. Existing virtual download lives on the SoftController surface; this registry does not execute it.",
    blockedReason:
      "No physical PLC is involved. Use the ESCO Virtual Controller or runtime package surfaces for virtual download workflows.",
  }),
  plannedAdapter({
    id: "allen-bradley-logix",
    name: "Allen-Bradley Logix",
    vendor: "allen-bradley",
    families: ["ControlLogix", "CompactLogix", "GuardLogix"],
    strategy: "ethernetip-cip-planned",
    validationState: "software-wired",
    capabilities: {
      projectModelImport: true,
      projectModelExport: true,
      validate: true,
      compareOfflineOnline: true,
      backup: true,
      uploadSnapshot: true,
      onlineMonitor: true,
      onlineTagRead: true,
      ioTreeRead: true,
    },
    notes:
      "First high-value PLC adapter track. Read-only EtherNet/IP monitoring is software-wired today; physical download remains blocked.",
  }),
  plannedAdapter({
    id: "siemens-s7",
    name: "Siemens S7 / TIA Portal family",
    vendor: "siemens",
    families: ["S7-1200", "S7-1500", "S7-300/400 review"],
    strategy: "vendor-file-export-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No Siemens compile/export/download implementation ships in this build.",
  }),
  plannedAdapter({
    id: "codesys-iec",
    name: "CODESYS / IEC 61131 runtime",
    vendor: "codesys",
    families: ["CODESYS Control", "IEC 61131 runtime targets"],
    strategy: "vendor-runtime-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned IEC runtime target pack. No physical runtime deployment path ships in this build.",
  }),
  plannedAdapter({
    id: "beckhoff-twincat",
    name: "Beckhoff TwinCAT",
    vendor: "beckhoff",
    families: ["TwinCAT 3 PLC runtime"],
    strategy: "vendor-runtime-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No TwinCAT project export or runtime activation path ships in this build.",
  }),
  plannedAdapter({
    id: "schneider-modicon",
    name: "Schneider / Modicon",
    vendor: "schneider-modicon",
    families: ["Modicon M580", "Modicon M340", "EcoStruxure Control Expert family"],
    strategy: "vendor-file-export-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No Schneider/Modicon download implementation ships in this build.",
  }),
  plannedAdapter({
    id: "omron-nx-nj",
    name: "Omron NX/NJ",
    vendor: "omron",
    families: ["NX", "NJ"],
    strategy: "vendor-file-export-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No Omron download implementation ships in this build.",
  }),
  plannedAdapter({
    id: "mitsubishi-melsec",
    name: "Mitsubishi MELSEC",
    vendor: "mitsubishi",
    families: ["iQ-R", "iQ-F", "Q/L review"],
    strategy: "vendor-file-export-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No Mitsubishi download implementation ships in this build.",
  }),
  plannedAdapter({
    id: "ge-emerson-pac",
    name: "GE / Emerson PAC",
    vendor: "ge-emerson",
    families: ["PACSystems RX3i", "PACSystems RX7i review"],
    strategy: "vendor-file-export-planned",
    validationState: "planned",
    capabilities: { projectModelImport: true, projectModelExport: true, validate: true },
    notes: "Planned target pack. No GE/Emerson PAC download implementation ships in this build.",
  }),
  plannedAdapter({
    id: "generic-opcua-data",
    name: "Generic OPC UA data endpoint",
    vendor: "generic-device",
    families: ["OPC UA server"],
    strategy: "opcua-data-only",
    validationState: "software-wired",
    capabilities: { onlineMonitor: true, onlineTagRead: true, ioTreeRead: true },
    notes:
      "OPC UA is useful for read-only data integration and monitoring, but it is not a universal PLC logic-download protocol.",
  }),
  plannedAdapter({
    id: "generic-modbus-data",
    name: "Generic Modbus TCP device",
    vendor: "generic-device",
    families: ["Modbus TCP devices", "Meters", "Drives"],
    strategy: "fieldbus-data-only",
    validationState: "planned",
    capabilities: { onlineMonitor: true, onlineTagRead: true },
    notes: "Modbus TCP is a device data protocol, not a PLC logic-download path by itself.",
  }),
  plannedAdapter({
    id: "generic-mqtt-sparkplug",
    name: "MQTT / Sparkplug data system",
    vendor: "generic-device",
    families: ["MQTT", "Sparkplug B"],
    strategy: "telemetry-data-only",
    validationState: "planned",
    realControllerIo: false,
    capabilities: { onlineMonitor: true, onlineTagRead: true },
    safety: {
      defaultMode: "read-only",
      riskLevel: "low",
      safetyMessage: "MQTT/Sparkplug is a telemetry path, not a PLC logic-download path.",
    },
    notes: "MQTT/Sparkplug is a telemetry/integration path, not a PLC logic-download path by itself.",
  }),
];

export const PLC_DOWNLOAD_ADAPTERS: readonly PlcDownloadAdapterDescriptor[] = TARGET_ADAPTERS;

function cloneTargetAdapterMetadata(adapter: TargetAdapterMetadata): TargetAdapterMetadata {
  return {
    ...adapter,
    families: [...adapter.families],
    capabilities: { ...adapter.capabilities },
    safety: { ...adapter.safety },
    requiredGates: [...adapter.requiredGates],
  };
}

export function targetAdapterAllowsPhysicalDownload(adapter: TargetAdapterMetadata): boolean {
  return (
    adapter.capabilities.physicalDownload &&
    adapter.safety.executionAvailable &&
    adapter.safety.physicalDownloadEnabled &&
    adapter.safety.verified
  );
}

function blockedGateResults(adapter: TargetAdapterMetadata, message: string): DownloadPreflightGateResult[] {
  return adapter.requiredGates.map((gate, index) => ({
    gate,
    state: "blocked",
    required: true,
    message:
      index === 0
        ? message
        : `Not evaluated because target adapter "${adapter.id}" is not executable, verified, and download-enabled.`,
  }));
}

function passedGateResults(adapter: TargetAdapterMetadata): DownloadPreflightGateResult[] {
  return adapter.requiredGates.map((gate) => ({
    gate,
    state: "passed",
    required: true,
    message: "Gate satisfied by backend target adapter preflight.",
  }));
}

export function createDownloadPreflightResult(
  adapter: TargetAdapterMetadata,
  at = new Date().toISOString(),
): DownloadPreflightResult {
  const physicalDownloadAllowed = targetAdapterAllowsPhysicalDownload(adapter);
  const blockers = physicalDownloadAllowed
    ? []
    : [
        adapter.blockedReason ?? PHYSICAL_DOWNLOAD_BLOCKED,
        ...(adapter.safety.executionAvailable ? [] : [NO_EXECUTION]),
        ...(adapter.safety.physicalDownloadEnabled ? [] : ["Physical download is disabled for this target adapter."]),
        ...(adapter.safety.verified ? [] : ["This target adapter is not verified for lab or field physical download."]),
        ...(adapter.capabilities.physicalDownload ? [] : ["This target adapter does not declare a physical-download capability."]),
      ];
  const gateResults = physicalDownloadAllowed
    ? passedGateResults(adapter)
    : blockedGateResults(adapter, blockers[0] ?? PHYSICAL_DOWNLOAD_BLOCKED);
  return {
    targetAdapterId: adapter.id,
    ok: physicalDownloadAllowed,
    physicalDownloadAllowed,
    executionAvailable: adapter.safety.executionAvailable,
    physicalDownloadEnabled: adapter.safety.physicalDownloadEnabled,
    verified: adapter.safety.verified,
    defaultMode: adapter.safety.defaultMode,
    riskLevel: adapter.safety.riskLevel,
    requiredGates: [...adapter.requiredGates],
    gateResults,
    blockers,
    warnings: adapter.realControllerIo ? ["Physical-controller operations require site commissioning evidence."] : [],
    message: physicalDownloadAllowed
      ? "Download preflight passed for this backend-verified target adapter."
      : "Download preflight blocked. Physical PLC download remains unavailable.",
    checkedAt: at,
  };
}

function unknownTargetPreflight(request: DownloadPreflightRequest, at = new Date().toISOString()): DownloadPreflightResult {
  return {
    targetAdapterId: request.targetAdapterId,
    ok: false,
    physicalDownloadAllowed: false,
    executionAvailable: false,
    physicalDownloadEnabled: false,
    verified: false,
    defaultMode: "read-only",
    riskLevel: "critical",
    requiredGates: [...TARGET_ADAPTER_REQUIRED_GATES],
    gateResults: TARGET_ADAPTER_REQUIRED_GATES.map((gate, index) => ({
      gate,
      state: index === 0 ? "blocked" : "not-run",
      required: true,
      message:
        index === 0
          ? `Unknown target adapter "${request.targetAdapterId}".`
          : "Not evaluated because the requested target adapter is not registered.",
    })),
    blockers: [`Unknown target adapter "${request.targetAdapterId}".`],
    warnings: [],
    message: "Download preflight blocked. The requested target adapter is not registered.",
    checkedAt: at,
  };
}

export class MetadataOnlyTargetAdapterRegistry implements TargetAdapterRegistry {
  protected readonly metadataById = new Map<string, TargetAdapterMetadata>();

  constructor(adapters: readonly TargetAdapterMetadata[] = TARGET_ADAPTERS) {
    for (const adapter of adapters) {
      this.metadataById.set(adapter.id, cloneTargetAdapterMetadata(adapter));
    }
  }

  listMetadata(): TargetAdapterMetadata[] {
    return Array.from(this.metadataById.values(), cloneTargetAdapterMetadata);
  }

  getMetadata(id: string): TargetAdapterMetadata | undefined {
    const adapter = this.metadataById.get(id);
    return adapter ? cloneTargetAdapterMetadata(adapter) : undefined;
  }

  async preflightDownload(request: DownloadPreflightRequest): Promise<DownloadPreflightResult> {
    const adapter = this.metadataById.get(request.targetAdapterId);
    return adapter ? createDownloadPreflightResult(adapter) : unknownTargetPreflight(request);
  }
}

export class InMemoryExecutableTargetAdapterRegistry
  extends MetadataOnlyTargetAdapterRegistry
  implements ExecutableTargetAdapterRegistry
{
  private readonly executableById = new Map<string, TargetAdapter>();

  listExecutableMetadata(): TargetAdapterMetadata[] {
    return Array.from(this.executableById.values(), (adapter) => cloneTargetAdapterMetadata(adapter.metadata));
  }

  getExecutableAdapter(id: string): TargetAdapter | undefined {
    return this.executableById.get(id);
  }

  register(adapter: TargetAdapter): void {
    this.metadataById.set(adapter.metadata.id, cloneTargetAdapterMetadata(adapter.metadata));
    this.executableById.set(adapter.metadata.id, adapter);
  }

  async preflightDownload(request: DownloadPreflightRequest): Promise<DownloadPreflightResult> {
    const metadata = this.metadataById.get(request.targetAdapterId);
    if (!metadata) return unknownTargetPreflight(request);
    if (!targetAdapterAllowsPhysicalDownload(metadata)) return createDownloadPreflightResult(metadata);
    const adapter = this.executableById.get(request.targetAdapterId);
    if (!adapter) return createDownloadPreflightResult(metadata);
    const result = await adapter.preflightDownload(request);
    return {
      ...result,
      ok: result.ok && result.physicalDownloadAllowed && targetAdapterAllowsPhysicalDownload(metadata),
      physicalDownloadAllowed: result.physicalDownloadAllowed && targetAdapterAllowsPhysicalDownload(metadata),
    };
  }
}

export const TARGET_ADAPTER_REGISTRY = new MetadataOnlyTargetAdapterRegistry(TARGET_ADAPTERS);

export function listTargetAdapterMetadata(): TargetAdapterMetadata[] {
  return TARGET_ADAPTER_REGISTRY.listMetadata();
}

export function listPlcDownloadAdapters(): PlcDownloadAdapterDescriptor[] {
  return listTargetAdapterMetadata();
}
