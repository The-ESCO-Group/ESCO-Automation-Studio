import {
  controllerSafetyEvidenceReport,
  shippedControllerSafetyEvidenceReport,
  type ControllerSafetyEvidenceReport,
} from "./controller-safety-evidence";
import type { ShippedControllerProviderEvidenceInput } from "./controller-safety-evidence";

export type OnlineReadinessStageStatus = "complete" | "partial" | "blocked";

export interface OnlineReadinessStage {
  id: string;
  label: string;
  status: OnlineReadinessStageStatus;
  lane: "foundation" | "read-only" | "write" | "release";
  summary: string;
  evidence: string[];
  nextStep: string;
}

export interface OnlineReadinessTopologyNode {
  id: string;
  label: string;
  status: OnlineReadinessStageStatus;
}

export interface OnlineReadinessTopologyEdge {
  from: string;
  to: string;
  label: string;
  status: OnlineReadinessStageStatus;
}

export interface OnlineReadinessReport {
  stages: OnlineReadinessStage[];
  topology: {
    nodes: OnlineReadinessTopologyNode[];
    edges: OnlineReadinessTopologyEdge[];
  };
  stageCount: number;
  completedStageCount: number;
  partialStageCount: number;
  blockedStageCount: number;
  firstHalfPrepared: boolean;
  onlineEnabled: boolean;
  readOnlyOnlinePossible: boolean;
  destructiveOnlinePossible: boolean;
  verifiedPhysicalTransportCount: number;
  blockedBoundaryCount: number;
  physicalBoundaryCount: number;
  summary: string;
  nextStep: string;
}

export interface OnlineReadinessOptions {
  safetyEvidence?: ControllerSafetyEvidenceReport;
  providers?: readonly ShippedControllerProviderEvidenceInput[];
  destructiveValidationComplete?: boolean;
  onlineEditValidationComplete?: boolean;
}

function stage(
  id: string,
  label: string,
  status: OnlineReadinessStageStatus,
  lane: OnlineReadinessStage["lane"],
  summary: string,
  evidence: string[],
  nextStep: string,
): OnlineReadinessStage {
  return { id, label, status, lane, summary, evidence, nextStep };
}

function statusLabel(status: OnlineReadinessStageStatus): string {
  if (status === "complete") return "complete";
  if (status === "partial") return "partially prepared";
  return "blocked";
}

/**
 * Build the staged online-readiness report.
 *
 * This is deliberately a readiness scaffold, not an online implementation. It
 * marks the engineering foundation that is already complete, shows the exact
 * gates still blocking physical online use, and keeps destructive operations
 * blocked unless a future verified hardware transport and separate write/online
 * edit validation are both supplied.
 */
export function onlineReadinessReport(options: OnlineReadinessOptions = {}): OnlineReadinessReport {
  const safetyEvidence =
    options.safetyEvidence ??
    (options.providers ? controllerSafetyEvidenceReport(options.providers) : shippedControllerSafetyEvidenceReport());
  const verifiedPhysical = safetyEvidence.verifiedPhysicalProviderCount > 0;
  const readOnlyOnlinePossible = verifiedPhysical && safetyEvidence.realTransportGate === "available";
  const destructiveOnlinePossible =
    readOnlyOnlinePossible &&
    options.destructiveValidationComplete === true &&
    options.onlineEditValidationComplete === true;

  const realDriverStatus: OnlineReadinessStageStatus = readOnlyOnlinePossible ? "complete" : "blocked";
  const hardwareValidationStatus: OnlineReadinessStageStatus = verifiedPhysical ? "complete" : "blocked";
  const destructiveStatus: OnlineReadinessStageStatus =
    readOnlyOnlinePossible && options.destructiveValidationComplete === true ? "partial" : "blocked";
  const onlineEditStatus: OnlineReadinessStageStatus = destructiveOnlinePossible ? "partial" : "blocked";

  const stages: OnlineReadinessStage[] = [
    stage(
      "safety-gate",
      "Controller safety gate",
      "complete",
      "foundation",
      "Physical upload, download, Go Online, online edits, mode changes, forces, and proprietary transfer are enumerated and guarded.",
      [
        `${safetyEvidence.blockedPhysicalCommandRows}/${safetyEvidence.totalPhysicalCommandRows} shipped physical command rows are blocked.`,
        `${safetyEvidence.blockedBoundaryCount}/${safetyEvidence.physicalBoundaryCount} hard boundaries are blocked.`,
      ],
      "Keep the safety gate as the first dependency of every future online command.",
    ),
    stage(
      "provider-contract",
      "Transport and provider contract",
      "complete",
      "foundation",
      "Controller providers expose the honesty pair realControllerIo + verified before any physical command can clear.",
      [
        `${safetyEvidence.shippedProviderCount} shipped providers are classified.`,
        `${safetyEvidence.verifiedSoftwareProviderCount} provider is verified software-only.`,
      ],
      "Any future physical adapter must publish realControllerIo:true and verified:true only after hardware validation.",
    ),
    stage(
      "read-only-abstraction",
      "Read-only online abstraction",
      "complete",
      "read-only",
      "The controller-comm model has a read-only transport path and monitor-state matrix for future live value reads.",
      [
        `${safetyEvidence.monitorScenarioCount} monitor scenarios are modeled offline.`,
        `${safetyEvidence.blockedMonitorReadGates} monitor/fault-read gates remain blocked without verified real I/O.`,
      ],
      "Bind a future audited driver to the read-only monitor interface before enabling live tag reads.",
    ),
    stage(
      "preflight-audit",
      "Preflight and audit trail",
      "complete",
      "foundation",
      "Every guarded command can produce an ordered commissioning preflight and audit event before execution.",
      [
        "Preflight rows mirror command-gate blockers.",
        "Command attempts are recorded as blocked or ran with risk/reason metadata.",
      ],
      "Extend audit metadata with signed operator/session evidence before field use.",
    ),
    stage(
      "operator-ui",
      "Operator-facing readiness UI",
      "complete",
      "foundation",
      "The Controller dock surfaces safety evidence, transport readiness, monitor matrix, path diagnostics, and this online-readiness topology.",
      [
        "Online readiness stages are visible beside the existing Controller safety evidence.",
        "Blocked destructive commands keep their reason and next step visible.",
      ],
      "Keep online readiness visible in release builds so engineers can see what is and is not enabled.",
    ),
    stage(
      "online-compare-backup",
      "Online/offline compare and backup",
      "partial",
      "release",
      "ESCO-native runtime/package/snapshot flows exist, but real controller compare, backup-before-write, and rollback are not tied to hardware.",
      [
        "SoftController upload/download/rollback exists for software runtime images.",
        "Physical controller backup and compare remain unavailable without verified transport.",
      ],
      "Add read-only online snapshot capture and compare evidence before any write-capable path is considered.",
    ),
    stage(
      "verified-readonly-driver",
      "Verified read-only real driver",
      realDriverStatus,
      "read-only",
      verifiedPhysical
        ? "A verified physical provider is present in the supplied evidence, so read-only online gates can be modeled as clear."
        : "No verified physical provider ships, so real read-only online monitoring remains blocked.",
      [
        `${safetyEvidence.verifiedPhysicalProviderCount} verified physical provider(s).`,
        `${safetyEvidence.readyShippedDriverCount}/${safetyEvidence.shippedDriverCount} shipped driver descriptors ready.`,
      ],
      verifiedPhysical
        ? "Restrict the first online release to read-only identity, diagnostics, and live tag monitor."
        : "Implement and hardware-validate a read-only controller driver before enabling Go Online or Monitor.",
    ),
    stage(
      "hardware-validation",
      "Hardware validation lab",
      hardwareValidationStatus,
      "release",
      verifiedPhysical
        ? "The supplied evidence includes a verified physical provider."
        : "No hardware-in-the-loop validation evidence is present for a real controller transport.",
      [
        `Real transport gate is ${safetyEvidence.realTransportGate}.`,
        safetyEvidence.summary,
      ],
      verifiedPhysical
        ? "Keep validation evidence versioned per firmware, controller family, and transport build."
        : "Create a hardware validation harness before marking any physical transport verified.",
    ),
    stage(
      "controlled-writes",
      "Controlled writes and download",
      destructiveStatus,
      "write",
      "Write-capable controller actions require verified transport, backup/compare, role checks, and explicit confirmation.",
      [
        destructiveStatus === "blocked"
          ? "Physical writes/downloads remain blocked."
          : "Read-only transport is available, but destructive validation is still not fully released.",
      ],
      "Do not enable download, mode changes, fault clearing, or tag writes until write validation and rollback gates pass.",
    ),
    stage(
      "online-edits-forces",
      "Online edits and physical forces",
      onlineEditStatus,
      "write",
      "Live logic edits and physical PLC forces are the last tier and remain unavailable until a separate destructive workflow is proven.",
      [
        "Online edit commands are registered as guarded hardware commands.",
        "No physical force command is registered; virtual forces are local ESCO software only.",
      ],
      "Keep online edits and real PLC forces disabled until field validation, operator authorization, and rollback are independently proven.",
    ),
  ];

  const completedStageCount = stages.filter((item) => item.status === "complete").length;
  const partialStageCount = stages.filter((item) => item.status === "partial").length;
  const blockedStageCount = stages.filter((item) => item.status === "blocked").length;
  const topologyStatus: OnlineReadinessStageStatus = readOnlyOnlinePossible ? "complete" : "blocked";

  return {
    stages,
    topology: {
      nodes: [
        { id: "studio", label: "ESCO Studio", status: "complete" },
        { id: "safety-gate", label: "Safety Gate", status: "complete" },
        { id: "provider-contract", label: "Provider Contract", status: "complete" },
        { id: "soft-controller", label: "SoftController", status: "complete" },
        { id: "readonly-driver", label: "Future Read-only Driver", status: topologyStatus },
        { id: "real-controller", label: "Real Controller", status: topologyStatus },
        { id: "write-ops", label: "Write / Download / Online Edit", status: destructiveOnlinePossible ? "partial" : "blocked" },
      ],
      edges: [
        { from: "studio", to: "safety-gate", label: "all commands gated", status: "complete" },
        { from: "safety-gate", to: "provider-contract", label: "capability honesty", status: "complete" },
        { from: "provider-contract", to: "soft-controller", label: "software-only verified", status: "complete" },
        { from: "provider-contract", to: "readonly-driver", label: "requires audited real transport", status: topologyStatus },
        { from: "readonly-driver", to: "real-controller", label: "read-only online monitor", status: topologyStatus },
        { from: "safety-gate", to: "write-ops", label: "blocked until separate destructive validation", status: destructiveOnlinePossible ? "partial" : "blocked" },
      ],
    },
    stageCount: stages.length,
    completedStageCount,
    partialStageCount,
    blockedStageCount,
    firstHalfPrepared: completedStageCount >= Math.ceil(stages.length / 2),
    onlineEnabled: readOnlyOnlinePossible,
    readOnlyOnlinePossible,
    destructiveOnlinePossible,
    verifiedPhysicalTransportCount: safetyEvidence.verifiedPhysicalProviderCount,
    blockedBoundaryCount: safetyEvidence.blockedBoundaryCount,
    physicalBoundaryCount: safetyEvidence.physicalBoundaryCount,
    summary: `${completedStageCount}/${stages.length} online-readiness stages are ${statusLabel("complete")}; read-only online is ${
      readOnlyOnlinePossible ? "prepared for a verified transport" : "blocked because no verified physical transport ships"
    }; destructive online operations are ${destructiveOnlinePossible ? "partially staged" : "blocked"}.`,
    nextStep: readOnlyOnlinePossible
      ? "Keep the first physical online release read-only, with identity, diagnostics, tag monitor, audit, and compare evidence only."
      : "Build and validate a read-only hardware transport in a lab before enabling physical Go Online or Monitor.",
  };
}

export function shippedOnlineReadinessReport(): OnlineReadinessReport {
  return onlineReadinessReport();
}
