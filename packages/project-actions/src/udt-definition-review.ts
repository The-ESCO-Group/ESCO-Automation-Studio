import { arrayDimensionsOf, type PlcProject, type UdtMember, type UserDefinedType } from "@esco/core";

export type UdtDefinitionReviewStatus =
  | "reviewable"
  | "string-family"
  | "needs-attention";

export type UdtDefinitionFamilyKind =
  | "ordinary"
  | "string-family"
  | "unspecified"
  | "unrecognized";

export type UdtDefinitionReviewIssue =
  | "empty-data-type"
  | "unrecognized-data-type-family"
  | "missing-string-len-member"
  | "invalid-string-len-member"
  | "missing-string-data-member"
  | "invalid-string-data-member"
  | "missing-string-data-dimension";

export type UdtDefinitionReviewBoundary =
  | "no-controller-communication"
  | "no-online-data-type-edit"
  | "no-controller-download"
  | "no-controller-memory-layout-enforcement"
  | "no-custom-string-runtime-layout"
  | "no-live-data-type-editor";

export interface UdtDefinitionReviewRow {
  controllerId: string;
  controllerName: string;
  dataTypeId: string;
  dataTypeName: string;
  description?: string;
  family?: string;
  familyKind: UdtDefinitionFamilyKind;
  memberCount: number;
  lenMemberPresent: boolean;
  dataMemberPresent: boolean;
  dataMemberDimension?: number;
  dataMemberDimensions?: number[];
  status: UdtDefinitionReviewStatus;
  issues: UdtDefinitionReviewIssue[];
  onlineDataTypeEditModelled: false;
  controllerDownloadModelled: false;
  controllerMemoryLayoutEnforced: false;
  customStringRuntimeLayoutModelled: false;
  liveDataTypeEditorModelled: false;
  boundaries: UdtDefinitionReviewBoundary[];
  message: string;
}

export interface UdtDefinitionReviewReport {
  rows: UdtDefinitionReviewRow[];
  controllerCount: number;
  dataTypeCount: number;
  familyMetadataCount: number;
  stringFamilyCount: number;
  unrecognizedFamilyCount: number;
  emptyDataTypeCount: number;
  issueCount: number;
  stringShapeIssueCount: number;
  warnings: string[];
}

const BOUNDARIES: UdtDefinitionReviewBoundary[] = [
  "no-controller-communication",
  "no-online-data-type-edit",
  "no-controller-download",
  "no-controller-memory-layout-enforcement",
  "no-custom-string-runtime-layout",
  "no-live-data-type-editor",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function familyKind(family: string | undefined): UdtDefinitionFamilyKind {
  const normalized = family?.trim().toLowerCase();
  if (!normalized) return "unspecified";
  if (normalized === "nofamily") return "ordinary";
  if (normalized === "stringfamily") return "string-family";
  return "unrecognized";
}

function memberNamed(udt: UserDefinedType, name: string): UdtMember | undefined {
  return udt.members.find((member) => member.name.trim().toLowerCase() === name.toLowerCase());
}

function stringDataDimensions(member: UdtMember | undefined): number[] {
  return member ? arrayDimensionsOf(member) : [];
}

function issuesFor(udt: UserDefinedType): UdtDefinitionReviewIssue[] {
  const issues: UdtDefinitionReviewIssue[] = [];
  const kind = familyKind(udt.family);
  if (udt.members.length === 0) issues.push("empty-data-type");
  if (kind === "unrecognized") issues.push("unrecognized-data-type-family");

  if (kind === "string-family") {
    const len = memberNamed(udt, "LEN");
    const data = memberNamed(udt, "DATA");
    if (!len) {
      issues.push("missing-string-len-member");
    } else if (len.dataType.trim().toUpperCase() !== "DINT") {
      issues.push("invalid-string-len-member");
    }
    if (!data) {
      issues.push("missing-string-data-member");
    } else {
      if (data.dataType.trim().toUpperCase() !== "SINT") issues.push("invalid-string-data-member");
      if (stringDataDimensions(data).length === 0) issues.push("missing-string-data-dimension");
    }
  }
  return [...new Set(issues)];
}

function issueLabel(issue: UdtDefinitionReviewIssue): string {
  switch (issue) {
    case "empty-data-type":
      return "data type has no members";
    case "unrecognized-data-type-family":
      return "data-type family is not NoFamily or StringFamily";
    case "missing-string-len-member":
      return "StringFamily data type is missing LEN";
    case "invalid-string-len-member":
      return "StringFamily LEN member must be DINT";
    case "missing-string-data-member":
      return "StringFamily data type is missing DATA";
    case "invalid-string-data-member":
      return "StringFamily DATA member must be SINT";
    case "missing-string-data-dimension":
      return "StringFamily DATA member must be an array";
  }
}

function statusFor(kind: UdtDefinitionFamilyKind, issues: UdtDefinitionReviewIssue[]): UdtDefinitionReviewStatus {
  if (issues.length) return "needs-attention";
  if (kind === "string-family") return "string-family";
  return "reviewable";
}

function messageFor(row: Omit<UdtDefinitionReviewRow, "message">): string {
  if (row.issues.length) {
    return `UDT "${row.dataTypeName}" definition metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (row.familyKind === "string-family") {
    return `UDT "${row.dataTypeName}" StringFamily metadata is reviewable offline; custom string runtime layout and controller memory-layout enforcement are not modelled.`;
  }
  if (row.familyKind === "ordinary") {
    return `UDT "${row.dataTypeName}" NoFamily metadata is reviewable offline; online data-type edits and controller download are not modelled.`;
  }
  return `UDT "${row.dataTypeName}" definition is reviewable offline; no data-type Family metadata was imported.`;
}

function rowFor(controllerId: string, controllerName: string, udt: UserDefinedType): UdtDefinitionReviewRow {
  const kind = familyKind(udt.family);
  const issues = issuesFor(udt);
  const data = memberNamed(udt, "DATA");
  const dataDimensions = stringDataDimensions(data);
  const rowBase = {
    controllerId,
    controllerName,
    dataTypeId: udt.id,
    dataTypeName: udt.name,
    description: udt.description,
    family: present(udt.family),
    familyKind: kind,
    memberCount: udt.members.length,
    lenMemberPresent: Boolean(memberNamed(udt, "LEN")),
    dataMemberPresent: Boolean(data),
    ...(dataDimensions[0] ? { dataMemberDimension: dataDimensions[0] } : {}),
    ...(dataDimensions.length > 1 ? { dataMemberDimensions: dataDimensions } : {}),
    status: statusFor(kind, issues),
    issues,
    onlineDataTypeEditModelled: false as const,
    controllerDownloadModelled: false as const,
    controllerMemoryLayoutEnforced: false as const,
    customStringRuntimeLayoutModelled: false as const,
    liveDataTypeEditorModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function udtDefinitionReviewReport(project: PlcProject): UdtDefinitionReviewReport {
  const rows = project.controllers.flatMap((controller) =>
    controller.dataTypes.map((udt) => rowFor(controller.id, controller.name, udt)),
  );
  const hasIssue = (issue: UdtDefinitionReviewIssue) => rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: project.controllers.length,
    dataTypeCount: rows.length,
    familyMetadataCount: rows.filter((row) => row.familyKind !== "unspecified").length,
    stringFamilyCount: rows.filter((row) => row.familyKind === "string-family").length,
    unrecognizedFamilyCount: rows.filter((row) => row.familyKind === "unrecognized").length,
    emptyDataTypeCount: hasIssue("empty-data-type"),
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    stringShapeIssueCount:
      hasIssue("missing-string-len-member") +
      hasIssue("invalid-string-len-member") +
      hasIssue("missing-string-data-member") +
      hasIssue("invalid-string-data-member") +
      hasIssue("missing-string-data-dimension"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
