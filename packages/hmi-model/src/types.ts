export type HmiSurfaceKind = "screen" | "popup" | "system-banner" | "add-on-graphic";

export type HmiBindingSourceKind = "tag" | "expression" | "property" | "system-tag";

export type HmiCommandSafety = "runtime-preview" | "model-only" | "hardware-only" | "unsupported";

export type HmiElementCategory =
  | "common"
  | "alarms"
  | "diagnostics"
  | "navigation"
  | "trends"
  | "media"
  | "system"
  | "unsupported";

export interface HmiDeviceProfile {
  id: string;
  family: string;
  name: string;
  firmwareRevision?: string;
  width: number;
  height: number;
  dpi: number;
  colorDepth: number;
  supportsTouch: boolean;
  supportedFeatures: string[];
  capacity: {
    maxScreens: number;
    maxElementsPerScreen: number;
    maxTrends: number;
    maxDataLogs: number;
    maxRecipes: number;
    storageMb: number;
  };
}

export type HmiControllerReferenceSourceKind =
  | "plcproj"
  | "xml-review"
  | "secured-offline-reference"
  | "manual"
  | "unknown";

export type HmiControllerReferenceSyncStatus =
  | "not-imported"
  | "synchronizing"
  | "synchronized"
  | "stale"
  | "conflict"
  | "error"
  | "unsupported-source"
  | "secured";

export interface HmiControllerReferenceTag {
  path: string;
  name: string;
  dataType: string;
  scope: "controller" | "program";
  programName?: string;
  externalAccess?: string;
  constant?: boolean;
  produced?: boolean;
  consumed?: boolean;
  description?: string;
}

export interface HmiControllerReferenceDataType {
  name: string;
  family?: "udt" | "aoi" | "atomic" | "unknown";
  memberCount?: number;
  description?: string;
}

export interface HmiControllerReferenceAlarm {
  name: string;
  tagPath: string;
  kind: "analog" | "digital" | "unknown";
  dataType: string;
  scope: "controller" | "program";
  programName?: string;
  description?: string;
}

export interface HmiControllerReferenceSnapshot {
  controllerTagCount: number;
  programTagCount: number;
  dataTypeCount: number;
  alarmCount: number;
}

export interface HmiControllerReference {
  id: string;
  name: string;
  controllerName: string;
  sourceKind: HmiControllerReferenceSourceKind;
  sourcePath?: string;
  sourceProjectId?: string;
  sourceControllerId?: string;
  sourceHash?: string;
  syncStatus: HmiControllerReferenceSyncStatus;
  statusMessage?: string;
  lastSyncedAt?: string;
  secured?: boolean;
  snapshot: HmiControllerReferenceSnapshot;
  tags: HmiControllerReferenceTag[];
  dataTypes: HmiControllerReferenceDataType[];
  alarms: HmiControllerReferenceAlarm[];
}

export interface HmiGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface HmiStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  opacity?: number;
}

export interface HmiBindingSource {
  kind: HmiBindingSourceKind;
  path: string;
  dataType?: string;
}

export interface HmiPropertyBinding {
  id: string;
  targetProperty: string;
  source: HmiBindingSource;
  mode: "read" | "write" | "read-write";
}

export interface HmiCommand {
  id: string;
  type:
    | "navigate"
    | "open-popup"
    | "close-popup"
    | "set-tag-value"
    | "change-language"
    | "export-data-log"
    | "clear-data-log"
    | "apply-recipe"
    | "login-user"
    | "logout-user"
    | "device-command"
    | "unknown";
  safety: HmiCommandSafety;
  args: Record<string, unknown>;
  preservedType?: string;
}

export interface HmiEventHandler {
  id: string;
  eventType: "press" | "release" | "state-enter" | "state-exit" | "value-change" | "load" | "unload";
  commands: HmiCommand[];
}

export type HmiRuntimeCommandStatus = "applied" | "blocked" | "ignored";
export type HmiRuntimeCommandEffect =
  | { kind: "navigate"; screenId: string; previousScreenId?: string }
  | { kind: "open-popup"; popupId: string }
  | { kind: "close-popup"; popupId?: string }
  | { kind: "change-language"; languageId: string }
  | { kind: "tag-write-preview"; tagPath: string; value: unknown }
  | { kind: "data-log-export"; dataLogId: string }
  | { kind: "data-log-clear"; dataLogId: string }
  | { kind: "apply-recipe"; recipeId: string }
  | { kind: "login-user"; username: string; roleIds: string[] }
  | { kind: "logout-user"; roleIds: string[] };

export interface HmiRuntimeCommandResult {
  commandId: string;
  type: HmiCommand["type"];
  status: HmiRuntimeCommandStatus;
  message: string;
  effect?: HmiRuntimeCommandEffect;
}

export interface HmiRuntimeSession {
  projectId: string;
  projectName: string;
  currentScreenId?: string;
  currentScreenName?: string;
  previousScreenId?: string;
  previousScreenName?: string;
  currentLanguage: string;
  currentUserName: string;
  currentUserFullName: string;
  activeRoleIds: string[];
  activeRoleNames: string[];
  securityAuthority: "guest" | "local-user" | "manual-preview" | "none";
  popupStack: Array<{ popupId: string; popupName: string }>;
  commandLog: HmiRuntimeCommandResult[];
  blockedCommandCount: number;
  systemTags: {
    "System.CurrentScreen": string;
    "System.PreviousScreen": string;
    "System.CurrentLanguage": string;
    "System.ProjectName": string;
    "System.CurrentUser": string;
    "System.CurrentUserFullName": string;
    "System.SecurityAuthority": string;
  };
}

export interface HmiAnimation {
  id: string;
  targetProperty: string;
  source: HmiBindingSource;
  table:
    | { kind: "color"; states: Array<{ value: string | number | boolean; color: string }> }
    | { kind: "state"; states: Array<{ value: string | number | boolean; state: string }> };
}

export interface HmiGraphicElement {
  id: string;
  typeId: string;
  name: string;
  geometry: HmiGeometry;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  style?: HmiStyle;
  properties: Record<string, unknown>;
  bindings: HmiPropertyBinding[];
  events: HmiEventHandler[];
  animations: HmiAnimation[];
  unsupported?: {
    originalType: string;
    preservedPayload?: unknown;
    readonlyReason: string;
  };
}

export interface HmiSurfaceBase {
  id: string;
  name: string;
  kind: HmiSurfaceKind;
  width: number;
  height: number;
  background: string;
  updateRateMs: number;
  securityRoleIds: string[];
  elements: HmiGraphicElement[];
}

export interface HmiScreen extends HmiSurfaceBase {
  kind: "screen";
  navigation?: {
    includeInMenu: boolean;
    caption?: string;
    icon?: string;
  };
}

export interface HmiPopup extends HmiSurfaceBase {
  kind: "popup";
  caption: string;
  showCloseButton: boolean;
  opacity: number;
  cachePolicy: "none" | "preload";
}

export interface HmiSystemBanner extends HmiSurfaceBase {
  kind: "system-banner";
  dock: "top" | "bottom";
  restoreDefaultAvailable: boolean;
}

export interface HmiShortcut {
  id: string;
  name: string;
  targetKind: "screen" | "popup";
  targetId: string;
  caption: string;
  icon?: string;
  folder?: string;
  securityRoleIds: string[];
}

export type HmiNavigationItemSource = "screen" | "shortcut";

export interface HmiNavigationItem {
  id: string;
  source: HmiNavigationItemSource;
  label: string;
  icon?: string;
  folder?: string;
  targetKind: "screen" | "popup";
  targetId: string;
  targetName?: string;
  commandType: "navigate" | "open-popup";
  securityRoleIds: string[];
  visible: boolean;
  hiddenReason?: "screen-omitted" | "missing-target" | "security";
}

export interface HmiNavigationFolder {
  name: string;
  items: HmiNavigationItem[];
}

export interface HmiNavigationModel {
  homeScreenId?: string;
  homeScreenName?: string;
  items: HmiNavigationItem[];
  folders: HmiNavigationFolder[];
  omittedScreenIds: string[];
  deadEndScreenIds: string[];
  missingTargetCount: number;
  hiddenBySecurityCount: number;
}

export interface HmiNavigationProjectionOptions {
  activeRoleIds?: string[];
  includeHidden?: boolean;
}

export interface HmiAsset {
  id: string;
  name: string;
  kind: "image" | "pdf";
  mimeType?: string;
  hash?: string;
  bytes?: number;
  references: string[];
  unsupported?: boolean;
}

export interface HmiAddOnGraphicDefinition {
  id: string;
  name: string;
  vendor?: string;
  revision?: string;
  width: number;
  height: number;
  properties: Array<{ name: string; dataType: string; required?: boolean; defaultValue?: unknown }>;
  elements: HmiGraphicElement[];
  unsupported?: boolean;
}

export type HmiButtonControlSignalQuality = "good" | "bad" | "missing" | "unconfigured";
export type HmiButtonControlPreviewState =
  | "unconfigured"
  | "idle"
  | "commanded"
  | "feedback-active"
  | "mismatch"
  | "bad-quality";

export interface HmiButtonControlPreviewSignal {
  tagPath?: string;
  value: string | number | boolean | null;
  quality: HmiButtonControlSignalQuality;
  active: boolean;
}

export interface HmiButtonControlPreviewInput {
  timestampMs: number;
  values: Record<string, string | number | boolean | null | undefined>;
  pressed?: boolean;
}

export interface HmiButtonControlRuntimePreview {
  elementId: string;
  label: string;
  timestampMs: number;
  pressed: boolean;
  visualFeedbackEnabled: boolean;
  state: HmiButtonControlPreviewState;
  active: boolean;
  message: string;
  command: HmiButtonControlPreviewSignal;
  feedback: HmiButtonControlPreviewSignal;
  status: HmiButtonControlPreviewSignal;
}

export interface HmiAlarmView {
  id: string;
  name: string;
  kind: "summary" | "manager" | "history";
  columns: string[];
  filter?: string;
  sort?: string;
  securityRoleIds: string[];
}

export type HmiAlarmSeverity = "info" | "warning" | "minor" | "major" | "critical";
export type HmiAlarmTriggerKind = "digital" | "analog-high" | "analog-low";

export interface HmiAlarmTrigger {
  kind: HmiAlarmTriggerKind;
  activeValue?: boolean | number | string;
  threshold?: number;
  deadband?: number;
}

export interface HmiAlarmDefinition {
  id: string;
  name: string;
  tagPath: string;
  severity: HmiAlarmSeverity;
  trigger: HmiAlarmTrigger;
  message?: string;
  area?: string;
  allowAcknowledge: boolean;
  helpText?: string;
  enabled?: boolean;
}

export type HmiAlarmQuality = "good" | "bad" | "missing";
export type HmiAlarmState =
  | "normal"
  | "active-unacknowledged"
  | "active-acknowledged"
  | "returned-unacknowledged"
  | "suppressed";

export interface HmiAlarmRuntimeRecord {
  alarmId: string;
  name: string;
  tagPath: string;
  severity: HmiAlarmSeverity;
  message?: string;
  area?: string;
  allowAcknowledge: boolean;
  state: HmiAlarmState;
  active: boolean;
  acknowledged: boolean;
  suppressed: boolean;
  quality: HmiAlarmQuality;
  value: string | number | boolean | null;
  activeSinceMs?: number;
  returnTimestampMs?: number;
  acknowledgedTimestampMs?: number;
  suppressedTimestampMs?: number;
  resetTimestampMs?: number;
  lastTransitionMs?: number;
  disabled?: boolean;
}

export type HmiAlarmHistoryEventType =
  | "activated"
  | "returned"
  | "acknowledged"
  | "reset"
  | "suppressed"
  | "unsuppressed"
  | "quality-changed";

export interface HmiAlarmHistoryEvent {
  alarmId: string;
  timestampMs: number;
  eventType: HmiAlarmHistoryEventType;
  state: HmiAlarmState;
  quality: HmiAlarmQuality;
  value: string | number | boolean | null;
  message?: string;
}

export type HmiAlarmTableVariant = HmiAlarmView["kind"];

export interface HmiAlarmTableRow {
  id: string;
  alarmId: string;
  name: string;
  tagPath: string;
  severity: HmiAlarmSeverity;
  state: HmiAlarmState;
  quality: HmiAlarmQuality;
  value: string | number | boolean | null;
  message?: string;
  area?: string;
  active: boolean;
  acknowledged: boolean;
  suppressed: boolean;
  allowAcknowledge: boolean;
  disabled?: boolean;
  timestampMs?: number;
  activeSinceMs?: number;
  returnTimestampMs?: number;
  acknowledgedTimestampMs?: number;
  suppressedTimestampMs?: number;
  resetTimestampMs?: number;
  eventType?: HmiAlarmHistoryEventType;
}

export interface HmiAlarmRuntimeSummary {
  activeCount: number;
  unacknowledgedCount: number;
  acknowledgedCount: number;
  suppressedCount: number;
  badQualityCount: number;
  systemTags: {
    "System.AlarmActiveCount": number;
    "System.AlarmUnacknowledgedCount": number;
    "System.AlarmAcknowledgedCount": number;
    "System.AlarmSuppressedCount": number;
  };
}

export interface HmiAlarmRuntime {
  alarms: HmiAlarmRuntimeRecord[];
  history: HmiAlarmHistoryEvent[];
  summary: HmiAlarmRuntimeSummary;
}

export interface HmiAlarmRuntimeInput {
  timestampMs: number;
  values: Record<string, string | number | boolean | null | undefined>;
}

export interface HmiAlarmOperationInput {
  timestampMs: number;
  alarmIds?: string[];
}

export interface HmiDiagnosticsView {
  id: string;
  name: string;
  columns: string[];
  defaultFilter?: string;
}

export type HmiDiagnosticsSourceKind = "validation" | "import" | "runtime" | "hardware-metadata" | "system";
export type HmiDiagnosticsSeverity = "error" | "warning" | "info";
export type HmiDiagnosticsStatus = "active" | "cleared";
export type HmiDiagnosticsTableVariant = "live" | "history";

export interface HmiDiagnosticEventInput {
  id?: string;
  timestampMs: number;
  source: HmiDiagnosticsSourceKind;
  severity: HmiDiagnosticsSeverity;
  code: string;
  message: string;
  target?: string;
  details?: Record<string, unknown>;
}

export interface HmiDiagnosticEvent {
  id: string;
  firstSeenTimestampMs: number;
  lastSeenTimestampMs: number;
  clearedTimestampMs?: number;
  source: HmiDiagnosticsSourceKind;
  severity: HmiDiagnosticsSeverity;
  code: string;
  message: string;
  target?: string;
  details?: Record<string, unknown>;
  status: HmiDiagnosticsStatus;
  occurrences: number;
}

export interface HmiDiagnosticsRuntimeSummary {
  activeCount: number;
  historyCount: number;
  activeErrorCount: number;
  activeWarningCount: number;
  activeInfoCount: number;
  sourceCounts: Record<HmiDiagnosticsSourceKind, number>;
}

export interface HmiDiagnosticsRuntime {
  active: HmiDiagnosticEvent[];
  history: HmiDiagnosticEvent[];
  maxHistory: number;
  summary: HmiDiagnosticsRuntimeSummary;
}

export interface HmiDiagnosticsRuntimeOptions {
  maxHistory?: number;
}

export interface HmiDiagnosticsClearInput {
  timestampMs: number;
  ids?: string[];
  source?: HmiDiagnosticsSourceKind;
}

export interface HmiDiagnosticsTableRow {
  id: string;
  timestampMs: number;
  status: HmiDiagnosticsStatus;
  source: HmiDiagnosticsSourceKind;
  severity: HmiDiagnosticsSeverity;
  code: string;
  message: string;
  target?: string;
  occurrences: number;
  clearedTimestampMs?: number;
}

export interface HmiTrend {
  id: string;
  name: string;
  timeRangeSeconds: number;
  sampleRateMs: number;
  traces: Array<{ id: string; label: string; source: HmiBindingSource; color: string }>;
}

export type HmiTrendSampleQuality = "good" | "bad" | "missing";

export interface HmiTrendBufferedPoint {
  timestampMs: number;
  value: number | null;
  quality: HmiTrendSampleQuality;
}

export interface HmiTrendBufferTrace {
  id: string;
  label: string;
  sourcePath: string;
  color: string;
  points: HmiTrendBufferedPoint[];
}

export interface HmiTrendBuffer {
  trendId: string;
  trendName: string;
  sampleRateMs: number;
  timeRangeSeconds: number;
  traces: HmiTrendBufferTrace[];
  lastSampleTimestampMs?: number;
}

export interface HmiTrendSampleInput {
  timestampMs: number;
  values: Record<string, number | boolean | null | undefined>;
  force?: boolean;
}

export interface HmiTrendSampleResult {
  accepted: boolean;
  buffer: HmiTrendBuffer;
  skippedReason?: string;
}

export interface HmiTrendExportResult {
  fileName: string;
  text: string;
  rowCount: number;
}

export interface HmiTrendChartRenderPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HmiTrendChartRenderOptions {
  width?: number;
  height?: number;
  padding?: Partial<HmiTrendChartRenderPadding>;
  nowTimestampMs?: number;
  valueMin?: number;
  valueMax?: number;
}

export interface HmiTrendChartPlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HmiTrendChartAxisTick {
  value: number;
  position: number;
  label: string;
}

export interface HmiTrendChartTimeAxis {
  startTimestampMs: number;
  endTimestampMs: number;
  ticks: HmiTrendChartAxisTick[];
}

export interface HmiTrendChartValueAxis {
  min: number;
  max: number;
  ticks: HmiTrendChartAxisTick[];
}

export interface HmiTrendChartPoint {
  timestampMs: number;
  value: number | null;
  quality: HmiTrendSampleQuality;
  x: number;
  y: number | null;
}

export interface HmiTrendChartSeries {
  traceId: string;
  label: string;
  sourcePath: string;
  color: string;
  points: HmiTrendChartPoint[];
  path: string;
}

export interface HmiTrendChartPreview {
  trendId: string;
  trendName: string;
  width: number;
  height: number;
  padding: HmiTrendChartRenderPadding;
  plotArea: HmiTrendChartPlotArea;
  timeAxis: HmiTrendChartTimeAxis;
  valueAxis: HmiTrendChartValueAxis;
  series: HmiTrendChartSeries[];
  emptyMessage?: string;
}

export interface HmiDataLog {
  id: string;
  name: string;
  sampleRateMs: number;
  retentionHours: number;
  tagPaths: string[];
  statusTagPath?: string;
}

export type HmiDataLogSampleQuality = "good" | "bad" | "missing";
export type HmiDataLogStatus = "idle" | "recording" | "skipped" | "cleared";

export interface HmiDataLogBufferedValue {
  value: string | number | boolean | null;
  quality: HmiDataLogSampleQuality;
}

export interface HmiDataLogBufferedRow {
  timestampMs: number;
  values: Record<string, HmiDataLogBufferedValue>;
}

export interface HmiDataLogBuffer {
  dataLogId: string;
  dataLogName: string;
  sampleRateMs: number;
  retentionHours: number;
  tagPaths: string[];
  rows: HmiDataLogBufferedRow[];
  lastSampleTimestampMs?: number;
  status: HmiDataLogStatus;
  statusMessage: string;
}

export interface HmiDataLogSampleInput {
  timestampMs: number;
  values: Record<string, string | number | boolean | null | undefined>;
  force?: boolean;
}

export interface HmiDataLogSampleResult {
  accepted: boolean;
  buffer: HmiDataLogBuffer;
  skippedReason?: string;
}

export interface HmiDataLogExportResult {
  fileName: string;
  text: string;
  rowCount: number;
}

export type HmiDataLogMediaKind = "local-folder" | "usb" | "sd-card" | "network-share";
export type HmiDataLogMediaSaveStatus = "saved" | "blocked";

export interface HmiDataLogMediaTarget {
  kind: HmiDataLogMediaKind;
  label: string;
  rootPath: string;
  mounted: boolean;
  availableBytes?: number;
}

export interface HmiDataLogMediaSaveOptions {
  target: HmiDataLogMediaTarget;
  directory?: string;
  savedAt?: string;
}

export interface HmiDataLogMediaFile {
  fileName: string;
  path: string;
  rowCount: number;
  byteLength: number;
  savedAt: string;
  mediaKind: HmiDataLogMediaKind;
  mediaLabel: string;
  checksumAlgorithm: "fnv1a32-text";
  contentChecksum: string;
}

export interface HmiDataLogMediaSaveResult {
  ok: boolean;
  status: HmiDataLogMediaSaveStatus;
  message: string;
  file?: HmiDataLogMediaFile;
}

export type HmiRecipeValue = string | number | boolean | null;

export interface HmiRecipeItem {
  id: string;
  tagPath: string;
  value: HmiRecipeValue;
  dataType?: string;
  description?: string;
}

export interface HmiRecipe {
  id: string;
  name: string;
  description?: string;
  items: HmiRecipeItem[];
  securityRoleIds: string[];
}

export type HmiRecipeApplyRowStatus = "applied" | "failed" | "skipped" | "rolled-back";

export interface HmiRecipeApplyRow {
  itemId: string;
  tagPath: string;
  value: HmiRecipeValue;
  status: HmiRecipeApplyRowStatus;
  message: string;
}

export interface HmiRecipeApplyResult {
  recipeId: string;
  recipeName: string;
  timestampMs: number;
  appliedCount: number;
  failedCount: number;
  rows: HmiRecipeApplyRow[];
}

export interface HmiLanguagePack {
  id: string;
  languageId: string;
  displayName: string;
  strings: Record<string, string>;
  missingStringIds: string[];
  importExport?: {
    format: "esco-language-csv";
    sourceFileName?: string;
    importedAt?: string;
    exportedAt?: string;
    checksumAlgorithm?: "fnv1a32-csv";
    contentChecksum?: string;
  };
}

export interface HmiSecurityRole {
  id: string;
  name: string;
  permissions: string[];
}

export interface HmiSecurityUser {
  id: string;
  username: string;
  roleIds: string[];
  fullName?: string;
  disabled?: boolean;
}

export interface HmiSecurityModel {
  roles: HmiSecurityRole[];
  users: HmiSecurityUser[];
  guestRoleId?: string;
  autoLogoffSeconds: number;
  passwordPolicy: {
    minimumLength: number;
    requireComplexity: boolean;
    expirationDays?: number;
  };
}

export interface HmiUnsupportedContent {
  id: string;
  sourcePath: string;
  kind: string;
  displayName: string;
  preservedPayload?: unknown;
  readonlyReason: string;
}

export type HmiCapacityMetricStatus = "ok" | "warning" | "exceeded" | "unknown";

export interface HmiUsageCapacityMetric {
  key: "screens" | "largest-surface-elements" | "trends" | "data-logs" | "recipes" | "storage";
  label: string;
  used: number;
  limit: number;
  unit: string;
  status: HmiCapacityMetricStatus;
  percent?: number;
  message: string;
}

export type HmiSurfaceScalingStatus = "native" | "scaled" | "oversized";

export interface HmiSurfaceUsage {
  id: string;
  kind: HmiSurfaceKind;
  name: string;
  width: number;
  height: number;
  elementCount: number;
  elementStatus: HmiCapacityMetricStatus;
  displayScaleX: number;
  displayScaleY: number;
  scalingStatus: HmiSurfaceScalingStatus;
  rasterScalingRiskCount: number;
}

export interface HmiUsageCapacityReport {
  targetDevice: {
    id: string;
    name: string;
    width: number;
    height: number;
    storageBytes: number;
  };
  metrics: HmiUsageCapacityMetric[];
  surfaces: HmiSurfaceUsage[];
  knownAssetBytes: number;
  estimatedLanguageBytes: number;
  estimatedDataLogBytes: number;
  estimatedStorageBytes: number;
  warningCount: number;
  exceededCount: number;
  scalingRiskCount: number;
}

export interface HmiProject {
  schemaVersion: 1;
  id: string;
  name: string;
  targetDevice: HmiDeviceProfile;
  defaultLanguage: string;
  controllerReferences: HmiControllerReference[];
  homeScreenId?: string;
  screens: HmiScreen[];
  popups: HmiPopup[];
  systemBanner: HmiSystemBanner;
  shortcuts: HmiShortcut[];
  assets: HmiAsset[];
  addOnGraphics: HmiAddOnGraphicDefinition[];
  alarms: HmiAlarmDefinition[];
  alarmViews: HmiAlarmView[];
  diagnosticsViews: HmiDiagnosticsView[];
  trends: HmiTrend[];
  dataLogs: HmiDataLog[];
  recipes: HmiRecipe[];
  languagePacks: HmiLanguagePack[];
  security: HmiSecurityModel;
  unsupportedContent: HmiUnsupportedContent[];
  createdAt: string;
  updatedAt: string;
}

export interface HmiElementPropertyDefinition {
  name: string;
  label: string;
  dataType: "string" | "number" | "boolean" | "color" | "tag-path" | "screen-id" | "asset-id";
  defaultValue?: unknown;
  bindable?: boolean;
}

export interface HmiElementDefinition {
  typeId: string;
  displayName: string;
  category: HmiElementCategory;
  defaultGeometry: HmiGeometry;
  defaultStyle?: HmiStyle;
  properties: HmiElementPropertyDefinition[];
  events: HmiEventHandler["eventType"][];
  runtimeSupport: "runtime-preview" | "model-only" | "unsupported";
  description: string;
}

export type HmiValidationSeverity = "error" | "warning" | "info";

export interface HmiValidationFinding {
  ruleId: string;
  severity: HmiValidationSeverity;
  message: string;
  target?: string;
}

export interface HmiValidationContext {
  knownTagPaths?: string[];
  knownSystemTags?: string[];
}

export type HmiRuntimePackageStatus = "ready" | "blocked";

export interface HmiRuntimePackageSummary {
  controllerReferenceCount: number;
  screenCount: number;
  popupCount: number;
  systemBannerElementCount: number;
  addOnGraphicCount: number;
  elementCount: number;
  assetCount: number;
  knownAssetBytes: number;
  alarmCount: number;
  trendCount: number;
  dataLogCount: number;
  recipeCount: number;
  languagePackCount: number;
  securityRoleCount: number;
  unsupportedContentCount: number;
  modelOnlyElementCount: number;
}

export interface HmiRuntimePackageVerificationSummary {
  status: HmiRuntimePackageStatus;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: HmiValidationFinding[];
}

export interface HmiRuntimePackageTargetDevice {
  id: string;
  family: string;
  name: string;
  firmwareRevision?: string;
  width: number;
  height: number;
  dpi: number;
  colorDepth: number;
  supportsTouch: boolean;
  supportedFeatures: string[];
}

export interface HmiRuntimePackageArtifact {
  schemaVersion: 1;
  kind: "hmi-runtime-package";
  packageId: string;
  fileName: string;
  projectId: string;
  projectName: string;
  hmiSchemaVersion: HmiProject["schemaVersion"];
  builtAt: string;
  runtimeProfile: "offline-preview";
  targetDevice: HmiRuntimePackageTargetDevice;
  summary: HmiRuntimePackageSummary;
  verification: HmiRuntimePackageVerificationSummary;
  checksumAlgorithm: "fnv1a32-stable-json";
  contentChecksum: string;
  hardwareTransfer: {
    download: "disabled-model-only";
    upload: "disabled-model-only";
    reason: string;
  };
}

export interface HmiRuntimePackageBuildOptions {
  builtAt?: string;
  validationContext?: HmiValidationContext;
}

export interface HmiRuntimePackageBuildResult {
  ok: boolean;
  artifact?: HmiRuntimePackageArtifact;
  verification: HmiRuntimePackageVerificationSummary;
  blockedReason?: string;
}

export interface HmiRuntimePackageIntegrityResult {
  ok: boolean;
  errors: string[];
  expectedChecksum?: string;
  artifact?: HmiRuntimePackageArtifact;
}

export interface HmiLanguageFileMetadata {
  format: "esco-language-csv";
  languageId: string;
  displayName: string;
  stringCount: number;
  missingStringCount: number;
  checksumAlgorithm: "fnv1a32-csv";
  contentChecksum: string;
  exportedAt?: string;
}

export interface HmiLanguageFileExportOptions {
  fileName?: string;
  exportedAt?: string;
}

export interface HmiLanguageFileExportResult {
  fileName: string;
  text: string;
  metadata: HmiLanguageFileMetadata;
}

export interface HmiLanguageFileImportOptions {
  id?: string;
  sourceFileName?: string;
  importedAt?: string;
}

export interface HmiLanguageFileImportResult {
  ok: boolean;
  languagePack?: HmiLanguagePack;
  errors: string[];
  warnings: string[];
}

export type HmiContentBundleFileKind =
  | "manifest"
  | "screen"
  | "popup"
  | "add-on-graphic"
  | "asset-manifest"
  | "unsupported-content";

export interface HmiContentBundleFile {
  path: string;
  kind: HmiContentBundleFileKind;
  text: string;
  checksumAlgorithm: "fnv1a32-text";
  contentChecksum: string;
}

export interface HmiContentBundleManifest {
  schemaVersion: 1;
  kind: "hmi-content-bundle";
  projectId: string;
  projectName: string;
  exportedAt?: string;
  summary: {
    screenCount: number;
    popupCount: number;
    addOnGraphicCount: number;
    assetCount: number;
    unsupportedContentCount: number;
  };
  files: Array<{
    path: string;
    kind: HmiContentBundleFileKind;
    checksumAlgorithm: "fnv1a32-text";
    contentChecksum: string;
  }>;
}

export interface HmiContentBundleExportOptions {
  exportedAt?: string;
  includeUnsupportedContent?: boolean;
}

export interface HmiContentBundleExportResult {
  manifest: HmiContentBundleManifest;
  files: HmiContentBundleFile[];
}

export interface HmiContentBundleFolderEntry {
  path: string;
  text: string;
}

export interface HmiContentBundleFolderExportResult {
  manifest: HmiContentBundleManifest;
  entries: HmiContentBundleFolderEntry[];
}

export interface HmiContentBundleImportResult {
  ok: boolean;
  manifest?: HmiContentBundleManifest;
  content: Pick<HmiProject, "screens" | "popups" | "addOnGraphics" | "assets" | "unsupportedContent">;
  errors: string[];
  warnings: string[];
}
