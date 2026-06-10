import type { PlcProject } from "@esco/core";

/**
 * Browser-side JSON contract for `/api/gateway`.
 *
 * Keep this file as data shapes only. The web app must not import
 * `@esco/controller-gateway` or any PLC driver package directly; those live in
 * `apps/api` and backend-only packages.
 */

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

export type ControllerDriverKind = "simulator" | "opcua" | "opcda" | "ethernetip" | "l5x";
export type ControllerTransportValidation = "none" | "software-wired" | "lab-verified" | "field-validated";
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
export type TargetAdapterDefaultMode = "read-only" | "simulation-only" | "controlled-write" | "download-capable";
export type TargetAdapterRiskLevel = "low" | "medium" | "high" | "critical";

export type TagPrimitive = boolean | number | string | null;
export type TagValuePayload = TagPrimitive | TagPrimitive[] | Record<string, TagPrimitive>;
export type TagQuality = "good" | "uncertain" | "bad" | "stale";

export interface ConnectionConfig {
  endpointUrl?: string;
  path?: string;
  controllerName?: string;
  securityPolicy?: string;
  userName?: string;
  rootNodeId?: string;
  nodeMap?: Record<string, string>;
  samplingIntervalMs?: number;
  simulatorProject?: PlcProject;
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

export interface ControllerConnectionEvidence {
  transportValidation: ControllerTransportValidation;
  realControllerIo: boolean;
  hardwareValidated: boolean;
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

export interface TargetAdapterMetadata {
  id: string;
  name: string;
  vendor: PlcTargetVendor;
  families: string[];
  strategy: PlcDownloadStrategy;
  validationState: PlcDownloadValidationState;
  capabilities: TargetAdapterCapabilities;
  safety: TargetAdapterSafetyProfile;
  executionAvailable: boolean;
  physicalDownloadEnabled: boolean;
  verified: boolean;
  realControllerIo: boolean;
  notes: string;
  blockedReason?: string;
  requiredGates: string[];
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

export type DownloadPreflightGateState = "passed" | "blocked" | "not-run";

export interface DownloadPreflightGateResult {
  gate: string;
  state: DownloadPreflightGateState;
  required: boolean;
  message: string;
}

export type PlcDownloadAdapterDescriptor = TargetAdapterMetadata;

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

export interface OnlineSnapshot {
  /** Normalized ESCO online session id shared by JSON and SSE gateway routes. */
  sessionId?: string;
  state: OnlineConnectionState;
  driverId?: string;
  driverName?: string;
  identity?: ControllerIdentity;
  compare?: CompareResult;
  capabilities?: ControllerDriverCapabilities;
  connectionEvidence?: ControllerConnectionEvidence;
  readOnly: boolean;
  readOnlyReason?: string;
}
