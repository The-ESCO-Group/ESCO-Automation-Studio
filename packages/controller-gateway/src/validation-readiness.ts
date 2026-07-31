import type {
  ControllerDriverSummary,
  DriverValidationReadiness,
  GatewayValidationGate,
  GatewayValidationGateState,
  GatewayValidationReadinessReport,
} from "./types";

export function gatewayValidationReadinessReport(
  drivers: readonly ControllerDriverSummary[],
  generatedAt = new Date().toISOString(),
): GatewayValidationReadinessReport {
  const driverReports = drivers.map(driverValidationReadiness);
  const realControllerRouteCount = driverReports.filter((driver) => driver.realControllerIo).length;
  const hardwareValidatedRouteCount = driverReports.filter((driver) => driver.hardwareValidated).length;
  const readOnlyReleaseEligibleRouteCount = driverReports.filter((driver) => driver.readOnlyReleaseEligible).length;
  return {
    generatedAt,
    driverCount: driverReports.length,
    realControllerRouteCount,
    hardwareValidatedRouteCount,
    readOnlyReleaseEligibleRouteCount,
    destructiveOperationsEnabled: false,
    summary:
      readOnlyReleaseEligibleRouteCount > 0
        ? `${readOnlyReleaseEligibleRouteCount}/${driverReports.length} driver route(s) are eligible for read-only release. Physical writes remain disabled.`
        : "No real-controller route has lab or field validation evidence attached yet. Online use remains read-only engineering preview.",
    nextStep:
      hardwareValidatedRouteCount > 0
        ? "Keep validation evidence versioned by controller family, firmware, driver build, and plant network route."
        : "Run the hardware validation checklist for EtherNet/IP and OPC UA routes before marking either route lab-verified or field-validated.",
    drivers: driverReports,
  };
}

export function driverValidationReadiness(driver: ControllerDriverSummary): DriverValidationReadiness {
  const evidence = driver.connectionEvidence;
  const mutationsBlocked = [
    driver.capabilities.canWriteTags,
    driver.capabilities.canDownloadProject,
    driver.capabilities.canOnlineEdit,
    driver.capabilities.canForceTags,
    driver.capabilities.canModeChange,
    driver.capabilities.canClearFaults,
  ].every((capability) => capability === false);
  const transportImplemented = driver.capabilities.canConnect && evidence.transportValidation !== "none";
  const hardwareValidated =
    evidence.realControllerIo &&
    evidence.hardwareValidated &&
    evidence.verified &&
    (evidence.transportValidation === "lab-verified" || evidence.transportValidation === "field-validated");
  const softwareOnlyVerified = !evidence.realControllerIo && evidence.verified;
  const readOnlyReleaseEligible =
    driver.capabilities.canConnect && mutationsBlocked && (hardwareValidated || softwareOnlyVerified);
  return {
    driverId: driver.id,
    driverName: driver.name,
    kind: driver.kind,
    transportValidation: evidence.transportValidation,
    realControllerIo: evidence.realControllerIo,
    hardwareValidated,
    verified: evidence.verified,
    readOnlyReleaseEligible,
    destructiveOperationsBlocked: true,
    summary: summaryFor(driver, readOnlyReleaseEligible, hardwareValidated, softwareOnlyVerified),
    gates: [
      gate(
        "transport-implemented",
        "Transport implementation",
        transportImplemented ? "passed" : "blocked",
        transportImplemented
          ? `${driver.name} exposes a connectable read-only transport path.`
          : `${driver.name} has no live transport implementation in this build.`,
        [
          `transportValidation=${evidence.transportValidation}`,
          `canConnect=${String(driver.capabilities.canConnect)}`,
        ],
        transportImplemented ? "Keep connect/read tests in CI." : "Implement a backend transport before validation can start.",
      ),
      gate(
        "hardware-validation-evidence",
        "Hardware validation evidence",
        hardwareValidationState(driver),
        hardwareValidationSummary(driver),
        [
          `realControllerIo=${String(evidence.realControllerIo)}`,
          `hardwareValidated=${String(evidence.hardwareValidated)}`,
          `verified=${String(evidence.verified)}`,
          ...(evidence.evidenceId ? [`evidenceId=${evidence.evidenceId}`] : []),
          ...(evidence.validatedAt ? [`validatedAt=${evidence.validatedAt}`] : []),
        ],
        hardwareValidated || softwareOnlyVerified
          ? "Keep the evidence attached to the driver build."
          : "Attach lab or field validation evidence before marking this route release-ready.",
      ),
      gate(
        "identity-proof",
        "Loaded-project identity proof",
        driver.capabilities.canCompareProject ? "not-run" : "blocked",
        driver.capabilities.canCompareProject
          ? "The gateway can run local-vs-controller identity compare when proof tags or driver identity data are available."
          : "This driver cannot compare the local project to the online session.",
        [
          `canCompareProject=${String(driver.capabilities.canCompareProject)}`,
          "proofTags=ESCO_ControllerName, ESCO_ControllerType, ESCO_ProjectName, ESCO_ProjectSignatureDigest, ESCO_ProjectSignatureAlgorithm",
        ],
        "Install/read proof tags, then run compare before considering any future write-capable path.",
      ),
      gate(
        "mutation-safety",
        "Write/download/edit safety",
        mutationsBlocked ? "passed" : "blocked",
        mutationsBlocked
          ? "Public gateway capabilities expose no writes, downloads, online edits, forces, mode changes, or clear-fault commands."
          : "One or more mutation capabilities are enabled and require destructive validation gates.",
        [
          `canWriteTags=${String(driver.capabilities.canWriteTags)}`,
          `canDownloadProject=${String(driver.capabilities.canDownloadProject)}`,
          `canOnlineEdit=${String(driver.capabilities.canOnlineEdit)}`,
          `canForceTags=${String(driver.capabilities.canForceTags)}`,
          `canModeChange=${String(driver.capabilities.canModeChange)}`,
          `canClearFaults=${String(driver.capabilities.canClearFaults)}`,
        ],
        mutationsBlocked
          ? "Keep destructive operations disabled until a separate permission, backup, audit, and read-back flow exists."
          : "Disable mutation capabilities until the destructive workflow is reviewed.",
      ),
    ],
  };
}

function gate(
  id: string,
  label: string,
  state: GatewayValidationGateState,
  summary: string,
  evidence: string[],
  nextStep: string,
): GatewayValidationGate {
  return { id, label, state, summary, evidence, nextStep };
}

function hardwareValidationState(driver: ControllerDriverSummary): GatewayValidationGateState {
  const evidence = driver.connectionEvidence;
  if (!evidence.realControllerIo) return evidence.verified ? "passed" : "not-run";
  return evidence.hardwareValidated && evidence.verified ? "passed" : "blocked";
}

function hardwareValidationSummary(driver: ControllerDriverSummary): string {
  const evidence = driver.connectionEvidence;
  if (!evidence.realControllerIo) return `${driver.name} is not a physical-controller route.`;
  if (evidence.hardwareValidated && evidence.verified) {
    return `${driver.name} has ${evidence.transportValidation} hardware evidence attached.`;
  }
  return `${driver.name} can target real controller I/O but has no lab/field validation evidence attached.`;
}

function summaryFor(
  driver: ControllerDriverSummary,
  readOnlyReleaseEligible: boolean,
  hardwareValidated: boolean,
  softwareOnlyVerified: boolean,
): string {
  if (readOnlyReleaseEligible && hardwareValidated) return "Eligible for read-only hardware release; destructive operations remain blocked.";
  if (readOnlyReleaseEligible && softwareOnlyVerified) return "Verified software-only route; no physical PLC I/O is involved.";
  if (driver.connectionEvidence.realControllerIo) return "Real-controller route is software-wired only until validation evidence is attached.";
  return "Route is available for review/simulation only and is not a physical controller path.";
}
