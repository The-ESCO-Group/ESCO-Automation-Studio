import type { PlcProject, Program, Tag } from "@esco/core";
import { compareControllerIdentity, localProjectIdentity } from "./identity";
import type {
  BatchTagReadResult,
  CompareResult,
  ConnectionConfig,
  ControllerConnectionEvidence,
  ConnectionResult,
  ControllerDriver,
  ControllerDriverCapabilities,
  ControllerDriverKind,
  ControllerIdentity,
  ControllerStatus,
  FaultInfo,
  ProjectSnapshot,
  SubscriptionHandle,
  TagDefinition,
  TagQuality,
  TagSubscriptionCallback,
  TagValue,
  TagValuePayload,
  WriteResult,
} from "./types";

const now = (): string => new Date().toISOString();

const UNSUPPORTED_DRIVER_CAPABILITIES: ControllerDriverCapabilities = {
  canConnect: false,
  canReadStatus: false,
  canReadFaults: false,
  canBrowseTags: false,
  canReadTags: false,
  canBatchReadTags: false,
  canSubscribeTags: false,
  canUploadSnapshot: false,
  canCompareProject: false,
  canWriteTags: false,
  canDownloadProject: false,
  canOnlineEdit: false,
  canForceTags: false,
  canModeChange: false,
  canClearFaults: false,
};

const NO_LIVE_TRANSPORT_EVIDENCE: ControllerConnectionEvidence = {
  transportValidation: "none",
  realControllerIo: false,
  hardwareValidated: false,
  verified: false,
  label: "No live transport",
  message: "This driver path is a placeholder; no physical-controller transport ships behind it in this build.",
  limitations: ["No live controller I/O.", "No upload, download, online edit, force, or write path."],
};

const SIMULATOR_CONNECTION_EVIDENCE: ControllerConnectionEvidence = {
  transportValidation: "software-wired",
  realControllerIo: false,
  hardwareValidated: false,
  verified: true,
  label: "ESCO software simulator",
  message: "The ESCO simulator is wired for offline testing only and never contacts plant hardware.",
  limitations: ["No physical controller I/O.", "Simulator proof does not validate an Allen-Bradley plant route."],
};

const OFFLINE_SNAPSHOT_EVIDENCE: ControllerConnectionEvidence = {
  transportValidation: "software-wired",
  realControllerIo: false,
  hardwareValidated: false,
  verified: true,
  label: "Offline snapshot",
  message: "L5X/project sync reviews an offline ESCO project snapshot through the gateway; it is not a PLC link.",
  limitations: ["No physical controller I/O.", "Snapshot values are review data and may be stale."],
};

function unavailableStatus(message: string): ControllerStatus {
  return { state: "disconnected", connected: false, health: "unknown", message, updatedAt: now() };
}

export class UnsupportedOnlineDriver implements ControllerDriver {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly kind: ControllerDriverKind,
    private readonly message: string,
  ) {}

  readonly capabilities = UNSUPPORTED_DRIVER_CAPABILITIES;
  readonly connectionEvidence = NO_LIVE_TRANSPORT_EVIDENCE;

  async connect(): Promise<ConnectionResult> {
    return { ok: false, state: "disconnected", message: this.message };
  }

  async disconnect(): Promise<void> {}

  async getIdentity(): Promise<ControllerIdentity> {
    throw new Error(this.message);
  }

  async getStatus(): Promise<ControllerStatus> {
    return unavailableStatus(this.message);
  }

  async getFaults(): Promise<FaultInfo[]> {
    return [];
  }

  async readTag(): Promise<TagValue> {
    throw new Error(this.message);
  }
}

export interface SimulatorGatewayTag {
  name: string;
  dataType: string;
  value: TagValuePayload;
  writable?: boolean;
}

export interface SimulatorGatewayDriverOptions {
  id?: string;
  name?: string;
  identity: ControllerIdentity;
  tags?: SimulatorGatewayTag[];
  allowWrites?: boolean;
}

export class SimulatorGatewayDriver implements ControllerDriver {
  readonly id: string;
  readonly name: string;
  readonly kind = "simulator" as const;
  readonly connectionEvidence = SIMULATOR_CONNECTION_EVIDENCE;
  private connected = false;
  private readonly tags = new Map<string, SimulatorGatewayTag>();
  private readonly subscribers = new Map<string, { tagNames: Set<string>; callback: TagSubscriptionCallback }>();
  private readonly allowWrites: boolean;

  constructor(private readonly options: SimulatorGatewayDriverOptions) {
    this.id = options.id ?? "esco-simulator";
    this.name = options.name ?? "ESCO Simulator Driver";
    this.allowWrites = options.allowWrites === true;
    for (const tag of options.tags ?? []) this.tags.set(tag.name, { ...tag });
  }

  async connect(config: ConnectionConfig): Promise<ConnectionResult> {
    this.connected = true;
    const identity = config.simulatorProject
      ? localProjectIdentity(config.simulatorProject)
      : this.options.identity;
    return {
      ok: true,
      state: "online-readonly",
      message: "Connected to ESCO simulator through the Controller Gateway.",
      identity,
      status: await this.getStatus(),
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscribers.clear();
  }

  async getIdentity(): Promise<ControllerIdentity> {
    this.assertConnected();
    return this.options.identity;
  }

  async getStatus(): Promise<ControllerStatus> {
    return {
      state: this.connected ? "online-readonly" : "disconnected",
      mode: this.connected ? "Simulator" : undefined,
      connected: this.connected,
      health: this.connected ? "ok" : "unknown",
      message: this.connected ? "Simulator session is connected." : "Simulator session is disconnected.",
      updatedAt: now(),
    };
  }

  async getFaults(): Promise<FaultInfo[]> {
    this.assertConnected();
    return [];
  }

  async browseTags(): Promise<TagDefinition[]> {
    this.assertConnected();
    return [...this.tags.values()].map((tag) => ({
      name: tag.name,
      dataType: tag.dataType,
      writable: this.allowWrites && tag.writable !== false,
      sourceDriver: this.kind,
    }));
  }

  async readTag(tagName: string): Promise<TagValue> {
    this.assertConnected();
    const tag = this.tags.get(tagName);
    if (!tag) throw new Error(`Unknown simulator tag: ${tagName}`);
    return this.tagValue(tag);
  }

  async writeTag(tagName: string, value: TagValuePayload): Promise<WriteResult> {
    this.assertConnected();
    const tag = this.tags.get(tagName);
    const auditId = `sim-write-${Date.now().toString(36)}`;
    if (!this.allowWrites || tag?.writable === false) {
      return { ok: false, message: "Simulator write is not allowed by this driver.", auditId };
    }
    if (!tag) return { ok: false, message: `Unknown simulator tag: ${tagName}`, auditId };
    tag.value = value;
    const readBack = this.tagValue(tag);
    this.publish(readBack);
    return { ok: true, message: "Simulator tag write completed.", readBack, auditId };
  }

  async subscribeTags(tagNames: string[], callback: TagSubscriptionCallback): Promise<SubscriptionHandle> {
    this.assertConnected();
    const id = `sub-${Date.now().toString(36)}-${this.subscribers.size}`;
    this.subscribers.set(id, { tagNames: new Set(tagNames), callback });
    for (const tagName of tagNames) callback(await this.readTag(tagName));
    return {
      id,
      unsubscribe: async () => {
        this.subscribers.delete(id);
      },
    };
  }

  async uploadSnapshot(): Promise<ProjectSnapshot> {
    this.assertConnected();
    const identity = await this.getIdentity();
    const tags = await Promise.all([...this.tags.keys()].map((tagName) => this.readTag(tagName)));
    return { id: `snapshot-${Date.now().toString(36)}`, capturedAt: now(), sourceDriver: this.kind, identity, tags };
  }

  async compareProject(localProject: PlcProject): Promise<CompareResult> {
    return compareControllerIdentity(localProjectIdentity(localProject), await this.getIdentity());
  }

  private tagValue(tag: SimulatorGatewayTag): TagValue {
    return {
      tagName: tag.name,
      value: tag.value,
      dataType: tag.dataType,
      quality: this.connected ? "good" : "stale",
      timestamp: now(),
      sourceDriver: this.kind,
    };
  }

  private publish(value: TagValue): void {
    for (const subscription of this.subscribers.values()) {
      if (subscription.tagNames.has(value.tagName)) subscription.callback(value);
    }
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("Simulator driver is disconnected.");
  }
}

interface L5XSnapshotTag {
  name: string;
  tag: Tag;
  scope: "controller" | "program";
  programName?: string;
}

export class L5XSyncDriver implements ControllerDriver {
  readonly id = "l5x-sync";
  readonly name = "L5X Import/Export/Sync Layer";
  readonly kind = "l5x" as const;
  readonly connectionEvidence = OFFLINE_SNAPSHOT_EVIDENCE;
  readonly capabilities: Partial<ControllerDriverCapabilities> = {
    canConnect: true,
    canReadStatus: true,
    canReadFaults: false,
    canBrowseTags: true,
    canReadTags: true,
    canBatchReadTags: true,
    canSubscribeTags: false,
    canUploadSnapshot: true,
    canCompareProject: true,
  };

  private project: PlcProject | undefined;
  private identity: ControllerIdentity | undefined;
  private readonly tags = new Map<string, L5XSnapshotTag>();

  async connect(config: ConnectionConfig): Promise<ConnectionResult> {
    const project = config.offlineProject ?? config.simulatorProject;
    if (!project) {
      return {
        ok: false,
        state: "disconnected",
        message: "L5X sync requires an offline ESCO project snapshot; it is not a live controller transport.",
      };
    }
    this.project = project;
    this.identity = localProjectIdentity(project);
    this.rebuildTagIndex(project);
    return {
      ok: true,
      state: "online-readonly",
      message:
        "Opened offline L5X/project snapshot through the ESCO Controller Gateway. " +
        "This path compares and reviews project structure only; it is not connected to a physical controller.",
      identity: this.identity,
      status: await this.getStatus(),
    };
  }

  async disconnect(): Promise<void> {
    this.project = undefined;
    this.identity = undefined;
    this.tags.clear();
  }

  async getIdentity(): Promise<ControllerIdentity> {
    this.assertOpen();
    return this.identity ?? {};
  }

  async getStatus(): Promise<ControllerStatus> {
    return {
      state: this.project ? "online-readonly" : "disconnected",
      mode: this.project ? "Offline L5X/project sync" : undefined,
      connected: this.project !== undefined,
      health: this.project ? "ok" : "unknown",
      message: this.project
        ? "Offline L5X/project snapshot is open for read-only compare/sync review."
        : "Offline L5X/project sync path is closed.",
      updatedAt: now(),
    };
  }

  async getFaults(): Promise<FaultInfo[]> {
    throw new Error("L5X sync does not support live controller fault reads; map fault/status tags and review them read-only.");
  }

  async browseTags(): Promise<TagDefinition[]> {
    this.assertOpen();
    return [...this.tags.values()].map((entry) => this.definitionFor(entry));
  }

  async readTag(tagName: string): Promise<TagValue> {
    this.assertOpen();
    const entry = this.tags.get(tagName);
    if (!entry) throw new Error(`Unknown L5X snapshot tag: ${tagName}`);
    return this.valueFor(entry);
  }

  async readTags(tagNames: string[]): Promise<BatchTagReadResult> {
    const values: TagValue[] = [];
    const errors: Record<string, string> = {};
    for (const tagName of tagNames) {
      try {
        values.push(await this.readTag(tagName));
      } catch (cause) {
        errors[tagName] = cause instanceof Error ? cause.message : String(cause);
      }
    }
    return { values, errors };
  }

  async uploadSnapshot(): Promise<ProjectSnapshot> {
    this.assertOpen();
    const identity = await this.getIdentity();
    const tags = await Promise.all([...this.tags.keys()].map((tagName) => this.readTag(tagName)));
    return {
      id: `l5x-snapshot-${Date.now().toString(36)}`,
      capturedAt: now(),
      sourceDriver: this.kind,
      identity,
      tags,
      raw: {
        projectId: this.project?.id,
        projectName: this.project?.name,
        sourceType: this.project?.provenance?.sourceType ?? "offline-project",
        controllerCount: this.project?.controllers.length ?? 0,
      },
    };
  }

  async compareProject(localProject: PlcProject): Promise<CompareResult> {
    return compareControllerIdentity(localProjectIdentity(localProject), await this.getIdentity());
  }

  private rebuildTagIndex(project: PlcProject): void {
    this.tags.clear();
    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        this.tags.set(tag.name, { name: tag.name, tag, scope: "controller" });
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          const name = programTagName(program, tag);
          this.tags.set(name, { name, tag, scope: "program", programName: program.name });
        }
      }
    }
  }

  private definitionFor(entry: L5XSnapshotTag): TagDefinition {
    return {
      name: entry.name,
      dataType: entry.tag.dataType,
      scope: entry.scope,
      writable: false,
      sourceDriver: this.kind,
      address: entry.scope === "program" ? `Program:${entry.programName}.${entry.tag.name}` : entry.tag.name,
    };
  }

  private valueFor(entry: L5XSnapshotTag): TagValue {
    const coerced = coerceSnapshotValue(entry.tag.value);
    return {
      tagName: entry.name,
      value: coerced.value,
      dataType: entry.tag.dataType,
      quality: coerced.quality,
      timestamp: this.project?.updatedAt ?? now(),
      sourceDriver: this.kind,
    };
  }

  private assertOpen(): void {
    if (!this.project) throw new Error("L5X sync path has no offline project snapshot open.");
  }
}

export function createDefaultControllerDrivers(): ControllerDriver[] {
  return [
    new SimulatorGatewayDriver({
      identity: {
        controllerName: "ESCO_SIM",
        controllerType: "ESCO Virtual Controller",
        projectName: "Simulator",
        projectSignature: "simulator",
        vendor: "ESCO",
      },
      tags: [
        { name: "Conveyor.RunFeedback", dataType: "BOOL", value: true, writable: false },
        { name: "Conveyor.SpeedFpm", dataType: "REAL", value: 42.5, writable: false },
        { name: "Sorter.BoxCount", dataType: "DINT", value: 3, writable: false },
        { name: "Sorter.LastBarcode", dataType: "STRING", value: "KITKAT", writable: false },
      ],
      allowWrites: true,
    }),
    new UnsupportedOnlineDriver(
      "opcua-generic-readonly",
      "Generic OPC UA Read-Only Placeholder",
      "opcua",
      "Generic OPC UA is browser-safe placeholder metadata here; the backend API host injects the read-only OPC UA driver.",
    ),
    new UnsupportedOnlineDriver(
      "opcda-legacy-placeholder",
      "Legacy OPC DA Placeholder",
      "opcda",
      "OPC DA is a legacy placeholder only; no RSLinx or vendor service dependency ships with ESCO.",
    ),
    new UnsupportedOnlineDriver(
      "ethernetip-cip-readonly",
      "EtherNet/IP CIP Read-Only Scaffold",
      "ethernetip",
      "Direct ESCO EtherNet/IP/CIP read-only access is backend-only; inject @esco/driver-ethernetip-node in an API host.",
    ),
    new L5XSyncDriver(),
  ];
}

function programTagName(program: Program, tag: Tag): string {
  return `Program:${program.name}.${tag.name}`;
}

function coerceSnapshotValue(value: unknown): { value: TagValuePayload; quality: TagQuality } {
  if (value === undefined) return { value: null, quality: "stale" };
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return { value, quality: "stale" };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { value, quality: "stale" }
      : { value: null, quality: "uncertain" };
  }
  if (Array.isArray(value)) {
    let uncertain = false;
    const items = value.map((item) => {
      if (item === null || typeof item === "boolean" || typeof item === "number" || typeof item === "string") {
        if (typeof item === "number" && !Number.isFinite(item)) {
          uncertain = true;
          return null;
        }
        return item;
      }
      uncertain = true;
      return null;
    });
    return { value: items, quality: uncertain ? "uncertain" : "stale" };
  }
  return { value: null, quality: "uncertain" };
}
