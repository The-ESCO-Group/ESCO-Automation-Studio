import type { Controller, PlcProject } from "@esco/core";

export type ControllerCommunicationPathReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "needs-attention";

export type ControllerCommunicationPathReviewIssue =
  | "missing-comm-path"
  | "missing-comm-driver"
  | "malformed-comm-path"
  | "malformed-comm-driver"
  | "driver-path-mismatch";

export type ControllerCommunicationPathReviewBoundary =
  | "no-controller-communication"
  | "no-path-browse"
  | "no-online-connection"
  | "no-driver-validation"
  | "no-download-target-selection";

export type ControllerCommunicationPathSegmentKind =
  | "driver"
  | "network-address"
  | "backplane"
  | "slot"
  | "port"
  | "local-model"
  | "unknown";

export type ControllerCommunicationPathRouteFamily =
  | "ethernet-ip"
  | "local-backplane"
  | "unknown";

export interface ControllerCommunicationPathSegment {
  index: number;
  value: string;
  kind: ControllerCommunicationPathSegmentKind;
  label: string;
}

export interface ControllerCommunicationPathReviewRow {
  controllerId: string;
  controllerName: string;
  commPath?: string;
  commDriver?: string;
  commPathPresent: boolean;
  commDriverPresent: boolean;
  routeSegmentCount: number;
  routeSegments: ControllerCommunicationPathSegment[];
  routeFamily: ControllerCommunicationPathRouteFamily;
  driverPathMatches: boolean;
  networkAddress?: string;
  targetSlot?: string;
  routeSummary: string;
  offlineDiagnosticsAvailable: boolean;
  status: ControllerCommunicationPathReviewStatus;
  issues: ControllerCommunicationPathReviewIssue[];
  controllerCommunicationModelled: false;
  pathBrowseModelled: false;
  onlineConnectionModelled: false;
  driverValidationModelled: false;
  downloadTargetSelectionModelled: false;
  boundaries: ControllerCommunicationPathReviewBoundary[];
  message: string;
}

export interface ControllerCommunicationPathReviewReport {
  rows: ControllerCommunicationPathReviewRow[];
  controllerCount: number;
  metadataCount: number;
  reviewableCount: number;
  issueCount: number;
  commPathCount: number;
  commDriverCount: number;
  missingCommPathCount: number;
  missingCommDriverCount: number;
  malformedCommPathCount: number;
  malformedCommDriverCount: number;
  driverPathMismatchCount: number;
  ethernetPathCount: number;
  localModelPathCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerCommunicationPathReviewBoundary[] = [
  "no-controller-communication",
  "no-path-browse",
  "no-online-connection",
  "no-driver-validation",
  "no-download-target-selection",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function routeSegmentValues(commPath: string | undefined): string[] {
  if (blank(commPath)) return [];
  return commPath!.trim().split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
}

function isMalformedDriver(value: string | undefined): boolean {
  return !blank(value) && /[\\/]/.test(value!.trim());
}

function labelForSegment(kind: ControllerCommunicationPathSegmentKind, value: string): string {
  switch (kind) {
    case "driver":
      return "Driver";
    case "network-address":
      return "Network address";
    case "backplane":
      return "Backplane";
    case "slot":
      return /^slot\s+/i.test(value) ? "Slot" : `Slot ${value}`;
    case "port":
      return `Port ${value}`;
    case "local-model":
      return /backplane/i.test(value) ? "Local backplane" : "Offline model";
    case "unknown":
      return "Route segment";
  }
}

function classifySegment(
  value: string,
  index: number,
  values: string[],
  commDriver: string | undefined,
): ControllerCommunicationPathSegmentKind {
  const lower = value.toLowerCase();
  const previous = values[index - 1]?.toLowerCase() ?? "";
  if (index === 0 && !blank(commDriver) && normalized(value) === normalized(commDriver)) return "driver";
  if (IPV4_PATTERN.test(value)) return "network-address";
  if (/offline\s+model|local\s+model/.test(lower)) return "local-model";
  if (/local\s+backplane/.test(lower)) return "local-model";
  if (index === 0 && /^(?:ab_|rslinx|eth|ethernet|ethernet-ip|softlogix|emulate)/i.test(value)) {
    return "driver";
  }
  if (/backplane/.test(lower)) return "backplane";
  if (/^slot\s+\d+$/i.test(value)) return "slot";
  if (/^\d+$/.test(value)) return previous.includes("backplane") ? "slot" : "port";
  return "unknown";
}

function routeSegments(
  commPath: string | undefined,
  commDriver: string | undefined,
): ControllerCommunicationPathSegment[] {
  const values = routeSegmentValues(commPath);
  return values.map((value, index) => {
    const kind = classifySegment(value, index, values, commDriver);
    return {
      index,
      value,
      kind,
      label: labelForSegment(kind, value),
    };
  });
}

function routeFamilyFor(
  segments: ControllerCommunicationPathSegment[],
  commPath: string | undefined,
  commDriver: string | undefined,
): ControllerCommunicationPathRouteFamily {
  const text = `${commPath ?? ""} ${commDriver ?? ""}`;
  if (segments.some((segment) => segment.kind === "network-address") || /ethip|ethernet/i.test(text)) {
    return "ethernet-ip";
  }
  if (segments.some((segment) => segment.kind === "local-model") || /offline\s+model|local\s+backplane/i.test(text)) {
    return "local-backplane";
  }
  return "unknown";
}

function targetSlotFor(segments: ControllerCommunicationPathSegment[]): string | undefined {
  const slot = segments.find((segment) => segment.kind === "slot");
  if (!slot) return undefined;
  return slot.value.replace(/^slot\s+/i, "");
}

function routeSummaryFor(
  row: Pick<
    ControllerCommunicationPathReviewRow,
    "commPathPresent" | "routeFamily" | "routeSegments" | "networkAddress" | "targetSlot"
  >,
): string {
  if (!row.commPathPresent) return "No imported CommPath metadata.";
  if (row.routeFamily === "ethernet-ip") {
    if (row.networkAddress && row.targetSlot) {
      return `EtherNet/IP route to ${row.networkAddress}, backplane slot ${row.targetSlot}.`;
    }
    if (row.networkAddress) return `EtherNet/IP route to ${row.networkAddress}.`;
    return `EtherNet/IP route metadata with ${row.routeSegments.length} segment(s).`;
  }
  if (row.routeFamily === "local-backplane") {
    if (row.targetSlot) return `Offline model route through Local Backplane slot ${row.targetSlot}.`;
    return "Offline model route through a local backplane.";
  }
  return `Route has ${row.routeSegments.length} segment(s): ${row.routeSegments.map((segment) => segment.value).join(" -> ")}.`;
}

function issuesFor(controller: Controller): ControllerCommunicationPathReviewIssue[] {
  const issues: ControllerCommunicationPathReviewIssue[] = [];
  const hasPath = !blank(controller.commPath);
  const hasDriver = !blank(controller.commDriver);
  const segments = routeSegmentValues(controller.commPath);
  const malformedDriver = isMalformedDriver(controller.commDriver);

  if (!hasPath && hasDriver) issues.push("missing-comm-path");
  if (hasPath && !hasDriver) issues.push("missing-comm-driver");
  if (hasPath && segments.length < 2) issues.push("malformed-comm-path");
  if (malformedDriver) issues.push("malformed-comm-driver");
  if (
    hasPath &&
    hasDriver &&
    !malformedDriver &&
    segments.length > 0 &&
    normalized(segments[0]) !== normalized(controller.commDriver)
  ) {
    issues.push("driver-path-mismatch");
  }

  return issues;
}

function issueLabel(issue: ControllerCommunicationPathReviewIssue): string {
  switch (issue) {
    case "missing-comm-path":
      return "CommDriver is present without CommPath";
    case "missing-comm-driver":
      return "CommPath is present without CommDriver";
    case "malformed-comm-path":
      return "CommPath does not look like a routed communication path";
    case "malformed-comm-driver":
      return "CommDriver should be the workstation driver name, not a routed path";
    case "driver-path-mismatch":
      return "CommDriver does not match the first CommPath segment";
  }
}

function statusFor(
  controller: Controller,
  issues: ControllerCommunicationPathReviewIssue[],
): ControllerCommunicationPathReviewStatus {
  if (blank(controller.commPath) && blank(controller.commDriver)) return "no-metadata";
  if (issues.length) return "needs-attention";
  return "reviewable";
}

function messageFor(row: Omit<ControllerCommunicationPathReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" communication path metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.commPathPresent && !row.commDriverPresent) {
    return `Controller "${row.controllerName}" has no imported communication path metadata to review.`;
  }
  return `Controller "${row.controllerName}" communication path metadata is reviewable offline: ${row.routeSummary} Path browsing, online connection, driver validation, and download target selection are not modelled.`;
}

function rowFor(controller: Controller): ControllerCommunicationPathReviewRow {
  const issues = issuesFor(controller);
  const segments = routeSegments(controller.commPath, controller.commDriver);
  const routeFamily = routeFamilyFor(segments, controller.commPath, controller.commDriver);
  const networkAddress = segments.find((segment) => segment.kind === "network-address")?.value;
  const targetSlot = targetSlotFor(segments);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    commPath: present(controller.commPath),
    commDriver: present(controller.commDriver),
    commPathPresent: !blank(controller.commPath),
    commDriverPresent: !blank(controller.commDriver),
    routeSegmentCount: segments.length,
    routeSegments: segments,
    routeFamily,
    driverPathMatches: !issues.includes("driver-path-mismatch") && !blank(controller.commPath) && !blank(controller.commDriver),
    networkAddress,
    targetSlot,
    routeSummary: "",
    offlineDiagnosticsAvailable: !blank(controller.commPath) || !blank(controller.commDriver),
    status: statusFor(controller, issues),
    issues,
    controllerCommunicationModelled: false as const,
    pathBrowseModelled: false as const,
    onlineConnectionModelled: false as const,
    driverValidationModelled: false as const,
    downloadTargetSelectionModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  const rowWithSummary = { ...rowBase, routeSummary: routeSummaryFor(rowBase) };
  return { ...rowWithSummary, message: messageFor(rowWithSummary) };
}

export function controllerCommunicationPathReviewReport(
  project: PlcProject,
): ControllerCommunicationPathReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerCommunicationPathReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: rows.length,
    metadataCount: rows.filter((row) => row.commPathPresent || row.commDriverPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    commPathCount: rows.filter((row) => row.commPathPresent).length,
    commDriverCount: rows.filter((row) => row.commDriverPresent).length,
    missingCommPathCount: hasIssue("missing-comm-path"),
    missingCommDriverCount: hasIssue("missing-comm-driver"),
    malformedCommPathCount: hasIssue("malformed-comm-path"),
    malformedCommDriverCount: hasIssue("malformed-comm-driver"),
    driverPathMismatchCount: hasIssue("driver-path-mismatch"),
    ethernetPathCount: rows.filter((row) => row.routeFamily === "ethernet-ip").length,
    localModelPathCount: rows.filter((row) => row.routeFamily === "local-backplane").length,
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
