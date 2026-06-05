import type { Controller, L5XAttributeMap, PlcProject } from "@esco/core";

export type ControllerCommPortReviewStatus =
  | "reviewable"
  | "needs-attention";

export type ControllerCommPortReviewIssue =
  | "duplicate-serial-channel"
  | "missing-serial-protocol"
  | "invalid-baud-rate"
  | "invalid-data-bits"
  | "invalid-stop-bits";

export type ControllerCommPortReviewBoundary =
  | "no-controller-communication"
  | "no-serial-port-access"
  | "no-df1-runtime"
  | "no-ascii-channel-hardware"
  | "no-live-channel-status";

export interface ControllerSerialProtocolReviewRow {
  id: string;
  elementName: string;
  attributes: L5XAttributeMap;
}

export interface ControllerSerialPortReviewRow {
  id: string;
  channel?: string;
  baudRate?: string;
  parity?: string;
  dataBits?: string;
  stopBits?: string;
  controlLine?: string;
  comDriverId?: string;
  protocolNames: string[];
  protocols: ControllerSerialProtocolReviewRow[];
  duplicate: boolean;
  issues: ControllerCommPortReviewIssue[];
}

export interface ControllerCommPortReviewRow {
  controllerId: string;
  controllerName: string;
  serialPortCount: number;
  protocolCount: number;
  ports: ControllerSerialPortReviewRow[];
  status: ControllerCommPortReviewStatus;
  issues: ControllerCommPortReviewIssue[];
  controllerCommunicationModelled: false;
  serialPortAccessModelled: false;
  df1RuntimeModelled: false;
  asciiChannelHardwareModelled: false;
  liveChannelStatusModelled: false;
  boundaries: ControllerCommPortReviewBoundary[];
  message: string;
}

export interface ControllerCommPortReviewReport {
  rows: ControllerCommPortReviewRow[];
  controllerCount: number;
  configuredControllerCount: number;
  serialPortCount: number;
  protocolCount: number;
  reviewableCount: number;
  issueCount: number;
  duplicateSerialChannelCount: number;
  missingSerialProtocolCount: number;
  invalidBaudRateCount: number;
  invalidDataBitsCount: number;
  invalidStopBitsCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerCommPortReviewBoundary[] = [
  "no-controller-communication",
  "no-serial-port-access",
  "no-df1-runtime",
  "no-ascii-channel-hardware",
  "no-live-channel-status",
];

function attr(attributes: L5XAttributeMap | undefined, name: string): string | undefined {
  const value = attributes?.[name];
  return value == null || value.trim() === "" ? undefined : value.trim();
}

function serialChannel(attributes: L5XAttributeMap | undefined): string | undefined {
  return attr(attributes, "Channel") ?? attr(attributes, "Port") ?? attr(attributes, "Id");
}

function parseFirstInteger(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const match = value.trim().match(/^-?\d+/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function duplicateChannels(controller: Controller): Set<string> {
  const counts = new Map<string, number>();
  for (const port of controller.commPorts?.serialPorts ?? []) {
    const channel = serialChannel(port.attributes);
    if (!channel) continue;
    const key = channel.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function portIssues(
  port: NonNullable<Controller["commPorts"]>["serialPorts"][number],
  duplicateChannelKeys: Set<string>,
): ControllerCommPortReviewIssue[] {
  const issues: ControllerCommPortReviewIssue[] = [];
  const channel = serialChannel(port.attributes);
  if (channel && duplicateChannelKeys.has(channel.toUpperCase())) issues.push("duplicate-serial-channel");
  if (port.protocols.length === 0) issues.push("missing-serial-protocol");

  const baudRate = attr(port.attributes, "BaudRate");
  const parsedBaud = parseFirstInteger(baudRate);
  if (baudRate && (parsedBaud == null || parsedBaud <= 0)) issues.push("invalid-baud-rate");

  const dataBits = attr(port.attributes, "DataBits");
  const parsedDataBits = parseFirstInteger(dataBits);
  if (dataBits && (parsedDataBits == null || parsedDataBits < 5 || parsedDataBits > 8)) {
    issues.push("invalid-data-bits");
  }

  const stopBits = attr(port.attributes, "StopBits");
  const parsedStopBits = parseFirstInteger(stopBits);
  if (stopBits && (parsedStopBits == null || (parsedStopBits !== 1 && parsedStopBits !== 2))) {
    issues.push("invalid-stop-bits");
  }

  return issues;
}

function controllerIssues(controller: Controller): ControllerCommPortReviewIssue[] {
  const duplicateChannelKeys = duplicateChannels(controller);
  const issues = (controller.commPorts?.serialPorts ?? []).flatMap((port) =>
    portIssues(port, duplicateChannelKeys),
  );
  return [...new Set(issues)];
}

function protocolRows(
  port: NonNullable<Controller["commPorts"]>["serialPorts"][number],
): ControllerSerialProtocolReviewRow[] {
  return port.protocols.map((protocol) => ({
    id: protocol.id,
    elementName: protocol.elementName,
    attributes: protocol.attributes,
  }));
}

function portRows(controller: Controller): ControllerSerialPortReviewRow[] {
  const duplicateChannelKeys = duplicateChannels(controller);
  return (controller.commPorts?.serialPorts ?? []).map((port) => {
    const channel = serialChannel(port.attributes);
    const protocols = protocolRows(port);
    return {
      id: port.id,
      channel,
      baudRate: attr(port.attributes, "BaudRate"),
      parity: attr(port.attributes, "Parity"),
      dataBits: attr(port.attributes, "DataBits"),
      stopBits: attr(port.attributes, "StopBits"),
      controlLine: attr(port.attributes, "ControlLine"),
      comDriverId: attr(port.attributes, "ComDriverId"),
      protocolNames: protocols.map((protocol) => protocol.elementName),
      protocols,
      duplicate: channel ? duplicateChannelKeys.has(channel.toUpperCase()) : false,
      issues: portIssues(port, duplicateChannelKeys),
    };
  });
}

function issueLabel(issue: ControllerCommPortReviewIssue): string {
  switch (issue) {
    case "duplicate-serial-channel":
      return "duplicate serial channels are configured";
    case "missing-serial-protocol":
      return "a serial port is missing an ASCII/DF1 protocol child";
    case "invalid-baud-rate":
      return "BaudRate must be a positive integer";
    case "invalid-data-bits":
      return "DataBits must resolve to 5-8 bits";
    case "invalid-stop-bits":
      return "StopBits must resolve to 1 or 2 stop bits";
  }
}

function messageFor(row: Omit<ControllerCommPortReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" serial communication configuration needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  return `Controller "${row.controllerName}" serial communication configuration is reviewable offline; serial hardware access, DF1 runtime, ASCII channel hardware state, and live channel status are not modelled.`;
}

export function controllerCommPortReviewReport(project: PlcProject): ControllerCommPortReviewReport {
  const rows: ControllerCommPortReviewRow[] = [];
  for (const controller of project.controllers) {
    const commPorts = controller.commPorts;
    if (!commPorts) continue;
    const ports = portRows(controller);
    const issues = controllerIssues(controller);
    const rowBase = {
      controllerId: controller.id,
      controllerName: controller.name,
      serialPortCount: commPorts.serialPorts.length,
      protocolCount: ports.reduce((sum, port) => sum + port.protocols.length, 0),
      ports,
      status: issues.length ? "needs-attention" as const : "reviewable" as const,
      issues,
      controllerCommunicationModelled: false as const,
      serialPortAccessModelled: false as const,
      df1RuntimeModelled: false as const,
      asciiChannelHardwareModelled: false as const,
      liveChannelStatusModelled: false as const,
      boundaries: [...BOUNDARIES],
    };
    rows.push({ ...rowBase, message: messageFor(rowBase) });
  }

  const hasIssue = (issue: ControllerCommPortReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: project.controllers.length,
    configuredControllerCount: rows.length,
    serialPortCount: rows.reduce((sum, row) => sum + row.serialPortCount, 0),
    protocolCount: rows.reduce((sum, row) => sum + row.protocolCount, 0),
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    duplicateSerialChannelCount: hasIssue("duplicate-serial-channel"),
    missingSerialProtocolCount: hasIssue("missing-serial-protocol"),
    invalidBaudRateCount: hasIssue("invalid-baud-rate"),
    invalidDataBitsCount: hasIssue("invalid-data-bits"),
    invalidStopBitsCount: hasIssue("invalid-stop-bits"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
