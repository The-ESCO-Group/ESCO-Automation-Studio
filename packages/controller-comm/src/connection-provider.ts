/**
 * Controller-provider contract.
 *
 * This is the adapter seam for ESCO Automation Studio. The shipped providers are
 * intentionally honest:
 *
 * - `SimulatorConnectionProvider` reads/writes/subscribes to in-memory simulator
 *   tags only.
 * - `NoHardwareConnectionProvider` refuses every PHYSICAL hardware operation with
 *   a clear unsupported error.
 * - `EscoSoftControllerConnectionProvider` is the first (and only) VERIFIED
 *   provider: a fully local, in-process ESCO SoftController. It is `verified`
 *   because it is software running in-process and covered by tests — NOT because
 *   it reaches a physical controller. It keeps `realControllerIo: false`.
 *
 * SAFETY MODEL — the capability honesty pair (`realControllerIo` + `verified`):
 *
 *   realControllerIo:false + verified:true   → a verified SOFTWARE link (SoftController).
 *   realControllerIo:true  + verified:true   → a verified PHYSICAL-HARDWARE link.
 *   realControllerIo:true  + verified:false  → an unaudited hardware link (must stay blocked).
 *
 * No provider in this repository sets `realControllerIo: true`. A real physical
 * hardware provider must implement this interface, publish BOTH flags true (only
 * after validation against tested hardware), and pass the controller safety gate
 * before upload/download, online edits, mode changes, network browse, module
 * discovery, or fault clearing may become available. Until then every physical
 * hardware operation must fail with a clear "unsupported" error rather than
 * succeeding falsely.
 */

import {
  EscoSoftController,
  type RestorePreviousRuntimeResult,
  type SoftControllerBackupInfo,
  type SoftControllerImage,
  type SoftControllerIdentity,
  type SoftControllerMode,
  type SoftFault,
} from "@esco/soft-controller";

export type RuntimeTagValue =
  | boolean
  | number
  | string
  | null
  | RuntimeTagValue[]
  | { [member: string]: RuntimeTagValue };

export type ControllerConnectionProviderKind =
  | "simulator"
  | "soft-controller"
  | "unsupported-hardware"
  | "hardware-adapter";

export type ControllerConnectionState =
  | "simulation"
  | "soft-controller-connected"
  | "hardware-connected"
  | "unsupported"
  | "disconnected";

export type RuntimeMode =
  | "offline-edit"
  | "simulation"
  | "soft-controller"
  | "hmi-preview"
  | "packaged-preview"
  | "hardware-connected";

export interface ControllerConnectionCapabilities {
  /**
   * Does this provider exchange data with a REAL, physical controller over a wire
   * protocol? An in-process / software controller (the ESCO SoftController) is
   * ALWAYS false — it never touches a physical I/O bus. Together with `verified`
   * this is the honesty pair (see the safety model at the top of this file).
   */
  realControllerIo: boolean;
  /**
   * Has this provider's link been fully implemented and tested? Only the local,
   * in-process ESCO SoftController provider sets this true. Any physical-hardware
   * adapter must keep it false until it is validated against tested hardware.
   */
  verified: boolean;
  /** Browse a physical communication network for controllers. Physical hardware only — always false here. */
  browseNetwork: boolean;
  /** Discover I/O modules on a physical chassis/network. Physical hardware only — always false here. */
  discoverModules: boolean;
  upload: boolean;
  download: boolean;
  /** Restore the previous local software runtime image. Physical hardware only remains unsupported. */
  restoreBackup: boolean;
  onlineEdit: boolean;
  modeChange: boolean;
  clearFaults: boolean;
  readTags: boolean;
  writeTags: boolean;
  subscribeTags: boolean;
}

export interface ControllerConnectionConfig {
  target?: string;
  projectId?: string;
  runtimeMode?: RuntimeMode;
}

export interface ControllerConnectionSession {
  sessionId: string;
  providerId: string;
  providerName: string;
  providerKind: ControllerConnectionProviderKind;
  state: ControllerConnectionState;
  runtimeMode: RuntimeMode;
  capabilities: ControllerConnectionCapabilities;
  connectedAt: string;
  target?: string;
  backupAvailable?: boolean;
  rollbackBackup?: SoftControllerBackupInfo;
}

export interface ControllerState {
  sessionId: string;
  state: ControllerConnectionState;
  runtimeMode: RuntimeMode;
  providerName: string;
  message: string;
  identity?: object;
  mode?: string;
  runtimeLoaded?: boolean;
  runtimeChecksum?: string;
  backupAvailable?: boolean;
  rollbackBackup?: SoftControllerBackupInfo;
  faults?: unknown[];
}

export interface ControllerRestoreResult extends ControllerState {
  restored: boolean;
  outcome: RestorePreviousRuntimeResult["outcome"];
  reason?: RestorePreviousRuntimeResult["reason"];
  error?: string;
  audit: RestorePreviousRuntimeResult["audit"];
}

export type TagCallback = (value: RuntimeTagValue | undefined, tagPath: string) => void;
export type Unsubscribe = () => void;

export interface ControllerConnectionProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ControllerConnectionProviderKind;
  readonly capabilities: ControllerConnectionCapabilities;

  connect(config?: ControllerConnectionConfig): Promise<ControllerConnectionSession>;
  disconnect(sessionId: string): Promise<void>;
  readTag(sessionId: string, tagPath: string): Promise<RuntimeTagValue | undefined>;
  writeTag(sessionId: string, tagPath: string, value: RuntimeTagValue): Promise<void>;
  subscribeTag(sessionId: string, tagPath: string, callback: TagCallback): Unsubscribe;
  getControllerState?(sessionId: string): Promise<ControllerState>;
  /** Identity handshake — report the connected controller's identity. */
  getIdentity?(sessionId: string): Promise<SoftControllerIdentity>;
  getMode?(sessionId: string): Promise<SoftControllerMode>;
  getFaults?(sessionId: string): Promise<SoftFault[]>;
  downloadRuntimePackage?(sessionId: string, text: string, fileName?: string): Promise<ControllerState>;
  restorePreviousRuntime?(sessionId: string): Promise<ControllerRestoreResult>;
  uploadControllerImage?(sessionId: string): Promise<SoftControllerImage>;
  setMode?(sessionId: string, mode: SoftControllerMode): Promise<ControllerState>;
  clearFaults?(sessionId: string): Promise<ControllerState>;
  scanOnce?(sessionId: string, deltaMs?: number): Promise<ControllerState>;
}

export const SIMULATOR_CONNECTION_CAPABILITIES: ControllerConnectionCapabilities = {
  // In-process simulator only: no real controller I/O, and not the verified link.
  realControllerIo: false,
  verified: false,
  browseNetwork: false,
  discoverModules: false,
  upload: false,
  download: false,
  restoreBackup: false,
  onlineEdit: false,
  modeChange: false,
  clearFaults: false,
  readTags: true,
  writeTags: true,
  subscribeTags: true,
};

export const NO_HARDWARE_CONNECTION_CAPABILITIES: ControllerConnectionCapabilities = {
  // The physical-hardware provider stays completely unsupported: every flag false.
  realControllerIo: false,
  verified: false,
  browseNetwork: false,
  discoverModules: false,
  upload: false,
  download: false,
  restoreBackup: false,
  onlineEdit: false,
  modeChange: false,
  clearFaults: false,
  readTags: false,
  writeTags: false,
  subscribeTags: false,
};

export const SOFT_CONTROLLER_CONNECTION_CAPABILITIES: ControllerConnectionCapabilities = {
  // The ESCO SoftController is an in-process SOFTWARE controller: it never touches
  // physical hardware (realControllerIo:false, browseNetwork/discoverModules:false)
  // but its software link IS fully local and tested, so it is the one verified
  // provider in this build.
  realControllerIo: false,
  verified: true,
  browseNetwork: false,
  discoverModules: false,
  upload: true,
  download: true,
  restoreBackup: true,
  onlineEdit: false,
  modeChange: true,
  clearFaults: true,
  readTags: true,
  writeTags: true,
  subscribeTags: true,
};

export class UnsupportedControllerConnectionError extends Error {
  readonly code = "ESCO_HARDWARE_UNSUPPORTED";

  constructor(
    readonly providerId: string,
    readonly action: string,
    message = `${action} is not available because no verified hardware adapter is configured. Use simulation or install a future audited ESCO hardware adapter.`,
  ) {
    super(message);
    this.name = "UnsupportedControllerConnectionError";
  }
}

interface SimulatorConnectionProviderOptions {
  now?: () => string;
  initialTags?: Record<string, RuntimeTagValue>;
}

export class SimulatorConnectionProvider implements ControllerConnectionProvider {
  readonly id = "esco.simulator";
  readonly name = "ESCO Simulator";
  readonly kind = "simulator" as const;
  readonly capabilities = SIMULATOR_CONNECTION_CAPABILITIES;

  private sequence = 0;
  private readonly now: () => string;
  private readonly tags = new Map<string, RuntimeTagValue>();
  private readonly sessions = new Map<string, ControllerConnectionSession>();
  private readonly subscriptions = new Map<string, Map<string, Set<TagCallback>>>();

  constructor(options: SimulatorConnectionProviderOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    for (const [path, value] of Object.entries(options.initialTags ?? {})) {
      this.tags.set(path, value);
    }
  }

  async connect(config: ControllerConnectionConfig = {}): Promise<ControllerConnectionSession> {
    const session: ControllerConnectionSession = {
      sessionId: `${this.id}.${++this.sequence}`,
      providerId: this.id,
      providerName: this.name,
      providerKind: this.kind,
      state: "simulation",
      runtimeMode: config.runtimeMode ?? "simulation",
      capabilities: this.capabilities,
      connectedAt: this.now(),
      ...(config.target ? { target: config.target } : {}),
    };
    this.sessions.set(session.sessionId, session);
    this.subscriptions.set(session.sessionId, new Map());
    return session;
  }

  async disconnect(sessionId: string): Promise<void> {
    this.assertSession(sessionId);
    this.sessions.delete(sessionId);
    this.subscriptions.delete(sessionId);
  }

  async readTag(sessionId: string, tagPath: string): Promise<RuntimeTagValue | undefined> {
    this.assertSession(sessionId);
    return this.tags.get(tagPath);
  }

  async writeTag(sessionId: string, tagPath: string, value: RuntimeTagValue): Promise<void> {
    this.assertSession(sessionId);
    this.tags.set(tagPath, value);
    const callbacks = this.subscriptions.get(sessionId)?.get(tagPath);
    for (const callback of callbacks ?? []) callback(value, tagPath);
  }

  subscribeTag(sessionId: string, tagPath: string, callback: TagCallback): Unsubscribe {
    this.assertSession(sessionId);
    const byTag = this.subscriptions.get(sessionId);
    if (!byTag) throw this.closedSessionError(sessionId);
    const callbacks = byTag.get(tagPath) ?? new Set<TagCallback>();
    callbacks.add(callback);
    byTag.set(tagPath, callbacks);
    return () => callbacks.delete(callback);
  }

  async getControllerState(sessionId: string): Promise<ControllerState> {
    const session = this.assertSession(sessionId);
    return {
      sessionId,
      state: session.state,
      runtimeMode: session.runtimeMode,
      providerName: this.name,
      message: "Connected to ESCO Simulator. No hardware controller is contacted.",
    };
  }

  private assertSession(sessionId: string): ControllerConnectionSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw this.closedSessionError(sessionId);
    return session;
  }

  private closedSessionError(sessionId: string): Error {
    return new Error(`Simulator session "${sessionId}" is not active.`);
  }
}

export class NoHardwareConnectionProvider implements ControllerConnectionProvider {
  readonly id = "esco.no-hardware";
  readonly name = "No Hardware Adapter";
  readonly kind = "unsupported-hardware" as const;
  readonly capabilities = NO_HARDWARE_CONNECTION_CAPABILITIES;

  async connect(_config: ControllerConnectionConfig = {}): Promise<ControllerConnectionSession> {
    throw this.unsupported("Connect to hardware");
  }

  async disconnect(_sessionId: string): Promise<void> {
    return undefined;
  }

  async readTag(_sessionId: string, _tagPath: string): Promise<RuntimeTagValue | undefined> {
    throw this.unsupported("Read hardware tag");
  }

  async writeTag(_sessionId: string, _tagPath: string, _value: RuntimeTagValue): Promise<void> {
    throw this.unsupported("Write hardware tag");
  }

  subscribeTag(_sessionId: string, _tagPath: string, _callback: TagCallback): Unsubscribe {
    throw this.unsupported("Subscribe to hardware tag");
  }

  async getControllerState(_sessionId: string): Promise<ControllerState> {
    throw this.unsupported("Read hardware controller state");
  }

  async restorePreviousRuntime(_sessionId: string): Promise<ControllerRestoreResult> {
    throw this.unsupported("Restore hardware runtime backup");
  }

  private unsupported(action: string): UnsupportedControllerConnectionError {
    return new UnsupportedControllerConnectionError(this.id, action);
  }
}

interface EscoSoftControllerConnectionProviderOptions {
  controller?: EscoSoftController;
  now?: () => string;
}

export class EscoSoftControllerConnectionProvider implements ControllerConnectionProvider {
  readonly id = "esco.soft-controller";
  readonly name = "ESCO SoftController";
  readonly kind = "soft-controller" as const;
  readonly capabilities = SOFT_CONTROLLER_CONNECTION_CAPABILITIES;

  private sequence = 0;
  private readonly now: () => string;
  private readonly controller: EscoSoftController;
  private readonly sessions = new Map<string, ControllerConnectionSession>();

  constructor(options: EscoSoftControllerConnectionProviderOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.controller = options.controller ?? new EscoSoftController({ now: this.now });
  }

  async connect(config: ControllerConnectionConfig = {}): Promise<ControllerConnectionSession> {
    const session: ControllerConnectionSession = {
      sessionId: `${this.id}.${++this.sequence}`,
      providerId: this.id,
      providerName: this.name,
      providerKind: this.kind,
      state: "soft-controller-connected",
      runtimeMode: config.runtimeMode ?? "soft-controller",
      capabilities: this.capabilities,
      connectedAt: this.now(),
      ...(config.target ? { target: config.target } : { target: this.controller.getIdentity().name }),
      backupAvailable: this.controller.status().backupAvailable,
      rollbackBackup: this.controller.status().backup,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async disconnect(sessionId: string): Promise<void> {
    this.assertSession(sessionId);
    this.sessions.delete(sessionId);
  }

  async readTag(sessionId: string, tagPath: string): Promise<RuntimeTagValue | undefined> {
    this.assertSession(sessionId);
    return this.controller.readTag(tagPath);
  }

  async writeTag(sessionId: string, tagPath: string, value: RuntimeTagValue): Promise<void> {
    this.assertSession(sessionId);
    if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
      throw new Error("ESCO SoftController tag writes currently support scalar boolean, number, or string values.");
    }
    const result = this.controller.writeTag(tagPath, value);
    if (!result.ok) throw new Error(result.message);
  }

  subscribeTag(sessionId: string, tagPath: string, callback: TagCallback): Unsubscribe {
    this.assertSession(sessionId);
    return this.controller.subscribeTag(tagPath, callback);
  }

  async getControllerState(sessionId: string): Promise<ControllerState> {
    this.assertSession(sessionId);
    return this.stateFor(sessionId, "Connected to ESCO SoftController. No physical hardware is contacted.");
  }

  /** Identity handshake — return the connected SoftController's identity. */
  async getIdentity(sessionId: string): Promise<SoftControllerIdentity> {
    this.assertSession(sessionId);
    return this.controller.getIdentity();
  }

  async getMode(sessionId: string): Promise<SoftControllerMode> {
    this.assertSession(sessionId);
    return this.controller.status().mode;
  }

  async getFaults(sessionId: string): Promise<SoftFault[]> {
    this.assertSession(sessionId);
    return this.controller.status().faults;
  }

  async downloadRuntimePackage(sessionId: string, text: string, fileName = "download.easruntime"): Promise<ControllerState> {
    this.assertSession(sessionId);
    const result = this.controller.loadRuntimeText(text, fileName);
    return this.stateFor(sessionId, result.message);
  }

  async restorePreviousRuntime(sessionId: string): Promise<ControllerRestoreResult> {
    this.assertSession(sessionId);
    const result = this.controller.restorePreviousRuntime();
    return {
      ...this.stateFor(sessionId, result.message),
      restored: result.restored,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.error ? { error: result.error } : {}),
      audit: result.audit,
    };
  }

  async uploadControllerImage(sessionId: string): Promise<SoftControllerImage> {
    this.assertSession(sessionId);
    const snapshot = this.controller.exportImage();
    if (!snapshot.runtimeText || !snapshot.runtime) {
      throw new Error("Cannot upload from ESCO SoftController: no runtime image is loaded.");
    }
    return snapshot;
  }

  async setMode(sessionId: string, mode: SoftControllerMode): Promise<ControllerState> {
    this.assertSession(sessionId);
    if (mode === "faulted") throw new Error("Faulted mode is a controller state, not an operator command.");
    const result = this.controller.setMode(mode);
    return this.stateFor(sessionId, result.message);
  }

  async clearFaults(sessionId: string): Promise<ControllerState> {
    this.assertSession(sessionId);
    const result = this.controller.clearFaults();
    return this.stateFor(sessionId, result.message);
  }

  async scanOnce(sessionId: string, deltaMs = 0): Promise<ControllerState> {
    this.assertSession(sessionId);
    const result = this.controller.scanOnce(deltaMs);
    return this.stateFor(sessionId, result.message);
  }

  private assertSession(sessionId: string): ControllerConnectionSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`ESCO SoftController session "${sessionId}" is not active.`);
    return session;
  }

  private stateFor(sessionId: string, message: string): ControllerState {
    const status = this.controller.status();
    return {
      sessionId,
      state: "soft-controller-connected",
      runtimeMode: "soft-controller",
      providerName: this.name,
      message,
      identity: status.identity,
      mode: status.mode,
      runtimeLoaded: status.runtimeLoaded,
      runtimeChecksum: status.runtime?.checksum,
      backupAvailable: status.backupAvailable,
      rollbackBackup: status.backup,
      faults: status.faults,
    };
  }
}
