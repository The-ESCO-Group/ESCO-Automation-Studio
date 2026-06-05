import type { Controller, ControllerSecurity, PlcProject } from "@esco/core";

export type ControllerSecurityReviewStatus =
  | "no-metadata"
  | "reviewable"
  | "secured-authority"
  | "needs-attention";

export type ControllerSecurityReviewIssue =
  | "partial-change-detection-metadata"
  | "partial-security-authority"
  | "authority-without-security-settings";

export type ControllerSecurityReviewBoundary =
  | "no-controller-communication"
  | "no-security-permission-enforcement"
  | "no-factorytalk-security-authentication"
  | "no-source-protection-enforcement"
  | "no-change-detection-monitoring"
  | "no-controller-audit-log-write";

export interface ControllerSecurityReviewRow {
  controllerId: string;
  controllerName: string;
  code?: string;
  changesToDetect?: string;
  securityAuthorityId?: string;
  securityAuthorityName?: string;
  securityMetadataPresent: boolean;
  sourceProtectionCodePresent: boolean;
  changeDetectionPresent: boolean;
  securityAuthorityPresent: boolean;
  status: ControllerSecurityReviewStatus;
  issues: ControllerSecurityReviewIssue[];
  controllerCommunicationModelled: false;
  securityPermissionEnforcementModelled: false;
  factoryTalkSecurityAuthenticationModelled: false;
  sourceProtectionEnforced: false;
  changeDetectionMonitoringModelled: false;
  controllerAuditLogWriteModelled: false;
  boundaries: ControllerSecurityReviewBoundary[];
  message: string;
}

export interface ControllerSecurityReviewReport {
  rows: ControllerSecurityReviewRow[];
  controllerCount: number;
  securityMetadataCount: number;
  reviewableCount: number;
  sourceProtectionCodeCount: number;
  changeDetectionCount: number;
  securedAuthorityCount: number;
  issueCount: number;
  partialSecurityCount: number;
  authorityIssueCount: number;
  warnings: string[];
}

const BOUNDARIES: ControllerSecurityReviewBoundary[] = [
  "no-controller-communication",
  "no-security-permission-enforcement",
  "no-factorytalk-security-authentication",
  "no-source-protection-enforcement",
  "no-change-detection-monitoring",
  "no-controller-audit-log-write",
];

function blank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | undefined): string | undefined {
  return blank(value) ? undefined : value!.trim();
}

function securityPresent(security: ControllerSecurity | undefined): boolean {
  return (
    !blank(security?.code) ||
    !blank(security?.changesToDetect) ||
    !blank(security?.securityAuthorityId) ||
    !blank(security?.securityAuthorityName)
  );
}

function issuesFor(security: ControllerSecurity | undefined): ControllerSecurityReviewIssue[] {
  const issues: ControllerSecurityReviewIssue[] = [];
  if (!securityPresent(security)) return issues;

  const hasCode = !blank(security?.code);
  const hasChangesToDetect = !blank(security?.changesToDetect);
  const hasAuthorityId = !blank(security?.securityAuthorityId);
  const hasAuthorityName = !blank(security?.securityAuthorityName);

  if (hasCode !== hasChangesToDetect) issues.push("partial-change-detection-metadata");
  if (hasAuthorityId !== hasAuthorityName) issues.push("partial-security-authority");
  if ((hasAuthorityId || hasAuthorityName) && (!hasCode || !hasChangesToDetect)) {
    issues.push("authority-without-security-settings");
  }
  return issues;
}

function issueLabel(issue: ControllerSecurityReviewIssue): string {
  switch (issue) {
    case "partial-change-detection-metadata":
      return "Security Code and ChangesToDetect should be reviewed as a pair";
    case "partial-security-authority":
      return "SecurityAuthorityID and SecurityAuthorityName should be reviewed as a pair";
    case "authority-without-security-settings":
      return "security authority metadata is present without complete source-protection/change-detection settings";
  }
}

function statusFor(
  security: ControllerSecurity | undefined,
  issues: ControllerSecurityReviewIssue[],
): ControllerSecurityReviewStatus {
  if (!securityPresent(security)) return "no-metadata";
  if (issues.length) return "needs-attention";
  if (!blank(security?.securityAuthorityId) && !blank(security?.securityAuthorityName)) {
    return "secured-authority";
  }
  return "reviewable";
}

function messageFor(row: Omit<ControllerSecurityReviewRow, "message">): string {
  if (row.issues.length) {
    return `Controller "${row.controllerName}" security metadata needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  if (!row.securityMetadataPresent) {
    return `Controller "${row.controllerName}" has no imported Security metadata to review.`;
  }
  if (row.securityAuthorityPresent) {
    return `Controller "${row.controllerName}" is bound to a FactoryTalk security authority for offline review; authentication and permission enforcement are not modelled.`;
  }
  return `Controller "${row.controllerName}" Security metadata is reviewable offline; source protection, change detection, and controller audit logs are not modelled.`;
}

function rowFor(controller: Controller): ControllerSecurityReviewRow {
  const security = controller.security;
  const issues = issuesFor(security);
  const rowBase = {
    controllerId: controller.id,
    controllerName: controller.name,
    code: present(security?.code),
    changesToDetect: present(security?.changesToDetect),
    securityAuthorityId: present(security?.securityAuthorityId),
    securityAuthorityName: present(security?.securityAuthorityName),
    securityMetadataPresent: securityPresent(security),
    sourceProtectionCodePresent: !blank(security?.code),
    changeDetectionPresent: !blank(security?.changesToDetect),
    securityAuthorityPresent: !blank(security?.securityAuthorityId) && !blank(security?.securityAuthorityName),
    status: statusFor(security, issues),
    issues,
    controllerCommunicationModelled: false as const,
    securityPermissionEnforcementModelled: false as const,
    factoryTalkSecurityAuthenticationModelled: false as const,
    sourceProtectionEnforced: false as const,
    changeDetectionMonitoringModelled: false as const,
    controllerAuditLogWriteModelled: false as const,
    boundaries: [...BOUNDARIES],
  };
  return { ...rowBase, message: messageFor(rowBase) };
}

export function controllerSecurityReviewReport(project: PlcProject): ControllerSecurityReviewReport {
  const rows = project.controllers.map(rowFor);
  const hasIssue = (issue: ControllerSecurityReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;
  return {
    rows,
    controllerCount: rows.length,
    securityMetadataCount: rows.filter((row) => row.securityMetadataPresent).length,
    reviewableCount: rows.filter((row) => row.status === "reviewable" || row.status === "secured-authority").length,
    sourceProtectionCodeCount: rows.filter((row) => row.sourceProtectionCodePresent).length,
    changeDetectionCount: rows.filter((row) => row.changeDetectionPresent).length,
    securedAuthorityCount: rows.filter((row) => row.securityAuthorityPresent).length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    partialSecurityCount: hasIssue("partial-change-detection-metadata"),
    authorityIssueCount:
      hasIssue("partial-security-authority") + hasIssue("authority-without-security-settings"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
