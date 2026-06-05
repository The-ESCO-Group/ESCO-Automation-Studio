/**
 * PLC domain model for an offline ESCO automation project.
 *
 * This is the single source of truth for the project structure. The UI,
 * simulator, validator, importer, and AI assistant must all build on these
 * types rather than defining their own.
 */

export type RoutineLanguage =
  | "ladder"
  | "structured-text"
  | "function-block"
  | "sfc";

export type TagScope = "controller" | "program";

export type ExternalAccess = "read-write" | "read-only" | "none";

export type TaskType = "continuous" | "periodic" | "event";

/**
 * How the project model loaded into the app originated. ESCO never opens
 * proprietary binary controller-project files; provenance is recorded so the UI
 * can always show, honestly, where the in-memory project actually came from and
 * audit any blocked unsupported-format import attempt. Read-only metadata; never
 * used by the simulator or to talk to a controller.
 */
export type ProjectSourceType =
  | "new"
  | "xml-review-import"
  | "esco-project"
  | "component-import"
  | "recovered"
  /** Reserved source marker for an unsupported proprietary binary source. */
  | "binary-project-open-blocked"
  /** Reserved source marker for an unsupported external conversion. */
  | "external-conversion-import"
  /** Loaded from a compiled ESCO Runtime (`.easruntime`); inspectable, not a normal editable project. */
  | "esco-runtime"
  /**
   * Reconstructed by uploading an ESCO project model from an ESCO SoftController
   * runtime image (a read-only ESCO software controller, never real hardware).
   * Inspectable like {@link "esco-runtime"}; the reconstruction caveats and the
   * controller identity/checksum it came from live in {@link ProjectProvenance.softController}.
   */
  | "esco-softcontroller-upload";

/**
 * Kind of external engineering tool historically associated with proprietary
 * binary conversion. Retained only for legacy provenance records.
 */
export type ExternalConversionToolKind =
  | "licensed-engineering-tool"
  | "external-engineering-workstation"
  | "unknown";

/** A detected external tool recorded in legacy provenance/diagnostic data. */
export interface ExternalConversionTool {
  kind: ExternalConversionToolKind;
  /** Display name reported by the external tool detector. */
  name: string;
  /** Detected version, when the tool reports one. */
  version?: string;
  /** Install path / executable / wheel directory, when detected. */
  path?: string;
}

/** What happened on a proprietary binary import/export attempt (used in the audit trail). */
export type BinaryProjectOutcome =
  /** Format guard refused the file before any parse (no tooling consulted). */
  | "format-blocked"
  /** An external conversion path could have helped, but no licensed tooling is installed. */
  | "binary-project-conversion-unavailable"
  /** A proprietary binary export/save target was refused (never faked). */
  | "binary-project-export-blocked";

/** Audit record of an import/export that was blocked because the file is an unsupported format. */
export interface BlockedImportRecord {
  /** Selected file name. Do not echo this directly into product UI. */
  fileName: string;
  /** Selected file path, when the host (desktop) exposes one. */
  path?: string;
  /** Machine format key from the format guard, e.g. "binary-project" / "binary-project-archive" / "legacy-ascii". */
  format: string;
  /** Human-facing format label, sanitized by the format guard. */
  formatLabel: string;
  /** Why the file was blocked (the offline-safe compatibility reason). */
  reason: string;
  /** ISO timestamp the attempt was blocked. */
  blockedAt: string;
  /** Which outcome this record represents. Defaults to "format-blocked" when absent. */
  outcome?: BinaryProjectOutcome;
  /** The external tool that *could* perform the conversion, when one was detected. */
  tool?: ExternalConversionTool;
}

/**
 * Provenance detail for a project reconstructed by an ESCO SoftController upload.
 *
 * The ESCO SoftController is an ESCO-owned *software* controller runtime — never
 * a physical controller. These fields are honest, read-only audit data about the
 * runtime image the project was reconstructed from; none of them are ever used
 * to talk to hardware. Present only when {@link ProjectProvenance.sourceType}
 * is `"esco-softcontroller-upload"`.
 */
export interface SoftControllerProvenance {
  /** Controller serial number read from the ESCO SoftController, when reported. */
  serialNumber?: string;
  /** Controller firmware / runtime revision, when reported. */
  firmwareRevision?: string;
  /** Controller catalog number, when reported. */
  catalogNumber?: string;
  /** ESCO runtime compiler version that produced the uploaded image, when known. */
  runtimeVersion?: string;
  /** SHA-256 integrity checksum of the uploaded ESCO runtime image. */
  runtimeChecksum?: string;
  /** ISO timestamp the project model was reconstructed (uploaded) from the SoftController. */
  uploadedAt: string;
}

export interface ProjectProvenance {
  /** How the in-memory project originated. */
  sourceType: ProjectSourceType;
  /** Original file name, when imported/opened from a file. */
  fileName?: string;
  /** Original file path (desktop), when the host exposes one. */
  path?: string;
  /** ISO timestamp the project was imported / opened / created. */
  importedAt: string;
  /** The most recent blocked unsupported-format import attempt against this project, if any. */
  blockedImport?: BlockedImportRecord;
  /** The external tool recorded for a legacy conversion, when applicable. */
  bridgeTool?: ExternalConversionTool;
  /**
   * Audit detail for an ESCO SoftController upload — the controller identity and
   * runtime checksum the project was reconstructed from. Set only when
   * {@link sourceType} is `"esco-softcontroller-upload"`. Read-only metadata.
   */
  softController?: SoftControllerProvenance;
}

export interface PlcProject {
  id: string;
  name: string;
  description?: string;
  controllers: Controller[];
  createdAt: string;
  updatedAt: string;
  /**
   * Where this project model came from (L5X import, ESCO project, new). ESCO
   * cannot open proprietary binary project files, so this is recorded honestly
   * and surfaced in Project Properties. Read-only provenance; never used by the
   * simulator.
   */
  provenance?: ProjectProvenance;
}

export interface Controller {
  id: string;
  projectId: string;
  name: string;
  /**
   * Controller `<Description>` as authored in the L5X. Imported read-only
   * metadata (never used to drive a controller); preserved verbatim so the
   * controller description survives export -> import (mirrors program / routine
   * / tag descriptions).
   */
  description?: string;
  processorType?: string;
  firmwareRevision?: string;
  /** Imported controller catalog metadata (read-only; no controller communication). */
  catalogNumber?: string;
  chassis?: string;
  slot?: number;
  /** Names of the controller's fault / power-up handler programs, when configured. */
  faultRoutineName?: string;
  powerUpRoutineName?: string;
  /**
   * System Overhead Time Slice as authored in the L5X (`TimeSlice`, the percent
   * of CPU time given to communications/background tasks). Imported read-only
   * scheduling metadata; never used by the simulator, preserved verbatim so it
   * round-trips through export.
   */
  timeSlice?: string;
  /**
   * Whether unused system-overhead time is shared with the continuous task
   * (`ShareUnusedTimeSlice`, "1"/"0"). Imported read-only scheduling metadata;
   * preserved verbatim so it survives export -> import (mirrors {@link timeSlice}).
   */
  shareUnusedTimeSlice?: string;
  /**
   * SFC execution-control scheduling metadata as authored in the L5X, present in
   * nearly every Logix export: how SFC charts execute (`SFCExecutionControl`,
   * e.g. "CurrentActive"), where they restart (`SFCRestartPosition`, e.g.
   * "MostRecent"), and how the last scan is handled (`SFCLastScan`, e.g.
   * "DontScan"). Imported read-only; never used by the simulator, preserved
   * verbatim so it round-trips through export (mirrors {@link timeSlice}).
   */
  sfcExecutionControl?: string;
  sfcRestartPosition?: string;
  sfcLastScan?: string;
  /**
   * Controller redundancy configuration (`<RedundancyInfo>`), present in nearly
   * every ControlLogix export. Imported read-only metadata; never used by the
   * simulator, preserved verbatim so the redundancy settings survive
   * export -> import (mirrors {@link timeSlice}).
   */
  redundancyInfo?: RedundancyInfo;
  /**
   * GuardLogix safety configuration (`<SafetyInfo>`), present in nearly every
   * safety-controller export. Imported read-only metadata; never used to verify
   * a safety signature, enforce safety locking, or talk to a controller,
   * preserved verbatim so the safety settings survive export -> import (mirrors
   * {@link redundancyInfo}).
   */
  safetyInfo?: SafetyInfo;
  /**
   * Project documentation language configuration, present on the `<Controller>`
   * element when localized comments/descriptions are enabled (e.g.
   * `CurrentProjectLanguage`, `DefaultProjectLanguage`, `ControllerLanguage`,
   * typically locale codes like "en-US"). Imported read-only documentation
   * metadata; never used by the simulator, preserved verbatim so the language
   * settings survive export -> import (mirrors {@link timeSlice}).
   */
  currentProjectLanguage?: string;
  defaultProjectLanguage?: string;
  controllerLanguage?: string;
  /**
   * Project documentation download / pass-through configuration, present on the
   * `<Controller>` element of nearly every Logix export: whether comments and
   * descriptions are downloaded to the controller (`PassThroughConfiguration`,
   * e.g. "EnabledWithAppend"), and whether project documentation, extended
   * properties (`DownloadProjectDocumentationAndExtendedProperties`) and custom
   * properties (`DownloadProjectCustomProperties`) are stored on download
   * ("true"/"false", kept verbatim). Imported read-only documentation metadata;
   * never used by the simulator, preserved verbatim so the settings survive
   * export -> import (mirrors {@link currentProjectLanguage}).
   */
  passThroughConfiguration?: string;
  downloadProjectDocumentationAndExtendedProperties?: string;
  downloadProjectCustomProperties?: string;
  /**
   * Project/controller matching and firmware-update configuration, present on the
   * `<Controller>` element of nearly every Logix export: whether the project is
   * matched to a specific controller serial number before download
   * (`MatchProjectToController`, "true"/"false") and whether automatic firmware
   * updates on connect are inhibited (`InhibitAutomaticFirmwareUpdate`, "0"/"1").
   * Imported read-only metadata; never used to talk to a controller, match a
   * serial number, or update firmware, preserved verbatim so the settings survive
   * export -> import (mirrors {@link passThroughConfiguration}).
   *
   * When matching is enabled, the export also carries the target controller's
   * serial number (`ProjectSN`, e.g. "16#0000_0000"). Imported read-only
   * metadata; never used to match a serial number or talk to a controller,
   * preserved verbatim so it survives export -> import.
   */
  matchProjectToController?: string;
  projectSN?: string;
  inhibitAutomaticFirmwareUpdate?: string;
  /**
   * Whether a consumed tag may use the connection RPI requested by its producer.
   * Studio 5000 exports this controller-level setting under closely related
   * names depending on format/version (`CanUseRPIFromProducer` and, in current
   * L5X documentation, `CanUseRPIFromController`). Imported read-only metadata;
   * never used to schedule a connection or talk to a controller, preserved
   * verbatim so the setting survives export -> import (mirrors
   * {@link matchProjectToController}; pairs with the produced/consumed tag
   * `<ConsumeInfo>` RPI).
   */
  canUseRPIFromProducer?: string;
  canUseRPIFromController?: string;
  /**
   * Project documentation/audit timestamps, present on the `<Controller>` element
   * of nearly every Logix export: when the project was first created
   * (`ProjectCreationDate`) and when it was last modified (`LastModifiedDate`),
   * e.g. "Tue Mar 12 09:15:23 2024". Imported read-only metadata; never parsed as
   * a date or used by the simulator, preserved verbatim so the timestamps survive
   * export -> import (mirrors {@link matchProjectToController}).
   */
  projectCreationDate?: string;
  lastModifiedDate?: string;
  /**
   * Whether the controller reports a minor fault when an arithmetic operation
   * overflows (`ReportMinorOverflow`, "true"/"false"), present on the
   * `<Controller>` element of nearly every Logix export. Imported read-only
   * metadata; never used by the simulator to decide overflow handling, preserved
   * verbatim so the setting survives export -> import (mirrors
   * {@link matchProjectToController}).
   */
  reportMinorOverflow?: string;
  /**
   * Last-used communication path and driver Studio 5000 recorded for connecting
   * to this controller (`CommPath`, e.g. "AB_ETHIP-1\\192.168.1.10\\Backplane\\0",
   * and `CommDriver`, e.g. "AB_ETHIP-1"), present on the `<Controller>` element of
   * many Logix exports. Imported read-only metadata; never used to connect to,
   * go online with, or talk to a controller (this tool is offline-only), preserved
   * verbatim so the path survives export -> import (mirrors
   * {@link matchProjectToController}).
   */
  commPath?: string;
  commDriver?: string;
  /**
   * Studio 5000 software version that produced the L5X export, taken from the
   * root `<RSLogix5000Content SoftwareRevision="...">` attribute (e.g. "32.04").
   * Imported read-only provenance metadata; never used by the simulator or to
   * talk to a controller, preserved verbatim so the originating software version
   * survives export -> import rather than being overwritten with this tool's own
   * identity (mirrors {@link matchProjectToController}).
   */
  softwareRevision?: string;
  /**
   * Name of the user / organization that produced the L5X export, taken from the
   * root `<RSLogix5000Content Owner="...">` attribute (e.g. "John Doe, Acme Corp").
   * Imported read-only provenance metadata; never used by the simulator or to talk
   * to a controller, preserved verbatim so the originating owner survives
   * export -> import rather than being dropped (mirrors {@link softwareRevision};
   * lives on the root element, not the `<Controller>`).
   */
  exportOwner?: string;
  /**
   * Export-scope options string Studio 5000 stamps on the root
   * `<RSLogix5000Content ExportOptions="...">` attribute of nearly every L5X
   * export — a space-separated list of the data classes the file contains (e.g.
   * "References NoRawData L5KData DecoratedData Context Dependencies
   * ForceProtectedEncoding AllProjDocTrans"). Imported read-only provenance
   * metadata; never parsed, acted on, or used by the simulator, preserved
   * verbatim so the originating export options survive export -> import rather
   * than being dropped (mirrors {@link exportOwner}; lives on the root element,
   * not the `<Controller>`).
   */
  exportOptions?: string;
  /**
   * Timestamp Studio 5000 stamps on the root `<RSLogix5000Content ExportDate="...">`
   * attribute of every L5X export — the day/time the file was generated (e.g.
   * "Tue Jan 02 14:03:11 2024"). Imported read-only provenance metadata; never
   * parsed as a date, acted on, or used by the simulator, preserved verbatim so the
   * originating export date survives export -> import rather than being overwritten
   * with this tool's own export time (mirrors {@link exportOptions}; lives on the
   * root element, not the `<Controller>`).
   */
  exportDate?: string;
  /**
   * Whether the L5X file embeds surrounding project context beyond the exported
   * target, taken from the root `<RSLogix5000Content ContainsContext="...">`
   * attribute (e.g. "true" / "false"). Present on nearly every L5X export.
   * Imported read-only provenance metadata; never parsed, acted on, or used by
   * the simulator, preserved verbatim so the originating context flag survives
   * export -> import rather than being dropped (mirrors {@link exportDate}; lives
   * on the root element, not the `<Controller>`).
   */
  containsContext?: string;
  /**
   * Controller wall-clock time configuration (`<WallClockTime>`), present on
   * nearly every Logix export: the controller's local time offset from UTC in
   * microseconds (`LocalTimeAdjustment`) and its configured time zone string
   * (`TimeZone`). Imported read-only metadata; never used to set a controller's
   * clock or talk to a controller, preserved verbatim so the wall-clock settings
   * survive export -> import (mirrors {@link redundancyInfo}).
   */
  wallClockTime?: WallClockTimeInfo;
  /**
   * Controller CIP Sync / IEEE 1588 time-synchronization configuration
   * (`<TimeSynchronize>`), present on nearly every Logix export: whether
   * Precision Time Protocol is enabled (`PTPEnable`) and the grandmaster
   * election priorities (`Priority1` / `Priority2`). Imported read-only metadata;
   * never used to synchronize a clock or talk to a controller, preserved verbatim
   * so the settings survive export -> import (mirrors {@link wallClockTime}).
   */
  timeSync?: TimeSyncInfo;
  /**
   * Controller Coordinated System Time configuration (`<CST>`), present on nearly
   * every ControlLogix export: which device in the chassis is the CST time master
   * (`MasterID`). Imported read-only metadata; never used to coordinate a system
   * clock or talk to a controller, preserved verbatim so the setting survives
   * export -> import (mirrors {@link timeSync}).
   */
  cst?: CstInfo;
  /**
   * Controller source-protection / change-detection security configuration
   * (`<Security>`), present on nearly every Logix export. Imported read-only
   * metadata; never used to enforce permissions, authenticate against a security
   * authority, or talk to a controller, preserved verbatim so the security
   * settings survive export -> import (mirrors {@link redundancyInfo}).
   */
  security?: ControllerSecurity;
  /**
   * Controller EtherNet/IP configuration objects (`<InternetProtocol>`,
   * `<EthernetPorts>`, and `<EthernetNetwork>`), imported read-only. These are
   * workstation/project network settings, not a live controller connection;
   * ESCO preserves the attributes for offline review/export but never applies IP
   * settings, browses a network, or monitors physical link state.
   */
  ethernetConfig?: ControllerEthernetConfig;
  /**
   * Controller serial communication port configuration (`<CommPorts>` /
   * `<SerialPort>` with child protocol objects such as `<ASCII>` and `<DF1>`),
   * imported read-only. ESCO preserves the settings for offline review/export
   * but never opens a serial port, changes controller communication settings, or
   * models DF1/ASCII channel hardware state.
   */
  commPorts?: ControllerCommPorts;
  /**
   * Program parameter connections (`<ParameterConnections>` /
   * `<ParameterConnection EndPoint1="Program.Param" EndPoint2="Program.Param"/>`),
   * imported read-only. These describe Studio 5000 program-parameter bindings;
   * ESCO preserves and reviews them offline but does not perform controller
   * verified binding, runtime transfer, or download preflight.
   */
  parameterConnections?: ProgramParameterConnection[];

  tasks: Task[];
  programs: Program[];
  controllerTags: Tag[];
  dataTypes: UserDefinedType[];
  addOnInstructions: AddOnInstruction[];
  ioConfiguration: IOConfiguration;
  /**
   * Logix Designer controller trend definitions (`<Trends><Trend>`), imported
   * read-only. These are engineering-workstation trend configurations, not
   * sampled runtime data; ESCO preserves their attributes, template payload, and
   * pen definitions for offline review/export but never opens a controller
   * connection or runs the trend.
   */
  trends?: ControllerTrend[];
  /**
   * Logix Designer Quick Watch lists (`<QuickWatchLists><QuickWatchList>`),
   * imported read-only. These are engineering-workstation watch definitions, not
   * live tag values; ESCO preserves their watch specifiers/scopes for offline
   * review/export but never opens a controller connection or monitors live tags.
   */
  quickWatchLists?: QuickWatchList[];
}

/**
 * Arbitrary L5X attributes captured from a model-only component. Attribute
 * values are preserved as strings because many Logix fields are opaque tokens
 * (`16#...`, enum display text, version strings) and should round-trip without
 * normalization.
 */
export type L5XAttributeMap = Record<string, string>;

/** A single pen within a controller trend definition. */
export interface ControllerTrendPen {
  id: string;
  name: string;
  description?: string;
  /** All imported `<Pen>` attributes except `Name`, preserved verbatim. */
  attributes?: L5XAttributeMap;
}

/** A controller trend definition from the Logix Designer Trends folder. */
export interface ControllerTrend {
  id: string;
  name: string;
  description?: string;
  /** All imported `<Trend>` attributes except `Name`, preserved verbatim. */
  attributes?: L5XAttributeMap;
  /** Opaque TrendX template byte/list payload. Display/export only. */
  template?: string;
  pens: ControllerTrendPen[];
}

/** A tag/member entry inside a Logix Designer Quick Watch list. */
export interface QuickWatchTag {
  id: string;
  /** `WatchTag Specifier`, the tag or member path to monitor. */
  specifier: string;
  /**
   * `WatchTag Scope`, typically a program, equipment phase, or AOI name.
   * Undefined/empty means controller scope.
   */
  scope?: string;
  description?: string;
  /** All imported `<WatchTag>` attributes except `Specifier`/`Scope`, preserved verbatim. */
  attributes?: L5XAttributeMap;
}

/** A named Logix Designer Quick Watch list. */
export interface QuickWatchList {
  id: string;
  name: string;
  description?: string;
  /** All imported `<QuickWatchList>` attributes except `Name`, preserved verbatim. */
  attributes?: L5XAttributeMap;
  tags: QuickWatchTag[];
}

/** Controller `<InternetProtocol>` attributes, preserved verbatim. */
export interface ControllerInternetProtocol {
  attributes: L5XAttributeMap;
}

/** A controller `<EthernetPort>` row, preserved verbatim. */
export interface ControllerEthernetPort {
  id: string;
  attributes: L5XAttributeMap;
}

/** Controller `<EthernetNetwork>` ring/network attributes, preserved verbatim. */
export interface ControllerEthernetNetwork {
  attributes: L5XAttributeMap;
}

/** Imported controller EtherNet/IP configuration objects. */
export interface ControllerEthernetConfig {
  internetProtocol?: ControllerInternetProtocol;
  ports: ControllerEthernetPort[];
  network?: ControllerEthernetNetwork;
}

/** A child protocol object under `<SerialPort>`, such as `<ASCII>` or `<DF1>`. */
export interface ControllerSerialPortProtocol {
  id: string;
  elementName: string;
  attributes: L5XAttributeMap;
}

/** A controller `<SerialPort>` row, preserved verbatim. */
export interface ControllerSerialPort {
  id: string;
  attributes: L5XAttributeMap;
  /**
   * Serial port `<Description>` child, imported read-only display metadata.
   * Studio 5000 stores it as a child element (not an attribute), like every
   * other configurable element; preserved verbatim so it round-trips on export
   * (mirrors controller / program / routine / tag / module descriptions).
   */
  description?: string;
  protocols: ControllerSerialPortProtocol[];
}

/** Imported controller `<CommPorts>` serial communication configuration. */
export interface ControllerCommPorts {
  serialPorts: ControllerSerialPort[];
}

/** Imported connection between two program parameters. */
export interface ProgramParameterConnection {
  id: string;
  endPoint1?: string;
  endPoint2?: string;
  /** Extra imported `<ParameterConnection>` attributes, preserved verbatim. */
  attributes?: L5XAttributeMap;
}

/**
 * Controller redundancy configuration (`<RedundancyInfo>`), imported read-only.
 * Never used by the simulator or to talk to a controller; preserved verbatim so
 * the redundancy settings survive export -> import.
 */
export interface RedundancyInfo {
  /** Whether controller redundancy is enabled (`Enabled`). */
  enabled?: boolean;
  /** Whether test edits are kept across a switchover (`KeepTestEditsOnSwitchOver`). */
  keepTestEditsOnSwitchOver?: boolean;
  /** I/O memory pad reserve percentage (`IOMemoryPadPercentage`), kept verbatim. */
  ioMemoryPadPercentage?: string;
  /** Data table pad reserve percentage (`DataTablePadPercentage`), kept verbatim. */
  dataTablePadPercentage?: string;
  /** Front-port crossload enabled ports (`FrontPortCrossloadEnabledPorts`), kept verbatim. */
  frontPortCrossloadEnabledPorts?: string;
  /** Front-port crossload security flag (`FrontPortCrossloadSecurityEnabled`), kept verbatim. */
  frontPortCrossloadSecurityEnabled?: string;
}

/**
 * GuardLogix safety configuration (`<SafetyInfo>`), imported read-only. Never
 * used to verify a safety signature, enforce safety locking / memory
 * partitioning, or talk to a controller; preserved verbatim so the safety
 * settings survive export -> import (mirrors {@link RedundancyInfo}).
 */
export interface SafetyInfo {
  /** Whether controller safety is enabled (`SafetyEnabled`), kept verbatim. */
  safetyEnabled?: string;
  /** Whether the safety task is locked (`SafetyLocked`). */
  safetyLocked?: boolean;
  /**
   * Safety signature identifier (`SafetySignatureID`), kept verbatim (it is an
   * opaque GUID-like token, never parsed or validated here).
   */
  safetySignatureId?: string;
  /**
   * Timestamp the safety signature was generated (`SafetySignatureTimestamp`),
   * kept verbatim as a string (it is display-only audit metadata, never parsed
   * as a date or used here; mirrors {@link Controller.lastModifiedDate}).
   */
  safetySignatureTimestamp?: string;
  /** Whether the safety signature is run-mode protected (`SignatureRunModeProtect`). */
  signatureRunModeProtect?: boolean;
  /** Whether safety I/O is always configured (`ConfigureSafetyIOAlways`). */
  configureSafetyIOAlways?: boolean;
  /**
   * Certified safety integrity level (`SafetyLevel`, e.g. "SIL2/PLd",
   * "SIL3/PLe"), kept verbatim as a string (it is display-only metadata, never
   * parsed or used to enforce a safety rating here).
   */
  safetyLevel?: string;
  /**
   * Standard <-> safety tag mapping (`<SafetyTagMap>` child element), kept
   * verbatim as a string. It is the engineer-configured list pairing standard
   * tags into the safety task; never parsed, resolved, or used to move data
   * between safety and standard scope here, but preserved so the mapping
   * survives export -> import.
   */
  safetyTagMap?: string;
}

/**
 * Controller wall-clock time configuration (`<WallClockTime>`), imported
 * read-only. Never used to set or read a controller's clock; preserved verbatim
 * so the wall-clock settings survive export -> import (mirrors
 * {@link RedundancyInfo}).
 */
export interface WallClockTimeInfo {
  /**
   * Local time offset from UTC in microseconds (`LocalTimeAdjustment`), kept
   * verbatim as a string (it can exceed the safe-integer range and is never used
   * in arithmetic here).
   */
  localTimeAdjustment?: string;
  /** Configured time zone string (`TimeZone`), kept verbatim. */
  timeZone?: string;
}

/**
 * Controller CIP Sync / IEEE 1588 time-synchronization configuration
 * (`<TimeSynchronize>`), imported read-only. Never used to synchronize a clock,
 * elect a grandmaster, or talk to a controller; preserved verbatim so the
 * settings survive export -> import (mirrors {@link WallClockTimeInfo}).
 */
export interface TimeSyncInfo {
  /** Whether Precision Time Protocol is enabled (`PTPEnable`). */
  ptpEnable?: boolean;
  /**
   * PTP grandmaster election primary priority (`Priority1`, 0-255), kept verbatim
   * as a string (an opaque ranking token, never used in arithmetic here).
   */
  priority1?: string;
  /** PTP grandmaster election secondary priority (`Priority2`, 0-255), kept verbatim. */
  priority2?: string;
}

/**
 * Controller Coordinated System Time configuration (`<CST>`), imported
 * read-only. Never used to coordinate a system clock, elect a CST master, or
 * talk to a controller; preserved verbatim so the setting survives
 * export -> import (mirrors {@link TimeSyncInfo}).
 */
export interface CstInfo {
  /**
   * Identifier of the device acting as the Coordinated System Time master
   * (`MasterID`), kept verbatim as a string (an opaque integer token, never
   * parsed or used in arithmetic here).
   */
  masterId?: string;
}

/**
 * Controller security configuration (`<Security>`), imported read-only. Never
 * used to enforce permissions, authenticate against a FactoryTalk security
 * authority, or talk to a controller; preserved verbatim so the security
 * settings survive export -> import (mirrors {@link RedundancyInfo}).
 */
export interface ControllerSecurity {
  /**
   * Source-protection security code (`Code`), kept verbatim as a string (an
   * opaque integer token, never parsed or evaluated here).
   */
  code?: string;
  /**
   * Bitmask of change types the controller tracks for the audit log
   * (`ChangesToDetect`), e.g. "16#ffff_ffff_ffff_ffff". Kept verbatim (it can
   * exceed the safe-integer range and is never used in arithmetic here).
   */
  changesToDetect?: string;
  /**
   * FactoryTalk security authority identifier the project is bound to
   * (`SecurityAuthorityID`), kept verbatim (an opaque GUID-like token, never
   * parsed or validated here). Present only when the project is secured.
   */
  securityAuthorityId?: string;
  /**
   * Human-readable FactoryTalk security authority name (`SecurityAuthorityName`),
   * kept verbatim. Present only when the project is secured.
   */
  securityAuthorityName?: string;
}

/** Trigger configuration for an EVENT task (`<EventInfo>`), imported read-only. */
export interface EventInfo {
  /**
   * What fires the task, as authored in the L5X (e.g. "Consumed Tag Connection",
   * "Module Input Data State Change", "EVENT Instruction Only").
   */
  eventTrigger?: string;
  /** Tag the trigger is bound to, when the trigger references one (`Tag`). */
  eventTag?: string;
  /**
   * Whether the task is configured to time out if its trigger does not fire
   * within the watchdog (`EnableTimeout`). Imported read-only display metadata;
   * never used to schedule a task, just preserved so it round-trips on export.
   */
  enableTimeout?: boolean;
}

export interface Task {
  id: string;
  controllerId: string;
  name: string;
  /**
   * Task `<Description>`, imported read-only display metadata. Never used to
   * schedule or talk to a controller; preserved verbatim so it survives
   * export -> import (mirrors controller / program / routine / tag descriptions).
   */
  description?: string;
  type: TaskType;
  periodMs?: number;
  priority?: number;
  /** Watchdog timeout in milliseconds (imported metadata). */
  watchdogMs?: number;
  /** True when the task is inhibited (imported metadata; not scheduled). */
  inhibited?: boolean;
  /**
   * True when the task is configured to skip updating outputs at the end of its
   * execution (`DisableUpdateOutputs`, valid on PERIODIC / EVENT tasks). Imported
   * read-only metadata; never used to schedule or talk to a controller, preserved
   * verbatim so it survives export -> import.
   */
  disableUpdateOutputs?: boolean;
  /**
   * Trigger configuration for an EVENT task (`<EventInfo>`), imported read-only.
   * Never used to schedule or talk to a controller; preserved verbatim so the
   * trigger binding survives export -> import.
   */
  eventInfo?: EventInfo;
  /**
   * Safety partition ("Safety" / "Standard") as authored in the L5X `Class`
   * attribute. Present on the dedicated Safety Task of a GuardLogix project.
   * Imported read-only display metadata (never used here to schedule a safety
   * task); kept so the partition round-trips on export (mirrors
   * {@link Program.safetyClass} and {@link Tag.safetyClass}).
   */
  safetyClass?: string;
  scheduledProgramIds: string[];
}

/** An imported program parameter (Input / Output / InOut). Read-only metadata. */
export interface ProgramParameter {
  name: string;
  dataType: string;
  usage?: string;
  required?: boolean;
  /**
   * Whether the parameter is shown on the program's parameter face (`Visible="true"`).
   * Independent of {@link required}: a parameter can be required without being visible,
   * or visible without being required. Imported read-only display metadata; preserved
   * so it round-trips through export (mirrors {@link AoiParameter.visible}).
   */
  visible?: boolean;
  /** First-dimension length when the parameter is an array (e.g. an InOut array passed by reference). */
  dimension?: number;
  /** Full parameter array dimensions, e.g. DINT[2,3] -> [2, 3]. Imported read-only metadata. */
  dimensions?: number[];
  /** Default value as authored in the L5X (imported read-only metadata). */
  defaultValue?: string;
  description?: string;
  /**
   * Display radix as authored in the L5X (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"). Imported read-only metadata that affects display only;
   * preserved verbatim so it round-trips through export (mirrors {@link AoiParameter.radix}).
   */
  radix?: string;
  /**
   * Parameter external-access permission as authored in the L5X ("Read/Write",
   * "Read Only", "None"). Imported read-only metadata; preserved so it
   * round-trips through export (mirrors {@link AoiParameter.externalAccess}).
   */
  externalAccess?: ExternalAccess;
  /**
   * Whether the parameter is declared read-only constant (`Constant="true"`),
   * supported on Input parameters. Imported read-only metadata; preserved
   * verbatim so it round-trips through export (mirrors {@link Tag.constant}).
   */
  constant?: boolean;
}

export interface Program {
  id: string;
  controllerId: string;
  name: string;
  description?: string;
  mainRoutineId?: string;
  faultRoutineId?: string;
  /** True when the program is inhibited (imported metadata; not scheduled). */
  inhibited?: boolean;
  /**
   * Safety partition ("Safety" / "Standard"), preserved verbatim from the L5X
   * `Class` attribute. Read-only display metadata (never used to schedule a
   * safety task); kept so the partition round-trips on export (mirrors {@link Tag.safetyClass}).
   */
  safetyClass?: string;
  /**
   * Whether the program is an organizational folder rather than an executable
   * program (`UseAsFolder`). Folder programs carry no main routine and are never
   * scheduled. Read-only display metadata, preserved verbatim so the folder
   * designation round-trips on export.
   */
  useAsFolder?: boolean;
  /**
   * Whether the program currently has pending online test edits (`TestEdits`).
   * Read-only display metadata, preserved verbatim from the L5X (this tool is
   * offline-only and never accepts, cancels, or assembles test edits); kept so
   * the flag round-trips on export (mirrors {@link Program.inhibited}).
   */
  testEdits?: boolean;
  /** Program parameters (Input/Output/InOut), imported read-only metadata. */
  parameters?: ProgramParameter[];
  routines: Routine[];
  programTags: Tag[];
}

export interface Routine {
  id: string;
  programId: string;
  name: string;
  description?: string;
  language: RoutineLanguage;
  /** Populated for ladder routines. Typed loosely here to avoid a hard dependency on @esco/ladder. */
  ladder?: unknown;
  /** Imported or authored Structured Text source. The offline simulator executes a conservative subset. */
  structuredText?: string;
  /**
   * Best-effort preserved source/structure for imported non-ladder graphical
   * routines (Function Block / SFC). Read-only, for display only — never
   * executed. Structured Text uses `structuredText` instead.
   */
  sourceText?: string;
}

/**
 * A per-element/member comment, as authored in `<Comments><Comment Operand=...>`.
 * Logix stores descriptions for individual array elements and structure members
 * on the tag rather than the data type, e.g. `Operand="[2]"` or `Operand=".Speed"`.
 */
export interface TagComment {
  /** The operand the comment annotates, e.g. "[0]", ".Member", ".Member[1]". */
  operand: string;
  /** The comment text. */
  text: string;
}

/**
 * A per-element/member engineering unit, as authored in
 * `<EngineeringUnits><EngineeringUnit Operand=...>`. Logix stores units for the
 * whole tag or for individual array elements / structure members here (keyed by
 * operand), parallel to {@link TagComment}.
 */
export interface TagEngineeringUnit {
  /** The operand the unit annotates, e.g. "", "[0]", ".Member". */
  operand: string;
  /** The engineering unit text, e.g. "psi", "RPM". */
  text: string;
}

/** Producer binding for a consumed tag, as authored in `<ConsumeInfo>`. */
export interface ConsumeInfo {
  /** Name of the producing controller (the `Producer` attribute). */
  producer?: string;
  /** Tag name on the producing controller (`RemoteTag`). */
  remoteTag?: string;
  /** Instance number on the producing controller (`RemoteInstance`). */
  remoteInstance?: string;
  /** Requested packet interval in ms (`RPI`). */
  rpi?: number;
  /** Whether the consumed connection is unicast rather than multicast (`Unicast`). */
  unicast?: boolean;
}

/** Connection settings for a produced tag, as authored in `<ProduceInfo>`. */
export interface ProduceInfo {
  /** Maximum number of consumers that may connect (`ProduceCount`). */
  produceCount?: number;
  /** Whether unicast connections are permitted (`UnicastPermitted`). */
  unicastPermitted?: boolean;
  /** Whether the event trigger may be sent programmatically (`ProgrammaticallySendEventTrigger`). */
  programmaticallySendEventTrigger?: boolean;
}

export interface Tag {
  id: string;
  controllerId: string;
  programId?: string;

  name: string;
  scope: TagScope;
  dataType: string;

  /** First-dimension length for compatibility with older single-dimension array handling. */
  dimension?: number;
  /** Full Logix array dimensions, e.g. DINT[4,8] -> [4, 8]. */
  dimensions?: number[];

  description?: string;
  value?: unknown;
  aliasFor?: string;

  externalAccess?: ExternalAccess;
  /** A read-only constant tag (imported metadata). */
  constant?: boolean;
  /** Produced / consumed tag metadata (imported read-only; no controller communication). */
  produced?: boolean;
  consumed?: boolean;
  /**
   * Connection metadata for a consumed tag (`<ConsumeInfo>`), imported read-only.
   * Never used to talk to a controller; preserved verbatim so the producer
   * binding survives export -> import.
   */
  consumeInfo?: ConsumeInfo;
  /**
   * Connection settings for a produced tag (`<ProduceInfo>`), imported read-only.
   * Never used to talk to a controller; preserved verbatim so the connection
   * settings survive export -> import.
   */
  produceInfo?: ProduceInfo;
  /**
   * Display radix as authored in the L5X (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"). Imported read-only metadata that affects display only;
   * preserved verbatim so it round-trips through export.
   */
  radix?: string;
  /**
   * Safety class as authored in the L5X (`Class`, e.g. "Safety" or "Standard").
   * Present only on tags in a safety project. Imported read-only metadata;
   * never used to drive a controller or safety task, preserved verbatim so the
   * standard/safety partition survives export -> import.
   */
  safetyClass?: string;
  /**
   * OPC UA accessibility as authored in the L5X (`OpcUaAccess`, e.g. "None" or
   * "ReadWrite"); present on newer Logix exports, parallel to
   * {@link Tag.externalAccess}. Imported read-only metadata that governs OPC UA
   * exposure only; never used to open a real OPC UA connection, preserved
   * verbatim so the setting survives export -> import.
   */
  opcUaAccess?: string;
  /**
   * Per-element/member comments as authored in `<Comments>`. Logix stores
   * descriptions for individual array elements and structure members here
   * (keyed by operand) rather than on the data type. Imported read-only
   * metadata; preserved verbatim so element/member descriptions survive
   * export -> import.
   */
  comments?: TagComment[];
  /**
   * Per-element/member engineering units as authored in `<EngineeringUnits>`.
   * Logix stores units for the whole tag or individual array elements /
   * structure members here (keyed by operand), parallel to {@link Tag.comments}.
   * Imported read-only metadata; preserved verbatim so units survive
   * export -> import.
   */
  engineeringUnits?: TagEngineeringUnit[];
}

export interface UserDefinedType {
  id: string;
  name: string;
  description?: string;
  /**
   * Data-type family as authored in the L5X (`Family`). Logix marks custom
   * string types with `"StringFamily"` and ordinary structures with
   * `"NoFamily"`. Imported read-only metadata; preserved verbatim so the family
   * (notably a custom STRING type) round-trips through export instead of
   * collapsing to a plain structure.
   */
  family?: string;
  /**
   * Safety partition as authored in the L5X (`Class`, e.g. "Safety" /
   * "Standard"). GuardLogix marks safety data types `Class="Safety"`. Imported
   * read-only metadata; never used to schedule a safety task, just kept so the
   * partition round-trips on export (mirrors {@link Tag.safetyClass},
   * {@link Program.safetyClass}, and the AOI / task `Class`).
   */
  safetyClass?: string;
  members: UdtMember[];
}

export interface UdtMember {
  name: string;
  dataType: string;
  /** First-dimension length when the member is an array. */
  dimension?: number;
  /** Full member array dimensions, e.g. BOOL[2,3] -> [2, 3]. */
  dimensions?: number[];
  description?: string;
  /**
   * Display radix as authored in the L5X (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"). Imported read-only metadata that affects display only;
   * preserved verbatim so it round-trips through export (mirrors {@link Tag.radix}).
   */
  radix?: string;
  /**
   * Member external-access permission as authored in the L5X ("Read/Write",
   * "Read Only", "None"). Imported read-only metadata; preserved so it
   * round-trips through export (mirrors {@link Tag.externalAccess}).
   */
  externalAccess?: ExternalAccess;
  /**
   * True when the member is a hidden bit-overlay host member, as authored in
   * the L5X (`Hidden="true"`). Logix represents BOOL members as bit fields
   * packed onto a hidden host SINT/INT/DINT member; preserving the flag keeps
   * the exact member layout intact across import -> export.
   */
  hidden?: boolean;
  /**
   * Host member name that this BOOL member overlays a bit of (`Target`).
   * Imported read-only layout metadata; preserved so the bit packing
   * round-trips through export.
   */
  target?: string;
  /**
   * Bit position within {@link target} that this BOOL member occupies
   * (`BitNumber`). Imported read-only layout metadata; preserved so the bit
   * packing round-trips through export.
   */
  bitNumber?: number;
}

/** An Add-On Instruction parameter (Input / Output / InOut). */
export interface AoiParameter {
  name: string;
  dataType: string;
  /** Parameter usage: "Input" | "Output" | "InOut" (as imported). */
  usage?: string;
  required?: boolean;
  /** First-dimension length when the parameter is an array (e.g. an InOut array passed by reference). */
  dimension?: number;
  /** Full parameter array dimensions, e.g. DINT[2,3] -> [2, 3]. Imported read-only metadata. */
  dimensions?: number[];
  /**
   * Whether the parameter is shown on the instruction face when the AOI is
   * placed in ladder (`Visible="true"`). Independent of {@link required}: an
   * Input/Output parameter can be required without being visible, or visible
   * without being required. Imported read-only display metadata; preserved so
   * the instruction-face layout round-trips through export (mirrors
   * {@link required}).
   */
  visible?: boolean;
  defaultValue?: string;
  description?: string;
  /**
   * Display radix as authored in the L5X (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"). Imported read-only metadata that affects display only;
   * preserved verbatim so it round-trips through export (mirrors {@link Tag.radix}
   * and {@link AoiLocalTag.radix}).
   */
  radix?: string;
  /**
   * Parameter external-access permission as authored in the L5X ("Read/Write",
   * "Read Only", "None"). Imported read-only metadata; preserved so it
   * round-trips through export (mirrors {@link Tag.externalAccess} and
   * {@link AoiLocalTag.externalAccess}).
   */
  externalAccess?: ExternalAccess;
  /**
   * Whether the parameter is declared read-only constant (`Constant="true"`),
   * supported on Input parameters. Imported read-only metadata; preserved
   * verbatim so it round-trips through export (mirrors
   * {@link ProgramParameter.constant} and {@link Tag.constant}).
   */
  constant?: boolean;
}

/** A local (private) tag inside an Add-On Instruction. */
export interface AoiLocalTag {
  name: string;
  dataType: string;
  /** First-dimension length when the local tag is an array. */
  dimension?: number;
  /** Full local-tag array dimensions, e.g. DINT[2,3] -> [2, 3]. */
  dimensions?: number[];
  description?: string;
  /**
   * Display radix as authored in the L5X (e.g. "Decimal", "Hex", "Binary",
   * "ASCII", "Float"). Imported read-only metadata that affects display only;
   * preserved verbatim so it round-trips through export (mirrors {@link Tag.radix}).
   */
  radix?: string;
  /**
   * Local-tag external-access permission as authored in the L5X ("Read/Write",
   * "Read Only", "None"). Imported read-only metadata; preserved so it
   * round-trips through export (mirrors {@link Tag.externalAccess}).
   */
  externalAccess?: ExternalAccess;
}

export interface AddOnInstruction {
  id: string;
  name: string;
  description?: string;
  revision?: string;
  /**
   * Revision-extension string as authored in the L5X (`RevisionExtension`, e.g.
   * "-beta"). Imported read-only metadata that pairs with {@link revision};
   * preserved verbatim so it round-trips through export.
   */
  revisionExtension?: string;
  /**
   * Software (Studio 5000) revision the AOI definition was authored against as
   * written in the L5X (`SoftwareRevision`, e.g. "v32.11"). Imported read-only
   * metadata that pairs with {@link revision}; preserved verbatim so it
   * round-trips through export (mirrors {@link revisionExtension}).
   */
  softwareRevision?: string;
  /**
   * Defining vendor as authored in the L5X (`Vendor`). Imported read-only
   * metadata (display only; never used to talk to a controller); preserved
   * verbatim so it round-trips through export.
   */
  vendor?: string;
  /** Safety/source signature ID, when the export includes one. */
  signature?: string;
  /**
   * Authoring identity as authored in the L5X (`CreatedDate` / `CreatedBy` /
   * `EditedDate` / `EditedBy`). Present in nearly every Studio 5000 AOI export.
   * Imported read-only metadata (display only; never parsed, validated, or used
   * to talk to a controller); preserved verbatim so the change history round-trips
   * through export (mirrors {@link revisionExtension} and {@link vendor}).
   */
  createdDate?: string;
  createdBy?: string;
  editedDate?: string;
  editedBy?: string;
  /**
   * Free-text revision note as authored in the L5X (`<RevisionNote>` child).
   * Imported read-only documentation metadata (display only; never parsed or
   * validated); preserved verbatim so it round-trips through export (mirrors
   * {@link additionalHelpText}).
   */
  revisionNote?: string;
  /**
   * Free-text help shown for the AOI as authored in the L5X
   * (`<AdditionalHelpText>` child). Imported read-only documentation metadata
   * (display only; never parsed or validated); preserved verbatim so it
   * round-trips through export (mirrors {@link revisionNote}).
   */
  additionalHelpText?: string;
  /** True when the AOI is source-protected, so its logic is not available to inspect. */
  protected?: boolean;
  /** Raw source-protection type (e.g. "Protected"), when present. */
  protectionType?: string;
  /**
   * Safety partition ("Safety" / "Standard") as authored in the L5X `Class`
   * attribute. Imported read-only metadata (never used here to drive a safety
   * task); kept so the partition round-trips on export (mirrors
   * {@link Tag.safetyClass} and {@link Program.safetyClass}).
   */
  safetyClass?: string;
  /**
   * Scan-mode execution flags as authored in the L5X
   * (`ExecutePrescan` / `ExecutePostscan` / `ExecuteEnableInFalse`). These control
   * whether the AOI runs its prescan/postscan routines and whether its logic
   * executes while EnableIn is false. Imported read-only metadata (never used to
   * drive the offline simulator); preserved verbatim so the scan-mode
   * configuration round-trips through export.
   */
  executePrescan?: boolean;
  executePostscan?: boolean;
  executeEnableInFalse?: boolean;
  parameters: AoiParameter[];
  localTags: AoiLocalTag[];
  /** Names of the AOI's imported routines (logic), read-only summary. */
  routineNames: string[];
  /** Imported AOI routines. Ladder routines can execute offline when not protected. */
  routines?: Routine[];
}

export interface IOConfiguration {
  modules: IoModule[];
}

export interface IoPort {
  id?: string;
  type?: string;
  address?: string;
  upstream?: boolean;
  /**
   * Backplane/chassis size (slot count) from the port's `<Bus Size="N"/>` child.
   * Read-only display metadata; preserved verbatim so it round-trips through export.
   */
  busSize?: number;
  /**
   * CIP Safety Network Number (`SafetyNetwork`, e.g. "16#0000_05a2_4567_89ab")
   * identifying the safety subnet this port belongs to. Present on GuardLogix
   * controller backplane/Ethernet ports and CIP Safety I/O modules. Read-only
   * metadata; never used to verify a safety connection or talk to a controller,
   * preserved verbatim so it round-trips through export.
   */
  safetyNetwork?: string;
}

/**
 * A single I/O connection as authored in a module's
 * `<Communications><Connections><Connection>`. Read-only configuration
 * metadata; never used to open a real controller connection, preserved
 * verbatim so the connection settings (notably the requested packet interval)
 * survive export -> import (mirrors {@link ConsumeInfo}).
 */
export interface ModuleConnection {
  /** Connection name (`Name`, e.g. "Data", "Input", "Output"). */
  name?: string;
  /** Requested packet interval in microseconds (`RPI`). */
  rpi?: number;
  /** Connection role (`Type`, e.g. "Input", "Output", "Standard"). */
  type?: string;
  /**
   * Connection scheduling priority (`Priority`, e.g. "Scheduled", "High",
   * "Low"). Read-only quality-of-service metadata; never used to open a real
   * controller connection, preserved verbatim so it round-trips through export.
   */
  priority?: string;
  /** Whether the connection is unicast rather than multicast (`Unicast`). */
  unicast?: boolean;
  /**
   * Event identifier for event-triggered connections (`EventID`, commonly `0`
   * on standard input connections). Read-only configuration metadata; never
   * used to open a real controller connection, preserved verbatim so it
   * round-trips through export.
   */
  eventId?: number;
  /**
   * Whether the connection may be triggered programmatically to fire an event
   * task (`ProgrammaticallySendEventTrigger`, pairs with `EventID` on input
   * connections). Read-only configuration metadata; never used to open a real
   * controller connection or fire an event, preserved verbatim so it
   * round-trips through export (mirrors the produced-tag flag of the same name).
   */
  programmaticallySendEventTrigger?: boolean;
  /**
   * How the input connection is delivered (`InputConnectionType`, e.g.
   * "Multicast", "Unicast", "Null"). Read-only quality-of-service metadata;
   * never used to open a real controller connection, preserved verbatim so it
   * round-trips through export.
   */
  inputConnectionType?: string;
  /**
   * What triggers input data production (`InputProductionTrigger`, e.g.
   * "Cyclic", "COS", "Application"). Read-only quality-of-service metadata;
   * never used to open a real controller connection, preserved verbatim so it
   * round-trips through export.
   */
  inputProductionTrigger?: string;
  /**
   * Whether the output connection allows a redundant owner
   * (`OutputRedundantOwner`). Read-only configuration metadata; never used to
   * open a real controller connection, preserved verbatim so it round-trips
   * through export.
   */
  outputRedundantOwner?: boolean;
}

export interface IoModule {
  id: string;
  name: string;
  catalogNumber?: string;
  slot?: number;
  description?: string;
  parentModule?: string;
  parentPortId?: string;
  commPath?: string;
  vendor?: string;
  productType?: string;
  productCode?: string;
  majorRevision?: string;
  minorRevision?: string;
  electronicKeying?: string;
  inhibited?: boolean;
  /**
   * `MajorFault` attribute — whether a lost connection in Run mode faults the
   * controller. Read-only configuration metadata; preserved so it round-trips.
   */
  majorFault?: boolean;
  ports?: IoPort[];
  /**
   * I/O connections as authored in `<Communications><Connections>`. Read-only
   * configuration metadata (notably the requested packet interval); never used
   * to open a real controller connection, preserved verbatim so the connection
   * settings round-trip through export.
   */
  connections?: ModuleConnection[];
}
