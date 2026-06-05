import type { AddIoModuleInput, IoModuleSetupTagInput } from "@esco/project-actions";
import { escoBrandText } from "./branding";
import workflowCatalog from "./data/new-module-workflow-catalog.raw.json";

export const IO_DEVICE_CATEGORIES = [
  "All",
  "Chassis",
  "Network",
  "Digital",
  "Analog",
  "Safety",
  "Motion",
  "Instruments",
  "Generic",
] as const;

export type IoDeviceCategoryFilter = (typeof IO_DEVICE_CATEGORIES)[number];
export type IoDeviceCatalogCategory = Exclude<IoDeviceCategoryFilter, "All">;

interface RawWorkflowCatalog {
  moduleCatalog: RawModuleCatalogRow[];
  meterCatalog: RawMeterCatalogRow[];
  imageLibrary: RawImageLibraryRow[];
  imageFiles: Array<{ imageKey: string; file: string; row: number }>;
}

interface RawModuleCatalogRow {
  "ESCO Display Name": string;
  "Template ID": string;
  "Device Family": string;
  "Device Class": string;
  "Image Key": string;
  "Compatibility Ref": string;
  "Protocol / Bus": string;
  "Signal Type": string;
  "Channels / Points": string;
  "Data Direction": string;
  "Create Detail Screen Title": string;
  "Recommended Tabs": string;
  "Setup Method"?: string;
  "Source URL"?: string;
  "ESCO Notes"?: string;
}

interface RawMeterCatalogRow {
  "ESCO Display Name": string;
  "Template ID": string;
  "Instrument Type": string;
  "Signal/Protocol": string;
  "Typical Inputs": string;
  "Typical Outputs": string;
  "Default Tags Created": string;
  "Image Key": string;
  "Recommended Detail Tabs": string;
  "Setup Method": string;
  "Source URL": string;
  Notes: string;
}

interface RawImageLibraryRow {
  "Image Key": string;
  "ESCO Image Name": string;
  "Use For": string;
  "Do Not Use For": string;
  "Implementation Notes": string;
}

export interface IoDeviceImageInfo {
  key: string;
  name: string;
  useFor: string;
  notes: string;
}

const IO_DEVICE_IMAGE_KEYS = [
  "analog_input",
  "analog_output",
  "chassis",
  "communication",
  "controller",
  "digital_input",
  "digital_output",
  "drive",
  "gateway",
  "generic",
  "hmi",
  "meter",
  "motion",
  "remote_io",
  "safety",
  "specialty",
] as const;

export type IoDeviceImageKey = (typeof IO_DEVICE_IMAGE_KEYS)[number];

export interface IoDeviceImageLookupInput {
  imageKey?: string;
  category?: IoDeviceCatalogCategory | string;
  family?: string;
  workbookCategory?: string;
  productType?: string;
  catalogNumber?: string;
  label?: string;
  signalType?: string;
  channels?: string;
  dataDirection?: string;
  protocolBus?: string;
  signalNetwork?: string;
  setupMethod?: string;
  vendor?: string;
}

export interface IoDeviceCatalogEntry {
  id: string;
  templateId: string;
  label: string;
  detailTitle: string;
  family: string;
  category: IoDeviceCatalogCategory;
  workbookCategory: string;
  setupMethod: string;
  signalNetwork: string;
  protocolBus: string;
  signalType: string;
  channels: string;
  dataDirection: string;
  typicalUse: string;
  brandSafeNotes: string;
  sourceUrl?: string;
  recommendedTabs: string[];
  imageKey: string;
  imageName?: string;
  namePrefix: string;
  catalogNumber: string;
  productType: string;
  vendor: string;
  majorRevision: string;
  minorRevision: string;
  electronicKeying: string;
  defaultParentPortId?: string;
  connection?: AddIoModuleInput["connection"];
}

export interface IoDeviceProfileSummary {
  profile: string;
  connection: string;
  channels: string;
  configuration: string;
  data: string;
}

export interface IoDeviceChannelProfile {
  id: string;
  label: string;
  direction: string;
  signal: string;
  enabled: boolean;
  dataFormat: string;
  range: string;
  diagnostic: string;
}

export interface IoDeviceSetupTag extends IoModuleSetupTagInput {
  source: string;
}

export interface IoDeviceProfileDiagnostic {
  status: "ok" | "warning" | "error";
  label: string;
  detail: string;
}

export interface IoDeviceProfileDiagnosticInput {
  majorRevision?: string;
  minorRevision?: string;
  electronicKeying?: string;
  rpi?: number;
  slot?: number;
  slotConflict?: boolean;
}

const raw = workflowCatalog as RawWorkflowCatalog;

const CATEGORY_SORT: Record<IoDeviceCatalogCategory, number> = {
  Chassis: 0,
  Network: 1,
  Digital: 2,
  Analog: 3,
  Safety: 4,
  Motion: 5,
  Instruments: 6,
  Generic: 7,
};

const IO_DEVICE_IMAGE_KEY_SET = new Set<string>(IO_DEVICE_IMAGE_KEYS);

export const IO_DEVICE_IMAGE_LIBRARY: Record<string, IoDeviceImageInfo> = Object.fromEntries(
  raw.imageLibrary
    .filter((row) => row["Image Key"])
    .map((row) => [
      row["Image Key"],
      {
        key: row["Image Key"],
        name: escoBrandText(row["ESCO Image Name"]),
        useFor: escoBrandText(row["Use For"]),
        notes: escoBrandText(row["Implementation Notes"]),
      },
    ]),
);

function normalizedImageKey(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

export function ioDeviceFamilyImageKey(input: IoDeviceImageLookupInput | undefined): IoDeviceImageKey {
  const rawKey = normalizedImageKey(input?.imageKey);
  if (rawKey && IO_DEVICE_IMAGE_KEY_SET.has(rawKey) && rawKey !== "specialty") {
    return rawKey as IoDeviceImageKey;
  }

  const catalogNumber = input?.catalogNumber?.trim() ?? "";
  const haystack = [
    input?.category,
    input?.family,
    input?.workbookCategory,
    input?.productType,
    catalogNumber,
    input?.label,
    input?.signalType,
    input?.channels,
    input?.dataDirection,
    input?.protocolBus,
    input?.signalNetwork,
    input?.setupMethod,
    input?.vendor,
    rawKey,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const compactCatalog = catalogNumber.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (/chassis|backplane|rack system|\b1756a\d+\b/.test(haystack) || /^1756a\d+/.test(compactCatalog)) return "chassis";
  if (/controller|processor|cpu|\b1756l\d+|compactlogix|controllogix/.test(haystack) || /^1756l\d+/.test(compactCatalog)) {
    return "controller";
  }
  if (/safety|guardlogix|safe/i.test(haystack)) return "safety";
  if (/drive|power\s*flex|powerflex|\bpf\d+|vfd|inverter/.test(haystack) || /^pf\d+/.test(compactCatalog)) return "drive";
  if (/motion|servo|axis/.test(haystack)) return "motion";
  if (/gateway|io-link|iolink|bridge/.test(haystack)) return "gateway";
  if (/meter|instrument|transmitter|analyzer|scale|barcode|vision/.test(haystack)) return "meter";
  if (/remote[_\s-]?i\/?o|distributed i\/?o|point i\/?o|flex i\/?o|flex 5000|compact 5000|1734|1794|5094|5069/.test(haystack)) {
    return "remote_io";
  }
  if (/communication|adapter|network|ethernet|devicenet|controlnet|profinet|modbus|serial/.test(haystack)) return "communication";
  if (/analog/.test(haystack)) return /output|command|ao\b/.test(haystack) ? "analog_output" : "analog_input";
  if (/digital|discrete|relay|input|output|di\b|do\b/.test(haystack)) {
    return /output|relay|command|do\b/.test(haystack) ? "digital_output" : "digital_input";
  }
  if (rawKey && IO_DEVICE_IMAGE_KEY_SET.has(rawKey)) return rawKey as IoDeviceImageKey;
  return "generic";
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function cleanSafe(value: string | undefined): string {
  return escoBrandText(clean(value));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapCategory(input: {
  family: string;
  deviceClass: string;
  imageKey: string;
  signalType: string;
  protocol: string;
}): IoDeviceCatalogCategory {
  const haystack = `${input.family} ${input.deviceClass} ${input.imageKey} ${input.signalType} ${input.protocol}`.toLowerCase();
  const physicalType = `${input.family} ${input.deviceClass} ${input.imageKey}`.toLowerCase();
  const networkProfile = `${input.family} ${input.deviceClass} ${input.imageKey} ${input.signalType}`.toLowerCase();
  if (/chassis|backplane|rack system/.test(physicalType)) return "Chassis";
  if (/safety/.test(haystack)) return "Safety";
  if (/communication|adapter|gateway|network|ethernet|devicenet|controlnet|remote_io/.test(networkProfile)) return "Network";
  if (/drive|motion|servo|axis|vfd/.test(haystack)) return "Motion";
  if (/analog/.test(haystack)) return "Analog";
  if (/digital|input|output|relay/.test(haystack)) return "Digital";
  if (/meter|instrument|transmitter|analyzer|scale|barcode|vision|io-link|iolink|hart|rtd|thermocouple/.test(haystack)) return "Instruments";
  return "Generic";
}

function namePrefixFor(entry: {
  catalogNumber: string;
  imageKey: string;
  category: IoDeviceCatalogCategory;
  dataDirection: string;
  label: string;
}): string {
  const scope = entry.catalogNumber.match(/^(1734|1794|5094|5069)-/) ? "Remote" : "Local";
  const haystack = `${entry.imageKey} ${entry.dataDirection} ${entry.label}`.toLowerCase();
  if (entry.category === "Chassis") return `${scope}_CHASSIS`;
  if (entry.category === "Network") return `${scope}_NET`;
  if (entry.category === "Safety") return /output/.test(haystack) ? `${scope}_SO` : `${scope}_SI`;
  if (entry.category === "Motion") return `${scope}_AXIS`;
  if (entry.category === "Instruments") return `${scope}_INST`;
  if (entry.category === "Analog") return /output/.test(haystack) ? `${scope}_AO` : `${scope}_AI`;
  if (entry.category === "Digital") return /output/.test(haystack) ? `${scope}_DO` : `${scope}_DI`;
  return `${scope}_GEN`;
}

function connectionFor(input: {
  category: IoDeviceCatalogCategory;
  dataDirection: string;
  protocol: string;
  imageKey: string;
}): AddIoModuleInput["connection"] | undefined {
  if (input.category === "Chassis" || /controller/i.test(input.dataDirection)) return undefined;
  const haystack = `${input.dataDirection} ${input.protocol} ${input.imageKey}`.toLowerCase();
  if (/n\/a/.test(haystack)) return undefined;
  const output = /output|command/.test(haystack);
  const safety = input.category === "Safety";
  return {
    name: "Data",
    type: safety ? (output ? "SafetyOutput" : "SafetyInput") : output ? "Output" : "Input",
    rpi: safety ? 20000 : input.category === "Network" ? 50000 : 100000,
    priority: "Scheduled",
    ...(output ? { unicast: true } : {}),
    inputConnectionType: "Multicast",
    inputProductionTrigger: "Cyclic",
  };
}

function sentenceParts(values: Array<string | undefined>): string {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).join(" / ");
}

export function ioDeviceKeyingLabel(value: string | undefined): string {
  if (value === "ExactMatch") return "Exact Match";
  if (value === "Disabled" || value === "DisableKeying") return "Disable Keying";
  if (value === "CompatibleModule") return "Compatible Module";
  return value?.trim() || "Not Specified";
}

function parsedChannelCount(entry: IoDeviceCatalogEntry): number {
  const haystack = `${entry.channels} ${entry.label} ${entry.signalType}`.toLowerCase();
  const match = haystack.match(/\b(\d+)\s*(?:-| )?(?:channel|point|input|output|relay|axis|loop|zone)s?\b/);
  if (!match) return 0;
  const count = Number(match[1]);
  return Number.isInteger(count) && count > 0 && count <= 64 ? count : 0;
}

function channelDataFormat(entry: IoDeviceCatalogEntry): string {
  const haystack = `${entry.category} ${entry.channels} ${entry.signalType} ${entry.productType}`.toLowerCase();
  if (/safety/.test(haystack)) return "Safety BOOL";
  if (/digital|relay|discrete/.test(haystack)) return "BOOL";
  if (/hart/.test(haystack)) return "Float + HART";
  if (/rtd|thermocouple|temperature|analog/.test(haystack)) return "Float";
  if (/motion|axis/.test(haystack)) return "Axis profile";
  return "Profile default";
}

function channelRange(entry: IoDeviceCatalogEntry): string {
  const haystack = `${entry.channels} ${entry.signalType} ${entry.productType} ${entry.signalNetwork}`.toLowerCase();
  if (/hart/.test(haystack)) return "4-20 mA + HART";
  if (/rtd/.test(haystack)) return "RTD";
  if (/thermocouple|tc/.test(haystack)) return "Thermocouple";
  if (/analog/.test(haystack)) return /output/.test(haystack) ? "0-10 V / 4-20 mA output" : "0-10 V / 4-20 mA input";
  if (/safety/.test(haystack)) return "Dual-channel safety";
  if (/relay|digital|discrete/.test(haystack)) return "On/Off";
  return entry.signalNetwork || entry.protocolBus || "Profile-defined";
}

function channelDirection(entry: IoDeviceCatalogEntry): string {
  const text = entry.dataDirection.toLowerCase();
  if (/input/.test(text) && /output/.test(text)) return "Input/Output";
  if (/output|command/.test(text)) return "Output";
  if (/input|status/.test(text)) return "Input";
  return entry.category === "Motion" ? "Axis" : "Profile";
}

export function ioDeviceChannelProfiles(entry: IoDeviceCatalogEntry | undefined): IoDeviceChannelProfile[] {
  if (!entry) return [];
  const count = parsedChannelCount(entry);
  if (count === 0) return [];
  const noun = entry.category === "Digital" || entry.category === "Safety" ? "Point" : "Channel";
  const signal = entry.signalType || entry.productType || entry.category;
  const dataFormat = channelDataFormat(entry);
  const range = channelRange(entry);
  const direction = channelDirection(entry);
  return Array.from({ length: count }, (_, index) => ({
    id: `Ch${index}`,
    label: `${noun} ${index}`,
    direction,
    signal,
    enabled: true,
    dataFormat,
    range,
    diagnostic: "Profile default, offline review only",
  }));
}

function tagNamePart(value: string | undefined, fallback: string): string {
  const cleaned = (value?.trim() || fallback)
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  const candidate = cleaned || fallback;
  return /^[A-Za-z_]/.test(candidate) ? candidate : `_${candidate}`;
}

function setupTagBaseNames(entry: IoDeviceCatalogEntry): string[] {
  if (entry.category !== "Instruments") return [];
  return entry.brandSafeNotes
    .split(/[;,]/)
    .map((part) => tagNamePart(part, "Value"))
    .filter(Boolean);
}

function setupTagDataType(label: string, context: string): string {
  const text = `${label} ${context}`.toLowerCase();
  if (/barcode|text|string|ascii/.test(text)) return "STRING";
  if (/fault|alarm|fail|pass|goodread|no[_ ]?read|stable|trigger|cmd|command|enable|ready|done|tare/.test(text)) return "BOOL";
  if (/status|result[_ ]?code|code|port[_ ]?data|port[_ ]?fault|raw|count|counter|integer|dint|raw\/proportional/.test(text)) return "DINT";
  if (/bool|digital|discrete|relay|on\/off|safety/.test(text)) return "BOOL";
  return "REAL";
}

function setupTagAccess(label: string): "read-write" | "read-only" {
  return /cmd|command|trigger|tare|reset|enable|start|stop|setpoint|sp$/i.test(label) ? "read-write" : "read-only";
}

function uniqueSetupTagName(base: string, reserved: Set<string>): string {
  const cleaned = tagNamePart(base, "DeviceTag");
  let candidate = cleaned;
  for (let index = 2; reserved.has(candidate.toLowerCase()); index += 1) {
    candidate = `${cleaned}_${String(index).padStart(2, "0")}`;
  }
  reserved.add(candidate.toLowerCase());
  return candidate;
}

export function ioDeviceSetupTags(
  entry: IoDeviceCatalogEntry | undefined,
  input: {
    moduleName: string;
    channels?: IoDeviceChannelProfile[];
    existingNames?: string[];
  },
): IoDeviceSetupTag[] {
  if (!entry) return [];
  const modulePart = tagNamePart(input.moduleName, entry.namePrefix || "Module");
  const reserved = new Set((input.existingNames ?? []).map((name) => name.toLowerCase()));
  const tags: IoDeviceSetupTag[] = [];
  const addTag = (suffix: string, context: string, source: string) => {
    const cleanSuffix = tagNamePart(suffix, "Value");
    const name = uniqueSetupTagName(`${modulePart}_${cleanSuffix}`, reserved);
    tags.push({
      name,
      dataType: setupTagDataType(cleanSuffix, context),
      description: `Offline ${entry.label} setup tag for ${input.moduleName || modulePart}: ${source}. No controller connection is created.`,
      externalAccess: setupTagAccess(cleanSuffix),
      source,
    });
  };

  const defaultNames = setupTagBaseNames(entry);
  if (defaultNames.length > 0) {
    for (const defaultName of defaultNames) addTag(defaultName, entry.signalType, `catalog default ${defaultName}`);
  } else {
    for (const channel of (input.channels ?? []).filter((row) => row.enabled)) {
      addTag(channel.id || channel.label, `${channel.dataFormat} ${channel.signal} ${channel.range}`, `${channel.label} ${channel.range}`);
    }
  }

  if (entry.connection) {
    if (!tags.some((tag) => /_status(?:_\d+)?$/i.test(tag.name))) {
      addTag("Status", entry.productType, "module status word");
    }
    if (!tags.some((tag) => /_fault(?:_\d+)?$/i.test(tag.name))) {
      addTag("Fault", entry.productType, "module fault bit");
    }
  }

  return tags;
}

function normalizedRevision(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function ioDeviceProfileDiagnostics(
  entry: IoDeviceCatalogEntry | undefined,
  input: IoDeviceProfileDiagnosticInput = {},
): IoDeviceProfileDiagnostic[] {
  const diagnostics: IoDeviceProfileDiagnostic[] = [
    {
      status: "ok",
      label: "Offline profile review",
      detail: "Catalog metadata is reviewed locally; no controller connection, EDS upload, or hardware interrogation is attempted.",
    },
  ];

  if (!entry) {
    diagnostics.push({
      status: "warning",
      label: "Catalog profile not matched",
      detail: "This module can still be edited from imported metadata, but channel defaults and catalog revision guidance are unavailable.",
    });
    return diagnostics;
  }

  const channels = ioDeviceChannelProfiles(entry);
  diagnostics.push({
    status: channels.length > 0 ? "ok" : "warning",
    label: channels.length > 0 ? "Channel profile loaded" : "No channel table",
    detail:
      channels.length > 0
        ? `${channels.length} profile channel${channels.length === 1 ? "" : "s"} are available for offline review.`
        : "The catalog only provides summary data for this module class.",
  });

  if (!entry.connection) {
    diagnostics.push({
      status: "warning",
      label: "No cyclic connection",
      detail:
        entry.category === "Chassis"
          ? "Chassis/backplane entries do not define a cyclic I/O connection."
          : "The profile does not include RPI-bearing connection metadata.",
    });
  } else if (input.rpi == null || !Number.isFinite(input.rpi) || input.rpi <= 0) {
    diagnostics.push({
      status: "error",
      label: "RPI required",
      detail: "A cyclic I/O connection needs a positive requested packet interval before it can be saved.",
    });
  }

  if (input.slotConflict) {
    diagnostics.push({
      status: "error",
      label: "Slot conflict",
      detail: `Slot ${input.slot ?? ""} is already occupied at this parent I/O location.`,
    });
  } else if (input.slot == null || !Number.isFinite(input.slot)) {
    diagnostics.push({
      status: "warning",
      label: "Slot not assigned",
      detail: "Studio-style chassis placement review is limited until a module slot is authored.",
    });
  }

  const keying = input.electronicKeying?.trim() || entry.electronicKeying;
  if (keying === "Disabled" || keying === "DisableKeying") {
    diagnostics.push({
      status: "warning",
      label: "Electronic keying disabled",
      detail: "Disabled keying is preserved as offline metadata; review the installed hardware and device definition file before applying it in licensed external PLC engineering software.",
    });
  } else if (keying && !["ExactMatch", "CompatibleModule"].includes(keying)) {
    diagnostics.push({
      status: "error",
      label: "Unknown electronic keying",
      detail: `Electronic keying value "${keying}" is not a supported Studio-style option.`,
    });
  }

  const authoredMajor = normalizedRevision(input.majorRevision);
  const profileMajor = normalizedRevision(entry.majorRevision);
  if (keying === "ExactMatch" && authoredMajor != null && profileMajor != null && authoredMajor !== profileMajor) {
    diagnostics.push({
      status: "warning",
      label: "Exact Match revision review",
      detail: `Authored major revision ${input.majorRevision} differs from the catalog default ${entry.majorRevision}.`,
    });
  }

  if (/device profile|generic ethernet|third-party|vendor/i.test(entry.setupMethod)) {
    diagnostics.push({
      status: "warning",
      label: "Vendor profile boundary",
      detail: "The profile is represented from catalog/device-profile metadata only; ESCO does not install device definition files or browse live devices.",
    });
  }

  return diagnostics;
}

export function ioDeviceProfileSummary(entry: IoDeviceCatalogEntry): IoDeviceProfileSummary {
  const connection = entry.connection
    ? sentenceParts([
        entry.connection.name || "Data",
        entry.connection.type || "Connection",
        entry.connection.rpi != null ? `RPI ${entry.connection.rpi} us` : undefined,
        entry.connection.priority,
        entry.connection.unicast ? "Unicast" : entry.connection.inputConnectionType,
        entry.connection.inputProductionTrigger,
      ])
    : entry.category === "Chassis"
      ? "Backplane or chassis profile; no cyclic I/O connection"
      : "Profile does not define a cyclic I/O connection";
  const channels = sentenceParts([entry.channels, entry.signalType, entry.dataDirection]) || "Profile-defined points";
  const data = sentenceParts([entry.protocolBus || entry.signalNetwork, entry.dataDirection, entry.productType]) || entry.productType;
  return {
    profile: sentenceParts([entry.vendor, entry.family, `${entry.category} profile`]),
    connection,
    channels,
    configuration: entry.setupMethod || "Catalog profile",
    data,
  };
}

function revisionFor(category: IoDeviceCatalogCategory, setupMethod: string): [string, string] {
  if (category === "Motion") return ["16", "1"];
  if (category === "Network") return ["5", "1"];
  if (category === "Safety") return ["2", "1"];
  if (/built-in profile/i.test(setupMethod)) return ["3", "1"];
  if (/device profile|device definition|eds|generic ethernet|vendor|third-party/i.test(setupMethod)) return ["1", "0"];
  return ["3", "1"];
}

function keyingFor(category: IoDeviceCatalogCategory, setupMethod: string): string {
  if (/built-in profile/i.test(setupMethod)) return category === "Safety" ? "ExactMatch" : "CompatibleModule";
  if (/device profile|device definition|eds|generic ethernet|third-party|generic/i.test(setupMethod)) return "Disabled";
  if (category === "Safety") return "ExactMatch";
  return "CompatibleModule";
}

function defaultParentPortIdFor(category: IoDeviceCatalogCategory): string | undefined {
  if (category === "Network" || category === "Generic") return "2";
  return undefined;
}

function recommendedTabs(value: string): string[] {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

function toModuleEntry(row: RawModuleCatalogRow, index: number): IoDeviceCatalogEntry {
  const rawLabel = clean(row["ESCO Display Name"]);
  const label = cleanSafe(row["ESCO Display Name"]);
  const catalogNumber = clean(row["Compatibility Ref"]) || rawLabel;
  const rawFamily = clean(row["Device Family"]) || "ESCO Devices";
  const family = escoBrandText(rawFamily);
  const rawImageKey = clean(row["Image Key"]) || "generic";
  const rawProductType = clean(row["Device Class"]) || rawLabel;
  const productType = escoBrandText(rawProductType);
  const rawProtocolBus = clean(row["Protocol / Bus"]);
  const protocolBus = escoBrandText(rawProtocolBus);
  const rawSignalType = clean(row["Signal Type"]);
  const signalType = escoBrandText(rawSignalType);
  const dataDirection = cleanSafe(row["Data Direction"]);
  const rawSetupMethod = clean(row["Setup Method"]) || "Built-in profile / device profile / Generic Ethernet";
  const setupMethod = escoBrandText(rawSetupMethod);
  const category = mapCategory({ family: rawFamily, deviceClass: rawProductType, imageKey: rawImageKey, signalType: rawSignalType, protocol: rawProtocolBus });
  const imageKey = ioDeviceFamilyImageKey({
    imageKey: rawImageKey,
    category,
    family: rawFamily,
    productType: rawProductType,
    catalogNumber,
    label: rawLabel,
    signalType: rawSignalType,
    channels: clean(row["Channels / Points"]),
    dataDirection: clean(row["Data Direction"]),
    protocolBus: rawProtocolBus,
    setupMethod: rawSetupMethod,
  });
  const [majorRevision, minorRevision] = revisionFor(category, rawSetupMethod);
  const templateId = clean(row["Template ID"]) || `esco.template.${slug(catalogNumber || rawLabel)}`;
  return {
    id: `${templateId}-${slug(catalogNumber)}-${index}`,
    templateId,
    label,
    detailTitle: cleanSafe(row["Create Detail Screen Title"]) || label,
    family,
    category,
    workbookCategory: family,
    setupMethod,
    signalNetwork: protocolBus,
    protocolBus,
    signalType,
    channels: cleanSafe(row["Channels / Points"]),
    dataDirection,
    typicalUse: escoBrandText([rawSignalType, clean(row["Channels / Points"]), clean(row["Data Direction"])].filter(Boolean).join(" · ")),
    brandSafeNotes: cleanSafe(row["ESCO Notes"]) || IO_DEVICE_IMAGE_LIBRARY[imageKey]?.notes || "",
    recommendedTabs: recommendedTabs(cleanSafe(row["Recommended Tabs"])),
    imageKey,
    imageName: IO_DEVICE_IMAGE_LIBRARY[imageKey]?.name,
    namePrefix: namePrefixFor({ catalogNumber, imageKey, category, dataDirection, label }),
    catalogNumber,
    productType,
    vendor: "ESCO Automation",
    majorRevision,
    minorRevision,
    electronicKeying: keyingFor(category, rawSetupMethod),
    defaultParentPortId: defaultParentPortIdFor(category),
    connection: connectionFor({ category, dataDirection: clean(row["Data Direction"]), protocol: rawProtocolBus, imageKey }),
  };
}

function toMeterEntry(row: RawMeterCatalogRow, index: number): IoDeviceCatalogEntry {
  const rawLabel = clean(row["ESCO Display Name"]);
  const label = cleanSafe(row["ESCO Display Name"]);
  const templateId = clean(row["Template ID"]) || `esco.instrument.${slug(rawLabel)}`;
  const rawImageKey = clean(row["Image Key"]) || "meter";
  const rawInstrumentType = clean(row["Instrument Type"]);
  const rawSignalProtocol = clean(row["Signal/Protocol"]);
  const rawSetupMethod = clean(row["Setup Method"]);
  const category = mapCategory({
    family: "Process Instruments",
    deviceClass: rawInstrumentType,
    imageKey: rawImageKey,
    signalType: clean(row["Typical Inputs"]),
    protocol: rawSignalProtocol,
  });
  const imageKey = ioDeviceFamilyImageKey({
    imageKey: rawImageKey,
    category,
    family: "Process Instruments",
    productType: rawInstrumentType,
    catalogNumber: label,
    label: rawLabel,
    signalType: rawInstrumentType,
    channels: clean(row["Typical Inputs"]),
    dataDirection: "Input/Output",
    protocolBus: rawSignalProtocol,
    setupMethod: rawSetupMethod,
  });
  const [majorRevision, minorRevision] = revisionFor(category, rawSetupMethod);
  return {
    id: `${templateId}-${index}`,
    templateId,
    label,
    detailTitle: label,
    family: "Process Instruments",
    category,
    workbookCategory: "Process Instruments",
    setupMethod: escoBrandText(rawSetupMethod),
    signalNetwork: escoBrandText(rawSignalProtocol),
    protocolBus: escoBrandText(rawSignalProtocol),
    signalType: escoBrandText(rawInstrumentType),
    channels: cleanSafe(row["Typical Inputs"]),
    dataDirection: "Input/Output",
    typicalUse: cleanSafe(row.Notes) || cleanSafe(row["Typical Inputs"]),
    brandSafeNotes: cleanSafe(row["Default Tags Created"]),
    recommendedTabs: recommendedTabs(cleanSafe(row["Recommended Detail Tabs"])),
    imageKey,
    imageName: IO_DEVICE_IMAGE_LIBRARY[imageKey]?.name,
    namePrefix: "Local_INST",
    catalogNumber: label,
    productType: escoBrandText(rawInstrumentType) || label,
    vendor: "ESCO Automation",
    majorRevision,
    minorRevision,
    electronicKeying: keyingFor(category, rawSetupMethod),
    defaultParentPortId: defaultParentPortIdFor(category),
    connection: connectionFor({ category, dataDirection: "Input/Output", protocol: rawSignalProtocol, imageKey }),
  };
}

export const IO_DEVICE_CATALOG: IoDeviceCatalogEntry[] = [
  ...raw.moduleCatalog.map(toModuleEntry),
  ...raw.meterCatalog.map(toMeterEntry),
].sort((a, b) => {
  const byCategory = CATEGORY_SORT[a.category] - CATEGORY_SORT[b.category];
  if (byCategory !== 0) return byCategory;
  const byFamily = a.family.localeCompare(b.family);
  if (byFamily !== 0) return byFamily;
  return a.catalogNumber.localeCompare(b.catalogNumber, undefined, { numeric: true });
});

function normalizedCatalogToken(value: string | undefined): string {
  let text = value?.trim().toLowerCase() ?? "";
  if (!text) return "";
  text = text.replace(/\/[a-z0-9]+$/i, "");
  text = text.replace(/\s+-\s+/g, "-");
  return text.replace(/[^a-z0-9]+/g, "");
}

function catalogLookupKeys(value: string | undefined): string[] {
  const text = value?.trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const keys = new Set<string>();
  const add = (candidate: string | undefined) => {
    const key = normalizedCatalogToken(candidate);
    if (key) keys.add(key);
  };

  add(text);

  const powerFlex = lower.match(/(?:power\s*flex|powerflex|pf)\s*-?\s*(\d{3})(t)?/i);
  if (powerFlex) {
    add(`PF${powerFlex[1]}${powerFlex[2] ?? ""}`);
  }

  const withoutEthernet = lower.replace(/(?:-|\s+)?eenet\b/i, "");
  if (withoutEthernet !== lower) add(withoutEthernet);

  const controllerProcess = normalizedCatalogToken(text).match(/^(1756l8\d+e)p$/);
  if (controllerProcess) add(controllerProcess[1]);

  return [...keys];
}

function entryLookupKeys(entry: IoDeviceCatalogEntry): string[] {
  return [
    ...catalogLookupKeys(entry.catalogNumber),
    ...catalogLookupKeys(entry.productType),
    ...catalogLookupKeys(entry.label),
  ];
}

export function findIoDeviceCatalogEntry(input: { catalogNumber?: string; productType?: string }): IoDeviceCatalogEntry | undefined {
  const catalogNumber = input.catalogNumber?.trim().toLowerCase();
  if (catalogNumber) {
    const byCatalog = IO_DEVICE_CATALOG.find((entry) => entry.catalogNumber.toLowerCase() === catalogNumber);
    if (byCatalog) return byCatalog;
  }

  const inputKeys = new Set([
    ...catalogLookupKeys(input.catalogNumber),
    ...catalogLookupKeys(input.productType),
  ]);
  if (inputKeys.size > 0) {
    const byNormalizedCatalog = IO_DEVICE_CATALOG.find((entry) =>
      entryLookupKeys(entry).some((key) => inputKeys.has(key)),
    );
    if (byNormalizedCatalog) return byNormalizedCatalog;
  }

  const productType = input.productType?.trim().toLowerCase();
  if (productType) {
    return IO_DEVICE_CATALOG.find(
      (entry) => entry.productType.toLowerCase() === productType || entry.label.toLowerCase() === productType,
    );
  }
  return undefined;
}
