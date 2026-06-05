import { arrayDimensionsOf, type PlcProject, type UdtMember, type UserDefinedType } from "@esco/core";

export type UdtMemberMetadataReviewStatus = "reviewable" | "needs-attention";

export type UdtMemberOverlayRole = "ordinary" | "hidden-host" | "bit-overlay";

export type UdtMemberMetadataReviewIssue =
  | "missing-member-data-type"
  | "hidden-member-has-overlay-target"
  | "target-without-bit-number"
  | "bit-number-without-target"
  | "missing-overlay-target"
  | "overlay-target-not-integer"
  | "bit-number-out-of-range"
  | "duplicate-overlay-bit"
  | "overlay-member-not-bool";

export type UdtMemberMetadataReviewBoundary =
  | "no-controller-communication"
  | "no-online-data-type-edit"
  | "no-controller-download"
  | "no-controller-memory-layout-enforcement"
  | "no-bit-packing-execution"
  | "no-live-display-formatting"
  | "no-controller-external-access-enforcement";

export interface UdtMemberMetadataReviewRow {
  controllerId: string;
  controllerName: string;
  dataTypeId: string;
  dataTypeName: string;
  dataTypeFamily?: string;
  memberName: string;
  memberDataType: string;
  dimension?: number;
  dimensions?: number[];
  radix?: string;
  externalAccess?: UdtMember["externalAccess"];
  hidden?: boolean;
  target?: string;
  bitNumber?: number;
  overlayRole: UdtMemberOverlayRole;
  displayMetadataPresent: boolean;
  layoutMetadataPresent: boolean;
  status: UdtMemberMetadataReviewStatus;
  issues: UdtMemberMetadataReviewIssue[];
  onlineDataTypeEditModelled: false;
  controllerDownloadModelled: false;
  controllerMemoryLayoutEnforced: false;
  bitPackingExecutionModelled: false;
  liveDisplayFormattingModelled: false;
  controllerExternalAccessEnforced: false;
  boundaries: UdtMemberMetadataReviewBoundary[];
  message: string;
}

export interface UdtMemberMetadataReviewReport {
  rows: UdtMemberMetadataReviewRow[];
  dataTypeCount: number;
  memberCount: number;
  displayMetadataMemberCount: number;
  layoutMetadataMemberCount: number;
  hiddenHostCount: number;
  bitOverlayMemberCount: number;
  issueCount: number;
  duplicateOverlayBitCount: number;
  missingOverlayTargetCount: number;
  invalidOverlayCount: number;
  warnings: string[];
}

const BOUNDARIES: UdtMemberMetadataReviewBoundary[] = [
  "no-controller-communication",
  "no-online-data-type-edit",
  "no-controller-download",
  "no-controller-memory-layout-enforcement",
  "no-bit-packing-execution",
  "no-live-display-formatting",
  "no-controller-external-access-enforcement",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function integerBitWidth(dataType: string | undefined): number | undefined {
  switch (dataType?.trim().toUpperCase()) {
    case "SINT":
      return 8;
    case "INT":
      return 16;
    case "DINT":
      return 32;
    case "LINT":
      return 64;
    default:
      return undefined;
  }
}

function overlayKey(member: UdtMember): string | undefined {
  if (blank(member.target) || member.bitNumber == null) return undefined;
  return `${member.target!.trim().toLowerCase()}:${member.bitNumber}`;
}

function duplicateOverlayKeys(udt: UserDefinedType): Set<string> {
  const counts = new Map<string, number>();
  for (const member of udt.members) {
    const key = overlayKey(member);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function overlayRole(member: UdtMember): UdtMemberOverlayRole {
  if (member.target || member.bitNumber != null) return "bit-overlay";
  if (member.hidden) return "hidden-host";
  return "ordinary";
}

function memberMap(udt: UserDefinedType): Map<string, UdtMember> {
  return new Map(udt.members.map((member) => [member.name.toLowerCase(), member]));
}

function issuesFor(
  member: UdtMember,
  membersByName: Map<string, UdtMember>,
  duplicateKeys: Set<string>,
): UdtMemberMetadataReviewIssue[] {
  const issues: UdtMemberMetadataReviewIssue[] = [];
  if (blank(member.dataType)) issues.push("missing-member-data-type");
  if (member.hidden && (member.target || member.bitNumber != null)) issues.push("hidden-member-has-overlay-target");
  if (member.target && member.bitNumber == null) issues.push("target-without-bit-number");
  if (!member.target && member.bitNumber != null) issues.push("bit-number-without-target");

  if (member.target) {
    const target = membersByName.get(member.target.trim().toLowerCase());
    if (!target) {
      issues.push("missing-overlay-target");
    } else {
      const width = integerBitWidth(target.dataType);
      if (width == null) {
        issues.push("overlay-target-not-integer");
      } else if (member.bitNumber != null && (member.bitNumber < 0 || member.bitNumber >= width)) {
        issues.push("bit-number-out-of-range");
      }
    }
    if (member.dataType.trim().toUpperCase() !== "BOOL") issues.push("overlay-member-not-bool");
  }

  const key = overlayKey(member);
  if (key && duplicateKeys.has(key)) issues.push("duplicate-overlay-bit");
  return [...new Set(issues)];
}

function issueLabel(issue: UdtMemberMetadataReviewIssue): string {
  switch (issue) {
    case "missing-member-data-type":
      return "missing member data type";
    case "hidden-member-has-overlay-target":
      return "hidden host member also carries overlay target metadata";
    case "target-without-bit-number":
      return "overlay target is present without a bit number";
    case "bit-number-without-target":
      return "bit number is present without an overlay target";
    case "missing-overlay-target":
      return "overlay target member is missing";
    case "overlay-target-not-integer":
      return "overlay target is not an integer host member";
    case "bit-number-out-of-range":
      return "overlay bit number is out of range for the host member";
    case "duplicate-overlay-bit":
      return "more than one member overlays the same host bit";
    case "overlay-member-not-bool":
      return "overlay member is not BOOL";
  }
}

function messageFor(row: Omit<UdtMemberMetadataReviewRow, "message">): string {
  if (row.issues.length) {
    return `UDT member "${row.dataTypeName}.${row.memberName}" metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.overlayRole === "bit-overlay") {
    return `UDT member "${row.dataTypeName}.${row.memberName}" bit-overlay metadata is reviewable offline; bit packing and controller memory-layout enforcement are not modelled.`;
  }
  if (row.overlayRole === "hidden-host") {
    return `UDT member "${row.dataTypeName}.${row.memberName}" hidden host metadata is reviewable offline; controller memory-layout enforcement is not modelled.`;
  }
  return `UDT member "${row.dataTypeName}.${row.memberName}" display/layout metadata is reviewable offline; online data-type edits, controller download, and live formatting are not modelled.`;
}

function rowFor(input: {
  controllerId: string;
  controllerName: string;
  udt: UserDefinedType;
  member: UdtMember;
  membersByName: Map<string, UdtMember>;
  duplicateKeys: Set<string>;
}): UdtMemberMetadataReviewRow {
  const dimensions = arrayDimensionsOf(input.member);
  const issues = issuesFor(input.member, input.membersByName, input.duplicateKeys);
  const role = overlayRole(input.member);
  const rowBase = {
    controllerId: input.controllerId,
    controllerName: input.controllerName,
    dataTypeId: input.udt.id,
    dataTypeName: input.udt.name,
    dataTypeFamily: input.udt.family,
    memberName: input.member.name,
    memberDataType: input.member.dataType,
    ...(dimensions[0] ? { dimension: dimensions[0] } : {}),
    ...(dimensions.length > 1 ? { dimensions } : {}),
    radix: input.member.radix,
    externalAccess: input.member.externalAccess,
    hidden: input.member.hidden,
    target: input.member.target,
    bitNumber: input.member.bitNumber,
    overlayRole: role,
    displayMetadataPresent: Boolean(input.member.radix || input.member.externalAccess),
    layoutMetadataPresent: Boolean(dimensions.length > 0 || input.member.hidden || input.member.target || input.member.bitNumber != null),
    status: issues.length ? "needs-attention" as const : "reviewable" as const,
    issues,
    onlineDataTypeEditModelled: false as const,
    controllerDownloadModelled: false as const,
    controllerMemoryLayoutEnforced: false as const,
    bitPackingExecutionModelled: false as const,
    liveDisplayFormattingModelled: false as const,
    controllerExternalAccessEnforced: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function udtMemberMetadataReviewReport(project: PlcProject): UdtMemberMetadataReviewReport {
  const rows: UdtMemberMetadataReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const udt of controller.dataTypes) {
      const byName = memberMap(udt);
      const duplicateKeys = duplicateOverlayKeys(udt);
      for (const member of udt.members) {
        rows.push(rowFor({
          controllerId: controller.id,
          controllerName: controller.name,
          udt,
          member,
          membersByName: byName,
          duplicateKeys,
        }));
      }
    }
  }
  const hasIssue = (issue: UdtMemberMetadataReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    dataTypeCount: project.controllers.reduce((sum, controller) => sum + controller.dataTypes.length, 0),
    memberCount: rows.length,
    displayMetadataMemberCount: rows.filter((row) => row.displayMetadataPresent).length,
    layoutMetadataMemberCount: rows.filter((row) => row.layoutMetadataPresent).length,
    hiddenHostCount: rows.filter((row) => row.overlayRole === "hidden-host").length,
    bitOverlayMemberCount: rows.filter((row) => row.overlayRole === "bit-overlay").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    duplicateOverlayBitCount: hasIssue("duplicate-overlay-bit"),
    missingOverlayTargetCount: hasIssue("missing-overlay-target"),
    invalidOverlayCount:
      hasIssue("hidden-member-has-overlay-target") +
      hasIssue("target-without-bit-number") +
      hasIssue("bit-number-without-target") +
      hasIssue("overlay-target-not-integer") +
      hasIssue("bit-number-out-of-range") +
      hasIssue("overlay-member-not-bool"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
