import type { PlcProject } from "@esco/core";

export type OnlineConnectionState =
  | "offline"
  | "connecting"
  | "online-readonly"
  | "online-matched"
  | "online-mismatched"
  | "online-monitor"
  | "online-controlled-write"
  | "faulted"
  | "disconnected";

export const ONLINE_CONNECTION_STATE_LABELS: Record<OnlineConnectionState, string> = {
  offline: "Offline",
  connecting: "Connecting",
  "online-readonly": "Online Read-Only",
  "online-matched": "Online Matched",
  "online-mismatched": "Online Mismatched",
  "online-monitor": "Online Monitor",
  "online-controlled-write": "Online Controlled Write",
  faulted: "Faulted",
  disconnected: "Disconnected",
};

export function isOnlineState(state: OnlineConnectionState): boolean {
  return state.startsWith("online-");
}

export type ControllerDriverKind = "simulator" | "opcua" | "opcda" | "ethernetip" | "l5x";
export type PlcTargetVendor =
  | "esco"
  | "allen-bradley"
  | "siemens"
  | "codesys"
  | "beckhoff"
  | "schneider-modicon"
  | "omron"
  | "mitsubishi"
  | "ge-emerson"
  | "generic-device";
export type PlcDownloadStrategy =
  | "esco-runtime"
  | "ethernetip-cip-planned"
  | "opcua-data-only"
  | "vendor-file-export-planned"
  | "vendor-runtime-planned"
  | "fieldbus-data-only"
  | "telemetry-data-only";
export type PlcDownloadValidationState = "virtual-only" | "planned" | "software-wired" | "lab-verified" | "field-validated";
export type ControllerTransportValidation =
  | "none"
  | "software-wired"
  | "lab-verified"
  | "field-validated";
export type TargetAdapterDefaultMode = "read-only" | "simulation-only" | "controlled-write" | "download-capable";
export type TargetAdapterRiskLevel = "low" | "medium" | "high" | "critical";

export type TagPrimitive = boolean | number | string | null;
export type TagValuePayload = TagPrimitive | TagPrimitive[] | Record<string, TagPrimitive>;
export type TagQuality = "good" | "uncertain" | "bad" | "stale";
export type WritePermission = "granted" | "denied" | "not-configured";

export interface ConnectionConfig {
  endpointUrl?: string;
  path?: string;
  controllerName?: string;
  securityPolicy?: string;
  userName?: string;
  /** OPC UA browse root node for read-only tag discovery. */
  rootNodeId?: string;
  /** OPC UA explicit tag-name -> node-id mapping for sites with known nodes. */
  nodeMap?: Record<string, string>;
  /** OPC UA monitored-item sampling interval for read-only tag streams. */
  samplingIntervalMs?: number;
  simulatorProject?: PlcProject;
  /**
   * Offline project snapshot for the L5X import/export/sync driver path. This
   * is never a live controller transport config and must not be used by real
   * PLC drivers.
   */
  offlineProject?: PlcProject;
  metadata?: Record<string, unknown>;
}

export interface ControllerIdentity {
  controllerName?: string;
  controllerType?: string;
  firmwareRevision?: string;
  projectName?: string;
  projectSignature?: string;
  projectSignatureAlgorithm?: string;
  projectSignatureSource?: string;
  vendor?: string;
  productName?: string;
  serialNumber?: string;
}

export interface ControllerStatus {
  state: OnlineConnectionState;
  mode?: string;
  connected: boolean;
  health: "ok" | "warning" | "faulted" | "unknown";
  message: string;
  updatedAt: string;
}

export interface FaultInfo {
  id: string;
  severity: "info" | "warning" | "major" | "minor";
  message: string;
  source: string;
  timestamp: string;
  clearable: boolean;
}

export interface TagDefinition {
  name: string;
  dataType: string;
  scope?: "controller" | "program";
  writable: boolean;
  sourceDriver: ControllerDriverKind;
  address?: string;
}

export interface TagValue {
  tagName: string;
  value: TagValuePayload;
  dataType?: string;
  quality: TagQuality;
  timestamp: string;
  sourceDriver: ControllerDriverKind;
}

/**
 * Public ESCO online capability contract for a driver/session. Mutation
 * capabilities stay false until a reviewed write/download/edit/force path is
 * added end to end; optional driver methods only light up read-side features.
 */
export interface ControllerDriverCapabilities {
  canConnect: boolean;
  canReadStatus: boolean;
  canReadFaults: boolean;
  canBrowseTags: boolean;
  canReadTags: boolean;
  canBatchReadTags: boolean;
  canSubscribeTags: boolean;
  canUploadSnapshot: boolean;
  canCompareProject: boolean;
  canWriteTags: boolean;
  canDownloadProject: boolean;
  canOnlineEdit: boolean;
  canForceTags: boolean;
  canModeChange: boolean;
  canClearFaults: boolean;
}

/**
 * Readiness/evidence for the selected transport path. This is intentionally
 * separate from feature capabilities: a driver may be able to read tags in a
 * software test while still lacking plant validation evidence.
 */
export interface ControllerConnectionEvidence {
  transportValidation: ControllerTransportValidation;
  /** True when this path may exchange data with a physical controller. */
  realControllerIo: boolean;
  /** True only when physical-controller evidence exists for lab/field use. */
  hardwareValidated: boolean;
  /**
   * Honest shorthand for the declared validation level. For real controller I/O
   * this must remain false until lab/field validation evidence is attached.
   */
  verified: boolean;
  label: string;
  message: string;
  evidenceId?: string;
  validatedAt?: string;
  limitations: string[];
}

export interface ControllerDriverSummary {
  id: string;
  name: string;
  kind: ControllerDriverKind;
  capabilities: ControllerDriverCapabilities;
  connectionEvidence: ControllerConnectionEvidence;
  /** True when the public ESCO online/API surface exposes no tag-write path. */
  readOnly: boolean;
  safetyNote: string;
}

export interface TargetAdapterCapabilities {
  projectModelImport: boolean;
  projectModelExport: boolean;
  validate: boolean;
  compile: boolean;
  compareOfflineOnline: boolean;
  backup: boolean;
  uploadSnapshot: boolean;
  physicalDownload: boolean;
  onlineMonitor: boolean;
  onlineTagRead: boolean;
  onlineTagWrite: boolean;
  onlineEdit: boolean;
  modeChange: boolean;
  faultReset: boolean;
  ioTreeRead: boolean;
  ioTreeWrite: boolean;
  safetyControllerSupport: boolean;
  motionSupport: boolean;
}

export interface TargetAdapterSafetyProfile {
  executionAvailable: boolean;
  physicalDownloadEnabled: boolean;
  verified: boolean;
  requiresBackupBeforeDownload: boolean;
  requiresCompareBeforeDownload: boolean;
  requiresExplicitUserApproval: boolean;
  supportsDryRun: boolean;
  defaultMode: TargetAdapterDefaultMode;
  riskLevel: TargetAdapterRiskLevel;
  safetyMessage: string;
}

/**
 * Vendor-neutral target adapter metadata. This is descriptive only for browser
 * clients: there is no function handle, no physical PLC execution route, and no
 * way for these descriptors to enable `canDownloadProject` in the public
 * gateway capability contract.
 */
export interface TargetAdapterMetadata {
  id: string;
  name: string;
  vendor: PlcTargetVendor;
  families: string[];
  strategy: PlcDownloadStrategy;
  validationState: PlcDownloadValidationState;
  capabilities: TargetAdapterCapabilities;
  safety: TargetAdapterSafetyProfile;
  /** Compatibility mirror of `safety.executionAvailable` for older clients. */
  executionAvailable: boolean;
  /** Compatibility mirror of `safety.physicalDownloadEnabled` for older clients. */
  physicalDownloadEnabled: boolean;
  /** Compatibility mirror of `safety.verified` for older clients. */
  verified: boolean;
  realControllerIo: boolean;
  notes: string;
  blockedReason?: string;
  requiredGates: string[];
}

export interface TargetAdapterOperationRequest {
  localProject?: PlcProject;
  config?: ConnectionConfig;
  metadata?: Record<string, unknown>;
}

export interface TargetAdapterOperationResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface DownloadPreflightRequest extends TargetAdapterOperationRequest {
  targetAdapterId: string;
  requestedBy?: string;
  confirmed?: boolean;
  dryRun?: boolean;
}

export type DownloadPreflightGateState = "passed" | "blocked" | "not-run";

export interface DownloadPreflightGateResult {
  gate: string;
  state: DownloadPreflightGateState;
  required: boolean;
  message: string;
}

export interface DownloadPreflightResult {
  targetAdapterId: string;
  ok: boolean;
  physicalDownloadAllowed: boolean;
  executionAvailable: boolean;
  physicalDownloadEnabled: boolean;
  verified: boolean;
  defaultMode: TargetAdapterDefaultMode;
  riskLevel: TargetAdapterRiskLevel;
  requiredGates: string[];
  gateResults: DownloadPreflightGateResult[];
  blockers: string[];
  warnings: string[];
  message: string;
  checkedAt: string;
}

export interface TargetAdapter {
  readonly metadata: TargetAdapterMetadata;
  preflightDownload(request: DownloadPreflightRequest): Promise<DownloadPreflightResult>;
  validate?(request: TargetAdapterOperationRequest): Promise<TargetAdapterOperationResult>;
  compile?(request: TargetAdapterOperationRequest): Promise<TargetAdapterOperationResult>;
  compareOfflineOnline?(request: TargetAdapterOperationRequest): Promise<TargetAdapterOperationResult>;
  backup?(request: TargetAdapterOperationRequest): Promise<TargetAdapterOperationResult>;
  uploadSnapshot?(request: TargetAdapterOperationRequest): Promise<ProjectSnapshot>;
}

export interface TargetAdapterRegistry {
  listMetadata(): TargetAdapterMetadata[];
  getMetadata(id: string): TargetAdapterMetadata | undefined;
  preflightDownload(request: DownloadPreflightRequest): Promise<DownloadPreflightResult>;
}

export interface ExecutableTargetAdapterRegistry extends TargetAdapterRegistry {
  listExecutableMetadata(): TargetAdapterMetadata[];
  getExecutableAdapter(id: string): TargetAdapter | undefined;
  register(adapter: TargetAdapter): void;
}

export type PlcDownloadAdapterDescriptor = TargetAdapterMetadata;

export interface WriteResult {
  ok: boolean;
  message: string;
  readBack?: TagValue;
  auditId: string;
}

export interface SubscriptionHandle {
  id: string;
  unsubscribe(): Promise<void>;
}

/**
 * Result of a batched read-only tag poll. Per-tag failures land in `errors`
 * (keyed by tag name) so one bad tag never blanks a whole watch table.
 */
export interface BatchTagReadResult {
  values: TagValue[];
  errors: Record<string, string>;
}

export interface ProjectSnapshot {
  id: string;
  capturedAt: string;
  sourceDriver: ControllerDriverKind;
  identity: ControllerIdentity;
  connectionEvidence?: ControllerConnectionEvidence;
  tags: TagValue[];
  raw?: unknown;
}

export interface CompareDifference {
  field: "controllerName" | "controllerType" | "firmwareRevision" | "projectName" | "projectSignature";
  local?: string;
  online?: string;
  severity: "warning" | "blocking";
}

export interface CompareResult {
  state: "matched" | "mismatched" | "unknown";
  matched: boolean;
  localIdentity?: ControllerIdentity;
  controllerIdentity?: ControllerIdentity;
  differences: CompareDifference[];
  message: string;
}

export interface ConnectionResult {
  ok: boolean;
  state: OnlineConnectionState;
  message: string;
  identity?: ControllerIdentity;
  status?: ControllerStatus;
  compare?: CompareResult;
  connectionEvidence?: ControllerConnectionEvidence;
}

export type TagSubscriptionCallback = (value: TagValue) => void;

export interface ControllerDriver {
  id: string;
  name: string;
  kind: ControllerDriverKind;
  /** Optional read-side overrides for drivers whose required methods are placeholders. */
  capabilities?: Partial<ControllerDriverCapabilities>;
  /** Optional transport validation evidence shown by the gateway/API/UI. */
  connectionEvidence?: ControllerConnectionEvidence;
  connect(config: ConnectionConfig): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  getIdentity(): Promise<ControllerIdentity>;
  getStatus(): Promise<ControllerStatus>;
  getFaults(): Promise<FaultInfo[]>;
  browseTags?(): Promise<TagDefinition[]>;
  readTag(tagName: string): Promise<TagValue>;
  /**
   * Optional efficient batch read (e.g. one CIP Multiple Service Packet per
   * chunk). When absent, the gateway falls back to per-tag `readTag` calls.
   */
  readTags?(tagNames: string[]): Promise<BatchTagReadResult>;
  writeTag?(tagName: string, value: TagValuePayload): Promise<WriteResult>;
  subscribeTags?(tagNames: string[], callback: TagSubscriptionCallback): Promise<SubscriptionHandle>;
  uploadSnapshot?(): Promise<ProjectSnapshot>;
  compareProject?(localProject: PlcProject): Promise<CompareResult>;
}

export interface ControlledWriteRequest {
  tagName: string;
  value: TagValuePayload;
  confirmed: boolean;
  permission: WritePermission;
  reason: string;
}

export interface OnlineAuditEntry {
  id: string;
  at: string;
  action: string;
  state: OnlineConnectionState;
  driverId?: string;
  result: "ran" | "blocked" | "failed";
  message: string;
  details?: Record<string, unknown>;
}
