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
    storageMb: number;
  };
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

export interface HmiAlarmView {
  id: string;
  name: string;
  kind: "summary" | "manager" | "history";
  columns: string[];
  filter?: string;
  sort?: string;
  securityRoleIds: string[];
}

export interface HmiDiagnosticsView {
  id: string;
  name: string;
  columns: string[];
  defaultFilter?: string;
}

export interface HmiTrend {
  id: string;
  name: string;
  timeRangeSeconds: number;
  sampleRateMs: number;
  traces: Array<{ id: string; label: string; source: HmiBindingSource; color: string }>;
}

export interface HmiDataLog {
  id: string;
  name: string;
  sampleRateMs: number;
  retentionHours: number;
  tagPaths: string[];
  statusTagPath?: string;
}

export interface HmiLanguagePack {
  id: string;
  languageId: string;
  displayName: string;
  strings: Record<string, string>;
  missingStringIds: string[];
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

export interface HmiProject {
  schemaVersion: 1;
  id: string;
  name: string;
  targetDevice: HmiDeviceProfile;
  defaultLanguage: string;
  homeScreenId?: string;
  screens: HmiScreen[];
  popups: HmiPopup[];
  systemBanner: HmiSystemBanner;
  shortcuts: HmiShortcut[];
  assets: HmiAsset[];
  addOnGraphics: HmiAddOnGraphicDefinition[];
  alarmViews: HmiAlarmView[];
  diagnosticsViews: HmiDiagnosticsView[];
  trends: HmiTrend[];
  dataLogs: HmiDataLog[];
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
