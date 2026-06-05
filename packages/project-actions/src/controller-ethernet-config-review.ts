import type { Controller, L5XAttributeMap, PlcProject } from "@esco/core";

export type ControllerEthernetConfigReviewStatus =
  | "reviewable"
  | "needs-attention";

export type ControllerEthernetConfigReviewIssue =
  | "manual-ip-missing-address"
  | "invalid-ip-address"
  | "duplicate-ethernet-port"
  | "invalid-interface-speed"
  | "invalid-duplex-mode"
  | "invalid-vlan-id"
  | "invalid-ring-timing";

export type ControllerEthernetConfigReviewBoundary =
  | "no-controller-communication"
  | "no-ip-setting-apply"
  | "no-network-browse"
  | "no-live-port-state"
  | "no-network-diagnostics";

export interface ControllerEthernetPortReviewRow {
  id: string;
  port?: string;
  portEnabled?: string;
  autoNegotiateEnabled?: string;
  interfaceSpeed?: string;
  duplexMode?: string;
  duplicate: boolean;
  issues: ControllerEthernetConfigReviewIssue[];
}

export interface ControllerEthernetConfigReviewRow {
  controllerId: string;
  controllerName: string;
  internetProtocolPresent: boolean;
  ethernetNetworkPresent: boolean;
  ethernetPortCount: number;
  configType?: string;
  ipAddress?: string;
  subnetMask?: string;
  gateway?: string;
  primaryDNS?: string;
  secondaryDNS?: string;
  domainName?: string;
  hostName?: string;
  supervisorModeEnabled?: string;
  supervisorPrecedence?: string;
  beaconInterval?: string;
  beaconTimeout?: string;
  vlanId?: string;
  ports: ControllerEthernetPortReviewRow[];
  status: ControllerEthernetConfigReviewStatus;
  issues: ControllerEthernetConfigReviewIssue[];
  controllerCommunicationModelled: false;
  ipSettingApplyModelled: false;
  networkBrowseModelled: false;
  livePortStateModelled: false;
  networkDiagnosticsModelled: false;
  boundaries: ControllerEthernetConfigReviewBoundary[];
  message: string;
}

export interface ControllerEthernetConfigReviewReport {
  rows: ControllerEthernetConfigReviewRow[];
  controllerCount: number;
  configuredControllerCount: number;
  ethernetPortCount: number;
  reviewableCount: number;
  issueCount: number;
  manualIpMissingAddressCount: number;
  invalidIpAddressCount: number;
  duplicateEthernetPortCount: number;
  invalidInterfaceSpeedCount: number;
  invalidDuplexModeCount: number;
  invalidVlanIdCount: number;
  invalidRingTimingCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerEthernetConfigReviewBoundary[] = [
  "no-controller-communication",
  "no-ip-setting-apply",
  "no-network-browse",
  "no-live-port-state",
  "no-network-diagnostics",
];

const IP_FIELDS = ["IPAddress", "SubnetMask", "Gateway", "PrimaryDNS", "SecondaryDNS"] as const;
const SPEEDS = new Set(["10", "100", "1000"]);
const DUPLEX_MODES = new Set(["half", "full"]);

function attr(attributes: L5XAttributeMap | undefined, name: string): string | undefined {
  const value = attributes?.[name];
  return value == null || value.trim() === "" ? undefined : value.trim();
}

function parseInteger(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (!/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isIPv4(value: string): boolean {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function duplicatePortKeys(controller: Controller): Set<string> {
  const counts = new Map<string, number>();
  for (const port of controller.ethernetConfig?.ports ?? []) {
    const portNumber = attr(port.attributes, "Port");
    if (!portNumber) continue;
    const key = portNumber.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function invalidRangeIssue(
  issues: ControllerEthernetConfigReviewIssue[],
  value: string | undefined,
  min: number,
  max: number,
  issue: ControllerEthernetConfigReviewIssue,
): void {
  if (value == null) return;
  const parsed = parseInteger(value);
  if (parsed == null || parsed < min || parsed > max) issues.push(issue);
}

function controllerIssues(controller: Controller): ControllerEthernetConfigReviewIssue[] {
  const issues: ControllerEthernetConfigReviewIssue[] = [];
  const config = controller.ethernetConfig;
  if (!config) return issues;

  const ip = config.internetProtocol?.attributes;
  if ((attr(ip, "ConfigType") ?? "").toLowerCase() === "manual" && (!attr(ip, "IPAddress") || !attr(ip, "SubnetMask"))) {
    issues.push("manual-ip-missing-address");
  }
  for (const field of IP_FIELDS) {
    const value = attr(ip, field);
    if (value && !isIPv4(value)) issues.push("invalid-ip-address");
  }

  const duplicates = duplicatePortKeys(controller);
  if (duplicates.size > 0) issues.push("duplicate-ethernet-port");
  for (const port of config.ports) {
    const speed = attr(port.attributes, "InterfaceSpeed");
    if (speed && !SPEEDS.has(speed)) issues.push("invalid-interface-speed");
    const duplex = attr(port.attributes, "DuplexMode");
    if (duplex && !DUPLEX_MODES.has(duplex.toLowerCase())) issues.push("invalid-duplex-mode");
  }

  const network = config.network?.attributes;
  invalidRangeIssue(issues, attr(network, "VLANID"), 0, 4094, "invalid-vlan-id");
  invalidRangeIssue(issues, attr(network, "SupervisorPrecedence"), 0, 255, "invalid-ring-timing");
  invalidRangeIssue(issues, attr(network, "BeaconInterval"), 100, 100000, "invalid-ring-timing");
  invalidRangeIssue(issues, attr(network, "BeaconTimeout"), 200, 500000, "invalid-ring-timing");

  return [...new Set(issues)];
}

function portRows(controller: Controller): ControllerEthernetPortReviewRow[] {
  const duplicates = duplicatePortKeys(controller);
  return (controller.ethernetConfig?.ports ?? []).map((port) => {
    const portNumber = attr(port.attributes, "Port");
    const issues: ControllerEthernetConfigReviewIssue[] = [];
    const speed = attr(port.attributes, "InterfaceSpeed");
    if (speed && !SPEEDS.has(speed)) issues.push("invalid-interface-speed");
    const duplex = attr(port.attributes, "DuplexMode");
    if (duplex && !DUPLEX_MODES.has(duplex.toLowerCase())) issues.push("invalid-duplex-mode");
    return {
      id: port.id,
      port: portNumber,
      portEnabled: attr(port.attributes, "PortEnabled"),
      autoNegotiateEnabled: attr(port.attributes, "AutoNegotiateEnabled"),
      interfaceSpeed: speed,
      duplexMode: duplex,
      duplicate: portNumber ? duplicates.has(portNumber.toUpperCase()) : false,
      issues,
    };
  });
}

function issueLabel(issue: ControllerEthernetConfigReviewIssue): string {
  switch (issue) {
    case "manual-ip-missing-address":
      return "manual IP configuration is missing IPAddress or SubnetMask";
    case "invalid-ip-address":
      return "one or more IP/DNS address fields are not valid IPv4 addresses";
    case "duplicate-ethernet-port":
      return "duplicate Ethernet port numbers are configured";
    case "invalid-interface-speed":
      return "InterfaceSpeed must be 10, 100, or 1000 Mbps";
    case "invalid-duplex-mode":
      return "DuplexMode must be Half or Full";
    case "invalid-vlan-id":
      return "VLANID must be in the range 0-4094";
    case "invalid-ring-timing":
      return "ring supervisor timing/preference attributes are outside documented bounds";
  }
}

function messageFor(row: Omit<ControllerEthernetConfigReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" EtherNet/IP configuration needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  return `Controller "${row.controllerName}" EtherNet/IP configuration is reviewable offline; IP setting apply, network browsing, live port state, and diagnostics are not modelled.`;
}

export function controllerEthernetConfigReviewReport(project: PlcProject): ControllerEthernetConfigReviewReport {
  const rows: ControllerEthernetConfigReviewRow[] = [];
  for (const controller of project.controllers) {
    const config = controller.ethernetConfig;
    if (!config) continue;
    const ip = config.internetProtocol?.attributes;
    const network = config.network?.attributes;
    const issues = controllerIssues(controller);
    const rowBase = {
      controllerId: controller.id,
      controllerName: controller.name,
      internetProtocolPresent: Boolean(config.internetProtocol),
      ethernetNetworkPresent: Boolean(config.network),
      ethernetPortCount: config.ports.length,
      configType: attr(ip, "ConfigType"),
      ipAddress: attr(ip, "IPAddress"),
      subnetMask: attr(ip, "SubnetMask"),
      gateway: attr(ip, "Gateway"),
      primaryDNS: attr(ip, "PrimaryDNS"),
      secondaryDNS: attr(ip, "SecondaryDNS"),
      domainName: attr(ip, "DomainName"),
      hostName: attr(ip, "HostName"),
      supervisorModeEnabled: attr(network, "SupervisorModeEnabled"),
      supervisorPrecedence: attr(network, "SupervisorPrecedence"),
      beaconInterval: attr(network, "BeaconInterval"),
      beaconTimeout: attr(network, "BeaconTimeout"),
      vlanId: attr(network, "VLANID"),
      ports: portRows(controller),
      status: issues.length ? "needs-attention" as const : "reviewable" as const,
      issues,
      controllerCommunicationModelled: false as const,
      ipSettingApplyModelled: false as const,
      networkBrowseModelled: false as const,
      livePortStateModelled: false as const,
      networkDiagnosticsModelled: false as const,
      boundaries: [...BOUNDARIES],
    };
    rows.push({ ...rowBase, message: messageFor(rowBase) });
  }

  const hasIssue = (issue: ControllerEthernetConfigReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: project.controllers.length,
    configuredControllerCount: rows.length,
    ethernetPortCount: rows.reduce((sum, row) => sum + row.ethernetPortCount, 0),
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    manualIpMissingAddressCount: hasIssue("manual-ip-missing-address"),
    invalidIpAddressCount: hasIssue("invalid-ip-address"),
    duplicateEthernetPortCount: hasIssue("duplicate-ethernet-port"),
    invalidInterfaceSpeedCount: hasIssue("invalid-interface-speed"),
    invalidDuplexModeCount: hasIssue("invalid-duplex-mode"),
    invalidVlanIdCount: hasIssue("invalid-vlan-id"),
    invalidRingTimingCount: hasIssue("invalid-ring-timing"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
