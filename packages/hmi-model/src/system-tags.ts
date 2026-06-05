/**
 * Built-in HMI system-tag registry.
 *
 * ESCO HMI Designer exposes a fixed catalog of read-only "system" tags
 * that report runtime state (date/time, alarms, the active display, controller
 * connection, device/network identity, security, …). They are not part of the
 * controller tag database, so binding/trend/data-log verification must check
 * them against this catalog rather than the project's controller tags.
 *
 * This is the single source of truth for that catalog: {@link validateHmiProject}
 * defaults to it when a caller does not supply its own `knownSystemTags`, and a
 * binding-source picker can offer {@link HMI_SYSTEM_TAGS} directly so the names
 * it presents always match the names verification accepts.
 *
 * Paths use HMI Designer's dotted `System.<Area>.<Name>` convention. The set is
 * grouped by the areas listed in the parity spec (alarms, auto-logoff,
 * controller, data logs, date/time, device, display, Ethernet, project events,
 * security, SMTP, VNC) and can be extended without touching any caller.
 */

export type HmiSystemTagCategory =
  | "alarms"
  | "auto-logoff"
  | "controller"
  | "data-logs"
  | "date-time"
  | "device"
  | "display"
  | "ethernet"
  | "project-events"
  | "security"
  | "smtp"
  | "vnc";

export interface HmiSystemTag {
  /** Fully-qualified binding path, e.g. "System.DateTime". */
  path: string;
  /** Atomic Logix-style data type a binding can expect. */
  dataType: "BOOL" | "DINT" | "REAL" | "STRING";
  category: HmiSystemTagCategory;
  description: string;
}

export const HMI_SYSTEM_TAGS: readonly HmiSystemTag[] = [
  // Alarms
  { path: "System.AlarmActiveCount", dataType: "DINT", category: "alarms", description: "Number of alarms currently in alarm." },
  { path: "System.AlarmUnacknowledgedCount", dataType: "DINT", category: "alarms", description: "Number of unacknowledged alarms." },
  { path: "System.AlarmAcknowledgedCount", dataType: "DINT", category: "alarms", description: "Number of acknowledged alarms still active." },
  { path: "System.AlarmSuppressedCount", dataType: "DINT", category: "alarms", description: "Number of suppressed alarms." },

  // Auto log-off
  { path: "System.AutoLogoffEnabled", dataType: "BOOL", category: "auto-logoff", description: "Whether inactivity auto log-off is enabled." },
  { path: "System.AutoLogoffTimeout", dataType: "DINT", category: "auto-logoff", description: "Inactivity timeout, in seconds, before auto log-off." },

  // Controller
  { path: "System.ControllerConnectionStatus", dataType: "BOOL", category: "controller", description: "True when the bound controller connection is healthy." },
  { path: "System.ControllerMode", dataType: "STRING", category: "controller", description: "Controller mode reported to the display." },

  // Data logs
  { path: "System.DataLogActive", dataType: "BOOL", category: "data-logs", description: "True while a data log model is actively recording." },
  { path: "System.DataLogStatus", dataType: "STRING", category: "data-logs", description: "Most recent data-log status message." },

  // Date and time
  { path: "System.DateTime", dataType: "STRING", category: "date-time", description: "Local date and time formatted for display." },
  { path: "System.Date", dataType: "STRING", category: "date-time", description: "Local date formatted for display." },
  { path: "System.Time", dataType: "STRING", category: "date-time", description: "Local time formatted for display." },
  { path: "System.UniversalDateTime", dataType: "STRING", category: "date-time", description: "UTC date and time formatted for display." },

  // Device
  { path: "System.DeviceName", dataType: "STRING", category: "device", description: "Configured name of the HMI device." },
  { path: "System.DeviceModel", dataType: "STRING", category: "device", description: "Hardware model of the HMI device." },
  { path: "System.DeviceSerialNumber", dataType: "STRING", category: "device", description: "Serial number of the HMI device." },

  // Display
  { path: "System.CurrentScreen", dataType: "STRING", category: "display", description: "Name of the currently shown screen." },
  { path: "System.PreviousScreen", dataType: "STRING", category: "display", description: "Name of the previously shown screen." },
  { path: "System.CurrentLanguage", dataType: "STRING", category: "display", description: "Active language pack identifier." },

  // Ethernet
  { path: "System.EthernetIpAddress", dataType: "STRING", category: "ethernet", description: "IP address of the HMI device." },
  { path: "System.EthernetLinkStatus", dataType: "BOOL", category: "ethernet", description: "True when the Ethernet link is up." },

  // Project events
  { path: "System.ProjectName", dataType: "STRING", category: "project-events", description: "Name of the running HMI project." },
  { path: "System.RuntimeVersion", dataType: "STRING", category: "project-events", description: "Runtime version string." },

  // Security
  { path: "System.CurrentUser", dataType: "STRING", category: "security", description: "User name of the logged-in operator." },
  { path: "System.CurrentUserFullName", dataType: "STRING", category: "security", description: "Full name of the logged-in operator." },
  { path: "System.SecurityAuthority", dataType: "STRING", category: "security", description: "Active security authority/source." },

  // SMTP
  { path: "System.SmtpStatus", dataType: "STRING", category: "smtp", description: "Most recent SMTP (email) delivery status." },

  // VNC
  { path: "System.VncEnabled", dataType: "BOOL", category: "vnc", description: "True when the VNC server is enabled." },
  { path: "System.VncClientCount", dataType: "DINT", category: "vnc", description: "Number of connected VNC clients." },
];

/** Just the binding paths of {@link HMI_SYSTEM_TAGS}, for membership checks. */
export function hmiSystemTagPaths(): string[] {
  return HMI_SYSTEM_TAGS.map((tag) => tag.path);
}

const systemTagDataTypes = new Map<string, HmiSystemTag["dataType"]>(
  HMI_SYSTEM_TAGS.map((tag) => [tag.path, tag.dataType]),
);

/**
 * The atomic data type a known system tag reports, or `undefined` for an
 * unknown path. Lets verification reuse the registry type when a binding source
 * only carries the path, so a type mismatch is still caught.
 */
export function hmiSystemTagDataType(path: string): HmiSystemTag["dataType"] | undefined {
  return systemTagDataTypes.get(path.trim());
}
