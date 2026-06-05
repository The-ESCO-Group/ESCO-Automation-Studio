import type { Controller, IoModule, PlcProject } from "@esco/core";

export type IoModuleReviewStatus = "reviewable" | "inhibited" | "needs-attention";

export type IoModuleReviewIssue =
  | "missing-catalog-number"
  | "missing-parent-module"
  | "missing-parent-port"
  | "duplicate-slot"
  | "no-ports"
  | "invalid-rpi"
  | "invalid-input-connection-type"
  | "invalid-input-production-trigger"
  | "invalid-electronic-keying"
  | "missing-keying-revision";

export type IoModuleReviewBoundary =
  | "no-controller-communication"
  | "no-module-connection"
  | "no-profile-channel-configuration-download"
  | "no-electronic-keying-enforcement"
  | "no-major-fault-injection"
  | "no-port-topology-browse";

export interface IoModulePortReview {
  id?: string;
  type?: string;
  address?: string;
  upstream?: boolean;
  busSize?: number;
}

export interface IoModuleProfileChannelReview {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

export type IoModuleSyntheticDiagnosticStatus = "ok" | "warning" | "error" | "info";
export type IoModuleSyntheticDiagnosticSource =
  | "identity"
  | "topology"
  | "connection"
  | "keying"
  | "profile-channels"
  | "advanced-profile"
  | "offline-boundary";

export type IoModuleAdvancedProfileFamily =
  | "drive"
  | "flex-5000"
  | "hart"
  | "bridge"
  | "remote-io"
  | "safety"
  | "standard";

export interface IoModuleSyntheticDiagnostic {
  status: IoModuleSyntheticDiagnosticStatus;
  source: IoModuleSyntheticDiagnosticSource;
  label: string;
  detail: string;
}

export interface IoModuleConnectionReview {
  name?: string;
  type?: string;
  rpi?: number;
  rpiMs?: number;
  priority?: string;
  unicast: boolean;
  inputConnectionType?: string;
  inputProductionTrigger?: string;
  outputRedundantOwner: boolean;
  status: "configured" | "missing-rpi" | "invalid";
  message: string;
}

export interface IoModuleReviewRow {
  controllerId: string;
  controllerName: string;
  moduleId: string;
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
  inhibited: boolean;
  majorFaultOnConnectionLoss: boolean;
  status: IoModuleReviewStatus;
  issues: IoModuleReviewIssue[];
  ports: IoModulePortReview[];
  connections: IoModuleConnectionReview[];
  connectionCount: number;
  profileChannels: IoModuleProfileChannelReview[];
  profileChannelCount: number;
  disabledProfileChannelCount: number;
  advancedProfileFamily: IoModuleAdvancedProfileFamily;
  advancedProfileSignals: IoModuleAdvancedProfileFamily[];
  advancedProfileLabel: string;
  advancedProfileReviewable: boolean;
  advancedProfileMessage: string;
  diagnostics: IoModuleSyntheticDiagnostic[];
  diagnosticCount: number;
  diagnosticWarningCount: number;
  diagnosticErrorCount: number;
  connectionModelled: false;
  profileChannelConfigurationDownloaded: false;
  electronicKeyingEnforced: false;
  majorFaultInjected: false;
  boundaries: IoModuleReviewBoundary[];
  message: string;
}

export interface IoModuleReviewReport {
  rows: IoModuleReviewRow[];
  moduleCount: number;
  reviewableCount: number;
  inhibitedCount: number;
  majorFaultCount: number;
  profileChannelModuleCount: number;
  advancedProfileModuleCount: number;
  driveProfileCount: number;
  flex5000ProfileCount: number;
  hartProfileCount: number;
  bridgeProfileCount: number;
  disabledProfileChannelCount: number;
  connectionMetadataCount: number;
  diagnosticWarningCount: number;
  diagnosticErrorCount: number;
  issueCount: number;
  missingParentCount: number;
  duplicateSlotCount: number;
  warnings: string[];
}

const BOUNDARIES: IoModuleReviewBoundary[] = [
  "no-controller-communication",
  "no-module-connection",
  "no-profile-channel-configuration-download",
  "no-electronic-keying-enforcement",
  "no-major-fault-injection",
  "no-port-topology-browse",
];

interface ModuleProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

const VALID_KEYING = new Set(["ExactMatch", "CompatibleModule", "Disabled", "Custom"]);
const VALID_INPUT_CONNECTION_TYPES = new Set(["Multicast", "Unicast", "Null"]);
const VALID_INPUT_PRODUCTION_TRIGGERS = new Set(["Cyclic", "COS", "Application"]);

function moduleProfileText(module: IoModule): string {
  return [
    module.name,
    module.catalogNumber,
    module.description,
    module.vendor,
    module.productType,
    module.productCode,
    module.commPath,
  ].filter(Boolean).join(" ");
}

function advancedProfileSignals(module: IoModule): IoModuleAdvancedProfileFamily[] {
  const text = moduleProfileText(module);
  const signals: IoModuleAdvancedProfileFamily[] = [];
  if (/powerflex|\bPF7\d\d\b|\bPF5\d\d\b|\bPF755T\b|\b75[35]\b|\b25[0-9A-Z]-|drive/i.test(text)) signals.push("drive");
  if (/5094|flex\s?5000|flex\s?i\/?o/i.test(text)) signals.push("flex-5000");
  if (/hart|I[FO]\d+I?H\b|IF8IH|OF8IH/i.test(text)) signals.push("hart");
  if (/\bEN[0-9]?(?:TR|T|F|BT|BR|TP|TSC|TXT)\b|EN2T|EN3TR|EN4TR|bridge|ethernet/i.test(text)) signals.push("bridge");
  if (/safety|guard|safe|IB8S|OB8S/i.test(text)) signals.push("safety");
  if (/remote|adapter|1734|1794|1791/i.test(text)) signals.push("remote-io");
  return signals.length ? signals : ["standard"];
}

function advancedProfileFamily(module: IoModule): IoModuleAdvancedProfileFamily {
  const signals = advancedProfileSignals(module);
  const primaryOrder: IoModuleAdvancedProfileFamily[] = ["drive", "hart", "bridge", "flex-5000", "safety", "remote-io", "standard"];
  return primaryOrder.find((family) => signals.includes(family)) ?? "standard";
}

function advancedProfileLabel(family: IoModuleAdvancedProfileFamily): string {
  switch (family) {
    case "drive":
      return "AC drive profile";
    case "flex-5000":
      return "FLEX 5000 / 5094 profile";
    case "hart":
      return "HART / process I/O profile";
    case "bridge":
      return "Industrial network bridge profile";
    case "remote-io":
      return "Remote I/O adapter profile";
    case "safety":
      return "Safety I/O profile";
    case "standard":
      return "Standard module profile";
  }
}

function advancedProfileReviewable(family: IoModuleAdvancedProfileFamily): boolean {
  return family !== "standard";
}

function advancedProfileMessage(module: IoModule, family: IoModuleAdvancedProfileFamily): string {
  if (!advancedProfileReviewable(family)) {
    return `Module "${module.name}" uses standard module identity; no specialty AOP profile was detected.`;
  }
  return `${advancedProfileLabel(family)} metadata for "${module.name}" is reviewable offline from imported catalog, identity, keying, connection, port, and channel fields; ESCO does not download an AOP profile, browse live diagnostics, or command the module.`;
}

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function profileChannelsOf(module: IoModule): IoModuleProfileChannelReview[] {
  const candidate = (module as IoModule & { profileChannels?: unknown }).profileChannels;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const channel = row as ModuleProfileChannel;
    return [
      {
        id: channel.id,
        label: channel.label,
        direction: channel.direction,
        signal: channel.signal,
        enabled: channel.enabled !== false,
        dataFormat: channel.dataFormat,
        range: channel.range,
        diagnostic: channel.diagnostic,
      },
    ];
  });
}

function portIdSet(module: IoModule | undefined): Set<string> {
  return new Set((module?.ports ?? []).map((port) => port.id).filter((id): id is string => Boolean(id)));
}

function duplicateSlotKey(module: IoModule): string | undefined {
  if (module.slot == null) return undefined;
  return `${module.parentModule ?? ""}:${module.parentPortId ?? ""}:${module.slot}`;
}

function slotDuplicateCounts(modules: IoModule[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const module of modules) {
    const key = duplicateSlotKey(module);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function issuesFor(module: IoModule, modulesByName: Map<string, IoModule>, duplicateSlots: Map<string, number>): IoModuleReviewIssue[] {
  const issues: IoModuleReviewIssue[] = [];
  if (!module.catalogNumber?.trim()) issues.push("missing-catalog-number");
  if (!module.ports?.length) issues.push("no-ports");

  const parentName = module.parentModule?.trim();
  if (parentName && parentName !== module.name) {
    const parent = modulesByName.get(parentName);
    if (!parent) {
      issues.push("missing-parent-module");
    } else if (module.parentPortId && !portIdSet(parent).has(module.parentPortId)) {
      issues.push("missing-parent-port");
    }
  }

  const slotKey = duplicateSlotKey(module);
  if (slotKey && (duplicateSlots.get(slotKey) ?? 0) > 1) issues.push("duplicate-slot");

  for (const connection of module.connections ?? []) {
    if (connection.rpi != null && connection.rpi <= 0) issues.push("invalid-rpi");
    if (connection.inputConnectionType != null && !VALID_INPUT_CONNECTION_TYPES.has(connection.inputConnectionType)) {
      issues.push("invalid-input-connection-type");
    }
    if (connection.inputProductionTrigger != null && !VALID_INPUT_PRODUCTION_TRIGGERS.has(connection.inputProductionTrigger)) {
      issues.push("invalid-input-production-trigger");
    }
  }

  const keying = module.electronicKeying;
  if (keying != null && !VALID_KEYING.has(keying)) issues.push("invalid-electronic-keying");
  if ((keying === "ExactMatch" || keying === "CompatibleModule") && (isBlank(module.majorRevision) || isBlank(module.minorRevision))) {
    issues.push("missing-keying-revision");
  }
  return [...new Set(issues)];
}

function issueLabel(issue: IoModuleReviewIssue): string {
  switch (issue) {
    case "missing-catalog-number":
      return "missing catalog number";
    case "missing-parent-module":
      return "missing parent module";
    case "missing-parent-port":
      return "missing parent port";
    case "duplicate-slot":
      return "duplicate slot under the same parent";
    case "no-ports":
      return "no imported ports";
    case "invalid-rpi":
      return "invalid module connection RPI";
    case "invalid-input-connection-type":
      return "invalid input connection type";
    case "invalid-input-production-trigger":
      return "invalid input production trigger";
    case "invalid-electronic-keying":
      return "invalid electronic keying";
    case "missing-keying-revision":
      return "missing keying revision";
  }
}

function messageFor(row: Omit<IoModuleReviewRow, "message">): string {
  if (row.issues.length) {
    return `I/O module "${row.name}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.inhibited) {
    return `I/O module "${row.name}" is inhibited and reviewable offline; no module connection is opened.`;
  }
  if (row.majorFaultOnConnectionLoss) {
    return `I/O module "${row.name}" is configured to major fault on connection loss; the setting is preserved but no fault is injected offline.`;
  }
  if (row.advancedProfileReviewable) {
    return `I/O module "${row.name}" has ${row.advancedProfileLabel.toLowerCase()} metadata reviewable offline; no live AOP profile download, diagnostics browse, or module command is attempted.`;
  }
  if (row.profileChannelCount > 0) {
    const disabled = row.disabledProfileChannelCount > 0 ? `; ${row.disabledProfileChannelCount} disabled` : "";
    return `I/O module "${row.name}" profile-channel metadata is reviewable offline (${row.profileChannelCount} channel${row.profileChannelCount === 1 ? "" : "s"}${disabled}); no profile configuration is downloaded or monitored.`;
  }
  return `I/O module "${row.name}" is reviewable offline; no module connection or electronic-keying check is attempted.`;
}

function connectionReviews(module: IoModule): IoModuleConnectionReview[] {
  return (module.connections ?? []).map((connection): IoModuleConnectionReview => {
    const invalid =
      (connection.rpi != null && connection.rpi <= 0) ||
      (connection.inputConnectionType != null && !VALID_INPUT_CONNECTION_TYPES.has(connection.inputConnectionType)) ||
      (connection.inputProductionTrigger != null && !VALID_INPUT_PRODUCTION_TRIGGERS.has(connection.inputProductionTrigger));
    const missingRpi = connection.rpi == null;
    const label = connection.name ? `Connection "${connection.name}"` : "Connection";
    return {
      name: connection.name,
      type: connection.type,
      rpi: connection.rpi,
      ...(connection.rpi != null ? { rpiMs: connection.rpi / 1000 } : {}),
      priority: connection.priority,
      unicast: Boolean(connection.unicast),
      inputConnectionType: connection.inputConnectionType,
      inputProductionTrigger: connection.inputProductionTrigger,
      outputRedundantOwner: Boolean(connection.outputRedundantOwner),
      status: invalid ? "invalid" : missingRpi ? "missing-rpi" : "configured",
      message: invalid
        ? `${label} has metadata that will fail offline verification until corrected.`
        : missingRpi
          ? `${label} has no authored RPI and will rely on the profile default.`
          : `${label} preserves ${connection.rpi} us RPI metadata for offline review.`,
    };
  });
}

function addDiagnostic(
  diagnostics: IoModuleSyntheticDiagnostic[],
  status: IoModuleSyntheticDiagnosticStatus,
  source: IoModuleSyntheticDiagnosticSource,
  label: string,
  detail: string,
): void {
  diagnostics.push({ status, source, label, detail });
}

function syntheticDiagnosticsFor(
  module: IoModule,
  issues: IoModuleReviewIssue[],
  profileChannels: IoModuleProfileChannelReview[],
  connections: IoModuleConnectionReview[],
  profileFamily: IoModuleAdvancedProfileFamily,
): IoModuleSyntheticDiagnostic[] {
  const diagnostics: IoModuleSyntheticDiagnostic[] = [];
  addDiagnostic(
    diagnostics,
    "ok",
    "offline-boundary",
    "Offline profile review",
    "Catalog, topology, connection, keying, and channel metadata are reviewed locally; no controller connection, path browse, profile download, or hardware interrogation is attempted.",
  );

  addDiagnostic(
    diagnostics,
    advancedProfileReviewable(profileFamily) ? "info" : "ok",
    "advanced-profile",
    advancedProfileLabel(profileFamily),
    advancedProfileMessage(module, profileFamily),
  );

  if (issues.includes("missing-catalog-number")) {
    addDiagnostic(diagnostics, "error", "identity", "Missing catalog number", "Add a catalog/profile identity before treating this as a configured I/O module.");
  } else {
    addDiagnostic(diagnostics, "ok", "identity", "Catalog identity present", `Catalog/profile identity is ${module.catalogNumber}.`);
  }

  if (issues.includes("missing-parent-module")) {
    addDiagnostic(diagnostics, "error", "topology", "Missing parent module", `Parent module "${module.parentModule}" is not present in the offline I/O tree.`);
  } else if (issues.includes("missing-parent-port")) {
    addDiagnostic(diagnostics, "error", "topology", "Missing parent port", `Parent port "${module.parentPortId}" is not available on module "${module.parentModule}".`);
  } else if (issues.includes("duplicate-slot")) {
    addDiagnostic(diagnostics, "error", "topology", "Duplicate slot", `Slot ${module.slot ?? ""} is already used under the same parent location.`);
  } else if (module.slot == null) {
    addDiagnostic(diagnostics, "warning", "topology", "Slot not assigned", "Slot-based chassis review is limited until a slot is authored.");
  } else {
    addDiagnostic(diagnostics, "ok", "topology", "Topology reviewable", `Slot ${module.slot} is unique within its authored parent location.`);
  }

  if (!module.ports?.length) {
    addDiagnostic(diagnostics, "warning", "topology", "No port metadata", "The module is preserved, but offline port/topology review is limited.");
  }

  if (connections.length === 0) {
    addDiagnostic(diagnostics, "warning", "connection", "No connection metadata", "No cyclic connection metadata is authored for this module.");
  } else {
    for (const connection of connections) {
      addDiagnostic(
        diagnostics,
        connection.status === "invalid" ? "error" : connection.status === "missing-rpi" ? "warning" : "ok",
        "connection",
        connection.name ? `Connection ${connection.name}` : "Connection metadata",
        connection.message,
      );
    }
  }

  const keying = module.electronicKeying;
  if (issues.includes("invalid-electronic-keying")) {
    addDiagnostic(diagnostics, "error", "keying", "Invalid electronic keying", `Electronic keying "${keying}" is not a supported offline verification token.`);
  } else if (issues.includes("missing-keying-revision")) {
    addDiagnostic(diagnostics, "error", "keying", "Missing keying revision", `${keying} keying requires both major and minor revision metadata.`);
  } else if (keying === "Disabled") {
    addDiagnostic(diagnostics, "warning", "keying", "Electronic keying disabled", "Disabled keying is preserved as metadata; ESCO does not enforce module identity offline.");
  } else if (keying) {
    addDiagnostic(diagnostics, "ok", "keying", "Electronic keying reviewable", `${keying} keying metadata is complete for offline verification.`);
  } else {
    addDiagnostic(diagnostics, "info", "keying", "Catalog keying default", "No keying token was authored; the module is treated as using its profile default.");
  }

  if (profileChannels.length === 0) {
    addDiagnostic(diagnostics, "warning", "profile-channels", "No channel table", "The profile has no authored channel table, so channel-level diagnostics are unavailable.");
  } else {
    const disabled = profileChannels.filter((channel) => !channel.enabled).length;
    addDiagnostic(
      diagnostics,
      disabled > 0 ? "warning" : "ok",
      "profile-channels",
      "Channel profile loaded",
      `${profileChannels.length} channel${profileChannels.length === 1 ? "" : "s"} available for offline review${disabled ? `; ${disabled} disabled` : ""}.`,
    );
  }

  if (module.inhibited) {
    addDiagnostic(diagnostics, "info", "connection", "Module inhibited", "The inhibit bit is preserved; no live module connection is opened or closed.");
  }
  if (module.majorFault) {
    addDiagnostic(diagnostics, "info", "connection", "Major fault on connection loss", "The setting is preserved, but ESCO does not inject controller major faults offline.");
  }

  return diagnostics;
}

function rowFor(controller: Controller, module: IoModule, issues: IoModuleReviewIssue[]): IoModuleReviewRow {
  const profileChannels = profileChannelsOf(module);
  const connections = connectionReviews(module);
  const profileSignals = advancedProfileSignals(module);
  const profileFamily = advancedProfileFamily(module);
  const diagnostics = syntheticDiagnosticsFor(module, issues, profileChannels, connections, profileFamily);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    moduleId: module.id,
    name: module.name,
    catalogNumber: module.catalogNumber,
    slot: module.slot,
    description: module.description,
    parentModule: module.parentModule,
    parentPortId: module.parentPortId,
    commPath: module.commPath,
    vendor: module.vendor,
    productType: module.productType,
    productCode: module.productCode,
    majorRevision: module.majorRevision,
    minorRevision: module.minorRevision,
    electronicKeying: module.electronicKeying,
    inhibited: Boolean(module.inhibited),
    majorFaultOnConnectionLoss: Boolean(module.majorFault),
    status: issues.length ? "needs-attention" as const : module.inhibited ? "inhibited" as const : "reviewable" as const,
    issues,
    ports: (module.ports ?? []).map((port) => ({
      id: port.id,
      type: port.type,
      address: port.address,
      upstream: port.upstream,
      busSize: port.busSize,
    })),
    connections,
    connectionCount: connections.length,
    profileChannels,
    profileChannelCount: profileChannels.length,
    disabledProfileChannelCount: profileChannels.filter((channel) => !channel.enabled).length,
    advancedProfileFamily: profileFamily,
    advancedProfileSignals: profileSignals,
    advancedProfileLabel: advancedProfileLabel(profileFamily),
    advancedProfileReviewable: advancedProfileReviewable(profileFamily),
    advancedProfileMessage: advancedProfileMessage(module, profileFamily),
    diagnostics,
    diagnosticCount: diagnostics.length,
    diagnosticWarningCount: diagnostics.filter((diagnostic) => diagnostic.status === "warning").length,
    diagnosticErrorCount: diagnostics.filter((diagnostic) => diagnostic.status === "error").length,
    connectionModelled: false as const,
    profileChannelConfigurationDownloaded: false as const,
    electronicKeyingEnforced: false as const,
    majorFaultInjected: false as const,
    boundaries: BOUNDARIES,
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function ioModuleReviewReport(project: PlcProject): IoModuleReviewReport {
  const rows: IoModuleReviewRow[] = [];
  for (const controller of project.controllers) {
    const modules = controller.ioConfiguration.modules;
    const modulesByName = new Map(modules.map((module) => [module.name, module]));
    const duplicateSlots = slotDuplicateCounts(modules);
    for (const module of modules) {
      rows.push(rowFor(controller, module, issuesFor(module, modulesByName, duplicateSlots)));
    }
  }

  const rowsWithIssue = rows.filter((row) => row.issues.length > 0);
  const hasIssue = (issue: IoModuleReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    moduleCount: rows.length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "inhibited").length,
    inhibitedCount: rows.filter((row) => row.inhibited).length,
    majorFaultCount: rows.filter((row) => row.majorFaultOnConnectionLoss).length,
    profileChannelModuleCount: rows.filter((row) => row.profileChannelCount > 0).length,
    advancedProfileModuleCount: rows.filter((row) => row.advancedProfileReviewable).length,
    driveProfileCount: rows.filter((row) => row.advancedProfileSignals.includes("drive")).length,
    flex5000ProfileCount: rows.filter((row) => row.advancedProfileSignals.includes("flex-5000")).length,
    hartProfileCount: rows.filter((row) => row.advancedProfileSignals.includes("hart")).length,
    bridgeProfileCount: rows.filter((row) => row.advancedProfileSignals.includes("bridge")).length,
    disabledProfileChannelCount: rows.reduce((sum, row) => sum + row.disabledProfileChannelCount, 0),
    connectionMetadataCount: rows.filter((row) => row.connectionCount > 0).length,
    diagnosticWarningCount: rows.reduce((sum, row) => sum + row.diagnosticWarningCount, 0),
    diagnosticErrorCount: rows.reduce((sum, row) => sum + row.diagnosticErrorCount, 0),
    issueCount: rowsWithIssue.length,
    missingParentCount: hasIssue("missing-parent-module") + hasIssue("missing-parent-port"),
    duplicateSlotCount: hasIssue("duplicate-slot"),
    warnings: rowsWithIssue.map((row) => row.message),
  };
}
