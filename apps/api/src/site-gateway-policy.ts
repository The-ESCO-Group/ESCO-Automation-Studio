import type {
  ConnectionConfig,
  ControllerDriverKind,
  ControllerDriverSummary,
} from "@esco/controller-gateway";

export type SiteGatewayConnectionMode = "local-dev-direct" | "site-gateway-required";
export type SiteGatewayStatus = "connected" | "configured" | "offline";

export interface SiteGatewayDescriptor {
  id: string;
  name: string;
  status: SiteGatewayStatus;
  location?: string;
  lastSeenAt?: string;
  allowedDriverIds?: string[];
  allowedDriverKinds?: ControllerDriverKind[];
  allowedEndpointPatterns: string[];
  readOnlyOnly: true;
  notes: string;
}

export interface SiteGatewayPolicyReport {
  generatedAt: string;
  mode: SiteGatewayConnectionMode;
  requiredForRealControllerIo: boolean;
  directControllerConnectionsAllowed: boolean;
  configuredGatewayCount: number;
  connectedGatewayCount: number;
  gateways: SiteGatewayDescriptor[];
  summary: string;
  nextStep: string;
}

export interface SiteGatewayPolicyOptions {
  mode?: SiteGatewayConnectionMode;
  allowDirectControllerConnections?: boolean;
  gateways?: SiteGatewayDescriptor[];
}

export interface SiteGatewayDecision {
  allowed: boolean;
  message: string;
  gateway?: SiteGatewayDescriptor;
}

export class SiteGatewayPolicy {
  private readonly mode: SiteGatewayConnectionMode;
  private readonly allowDirectControllerConnections: boolean;
  private readonly gateways: SiteGatewayDescriptor[];

  constructor(options: SiteGatewayPolicyOptions = {}) {
    this.mode = options.mode ?? "local-dev-direct";
    this.allowDirectControllerConnections =
      options.allowDirectControllerConnections ?? this.mode === "local-dev-direct";
    this.gateways = [...(options.gateways ?? [])];
  }

  report(generatedAt = new Date().toISOString()): SiteGatewayPolicyReport {
    const required = this.mode === "site-gateway-required";
    const connectedGatewayCount = this.gateways.filter((gateway) => gateway.status === "connected").length;
    return {
      generatedAt,
      mode: this.mode,
      requiredForRealControllerIo: required,
      directControllerConnectionsAllowed: this.allowDirectControllerConnections && !required,
      configuredGatewayCount: this.gateways.length,
      connectedGatewayCount,
      gateways: this.gateways,
      summary: required
        ? `Hosted site-gateway policy is enforced; ${connectedGatewayCount}/${this.gateways.length} gateway(s) are connected.`
        : "Local development policy allows direct read-only controller routes from the API host.",
      nextStep: required
        ? "Register an on-site gateway for each plant network segment before opening real-controller routes."
        : "Enable ESCO_REQUIRE_SITE_GATEWAY=true for hosted deployments so real PLC routes must go through a site gateway.",
    };
  }

  evaluateConnection(
    driver: ControllerDriverSummary | undefined,
    config: ConnectionConfig,
  ): SiteGatewayDecision {
    if (!driver?.connectionEvidence.realControllerIo) {
      return { allowed: true, message: "Site gateway is not required for software-only routes." };
    }

    const requestedGatewayId = config.siteGatewayId?.trim();
    if (requestedGatewayId) {
      const gateway = this.gateways.find((candidate) => candidate.id === requestedGatewayId);
      if (!gateway) {
        return {
          allowed: false,
          message: `Site gateway "${requestedGatewayId}" is not registered with this ESCO API host.`,
        };
      }
      return this.evaluateGateway(driver, config, gateway);
    }

    if (this.mode === "site-gateway-required" || !this.allowDirectControllerConnections) {
      return {
        allowed: false,
        message:
          `${driver.name} targets real controller I/O. Hosted deployments require a registered site gateway ` +
          "before EtherNet/IP or OPC UA routes can be opened.",
      };
    }

    return {
      allowed: true,
      message: "Local development direct route is allowed by the current site-gateway policy.",
    };
  }

  private evaluateGateway(
    driver: ControllerDriverSummary,
    config: ConnectionConfig,
    gateway: SiteGatewayDescriptor,
  ): SiteGatewayDecision {
    if (gateway.status !== "connected") {
      return {
        allowed: false,
        gateway,
        message: `Site gateway "${gateway.name}" is ${gateway.status}; it must be connected before opening this route.`,
      };
    }
    if (!gatewayAllowsDriver(gateway, driver)) {
      return {
        allowed: false,
        gateway,
        message: `Site gateway "${gateway.name}" is not approved for ${driver.name}.`,
      };
    }
    if (!gatewayAllowsEndpoint(gateway, config.endpointUrl)) {
      return {
        allowed: false,
        gateway,
        message:
          `Site gateway "${gateway.name}" does not allow endpoint ${config.endpointUrl ?? "(missing)"}.`,
      };
    }
    return {
      allowed: true,
      gateway,
      message: `Route approved through site gateway "${gateway.name}".`,
    };
  }
}

export function siteGatewayPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): SiteGatewayPolicy {
  const requireGateway = isTruthy(env.ESCO_REQUIRE_SITE_GATEWAY);
  const gateways = parseGateways(env.ESCO_SITE_GATEWAYS_JSON);
  return new SiteGatewayPolicy({
    mode: requireGateway ? "site-gateway-required" : "local-dev-direct",
    allowDirectControllerConnections: !requireGateway,
    gateways,
  });
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function parseGateways(raw: string | undefined): SiteGatewayDescriptor[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSiteGatewayDescriptor);
  } catch {
    return [];
  }
}

function isSiteGatewayDescriptor(value: unknown): value is SiteGatewayDescriptor {
  if (!value || typeof value !== "object") return false;
  const gateway = value as SiteGatewayDescriptor;
  return (
    typeof gateway.id === "string" &&
    typeof gateway.name === "string" &&
    (gateway.status === "connected" || gateway.status === "configured" || gateway.status === "offline") &&
    Array.isArray(gateway.allowedEndpointPatterns) &&
    gateway.allowedEndpointPatterns.every((pattern) => typeof pattern === "string") &&
    gateway.readOnlyOnly === true &&
    typeof gateway.notes === "string"
  );
}

function gatewayAllowsDriver(gateway: SiteGatewayDescriptor, driver: ControllerDriverSummary): boolean {
  const allowedIds = gateway.allowedDriverIds ?? [];
  const allowedKinds = gateway.allowedDriverKinds ?? [];
  if (allowedIds.length === 0 && allowedKinds.length === 0) return true;
  return allowedIds.includes(driver.id) || allowedKinds.includes(driver.kind);
}

function gatewayAllowsEndpoint(gateway: SiteGatewayDescriptor, endpointUrl: string | undefined): boolean {
  const host = endpointHost(endpointUrl);
  if (!host) return false;
  if (gateway.allowedEndpointPatterns.length === 0) return true;
  return gateway.allowedEndpointPatterns.some((pattern) => wildcardMatch(pattern, host));
}

function endpointHost(endpointUrl: string | undefined): string | undefined {
  const raw = endpointUrl?.trim();
  if (!raw) return undefined;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const withoutProtocol = raw.replace(/^enip:\/\//i, "");
  const host = withoutProtocol.split("/")[0]?.split(":")[0]?.trim().toLowerCase();
  return host || undefined;
}

function wildcardMatch(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return false;
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
