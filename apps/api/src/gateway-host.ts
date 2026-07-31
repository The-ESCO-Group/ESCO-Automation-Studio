/**
 * ESCO Controller Gateway host — the BACKEND composition point of Goal B.
 *
 * This module owns the one place where real drivers meet the gateway:
 *
 *   web UI → (HTTP, this host) → ControllerGateway → driver adapters → wire
 *
 * The browser bundle keeps placeholder drivers; the REAL EtherNet/IP driver
 * exists only here, behind the gateway. The UI never imports a driver —
 * Goal B rule 6 is enforced by this topology, not by convention.
 *
 * Framework-free by design: `GatewayHost.handle()` maps (method, url, body)
 * to JSON responses so it is fully testable without sockets; `index.ts` wires
 * it into `node:http`.
 *
 * NO WRITE ROUTE EXISTS. The read-only milestone exposes none — a future
 * write path needs confirmation, permission, audit, and read-back end to end
 * (gateway `controlledWrite` already gates this) plus its own API review.
 */

import {
  ControllerGateway,
  buildIdentityProofTagExport,
  createDefaultControllerDrivers,
  gatewayValidationReadinessReport,
  localProjectIdentity,
  TARGET_ADAPTER_REGISTRY,
  listPlcDownloadAdapters,
  listTargetAdapterMetadata,
  type DownloadPreflightRequest,
  type SubscriptionHandle,
  type TagSubscriptionCallback,
  type ConnectionConfig,
  type ControllerDriver,
  type OnlineSnapshot,
} from "@esco/controller-gateway";
import type { PlcProject } from "@esco/core";
import {
  ETHERNETIP_GATEWAY_DRIVER_ID,
  EthernetIpGatewayDriver,
} from "@esco/driver-ethernetip-node";
import {
  OPCUA_GATEWAY_DRIVER_ID,
  OpcUaGatewayDriver,
} from "@esco/driver-opcua-node";
import { SiteGatewayPolicy, siteGatewayPolicyFromEnv } from "./site-gateway-policy";

export interface GatewayHostResponse {
  status: number;
  body: unknown;
}

type GatewayFactory = () => ControllerGateway;
type Clock = () => number;

interface GatewaySessionRecord {
  gateway: ControllerGateway;
  lastUsedAt: number;
  activeSubscriptions: number;
}

interface GatewaySessionSnapshot extends OnlineSnapshot {
  /** Normalized ESCO online session id used by JSON and SSE gateway routes. */
  sessionId: string;
}

/**
 * The backend driver registry: the default (browser-safe) set with the
 * EtherNet/IP and OPC UA placeholders REPLACED by backend-only ESCO drivers.
 * The simulator stays for offline testing; OPC DA stays a generic placeholder
 * and no FactoryTalk, RSLinx, or other vendor runtime dependency ships.
 */
export function createBackendControllerDrivers(): ControllerDriver[] {
  return createDefaultControllerDrivers().map((driver) => {
    if (driver.id === ETHERNETIP_GATEWAY_DRIVER_ID) return new EthernetIpGatewayDriver();
    if (driver.id === OPCUA_GATEWAY_DRIVER_ID) return new OpcUaGatewayDriver();
    return driver;
  });
}

const PREFIX = "/api/gateway";
const DEFAULT_SESSION_ID = "default";

export class GatewayHost {
  private readonly gateways = new Map<string, GatewaySessionRecord>();
  private readonly createGateway: GatewayFactory;
  private readonly sharedGatewayMode: boolean;

  constructor(
    gatewayOrFactory: ControllerGateway | GatewayFactory = () => new ControllerGateway(createBackendControllerDrivers()),
    private readonly now: Clock = () => Date.now(),
    private readonly siteGatewayPolicy: SiteGatewayPolicy = siteGatewayPolicyFromEnv(),
  ) {
    if (typeof gatewayOrFactory === "function") {
      this.createGateway = gatewayOrFactory;
      this.sharedGatewayMode = false;
    } else {
      this.createGateway = () => gatewayOrFactory;
      this.sharedGatewayMode = true;
      this.gateways.set(DEFAULT_SESSION_ID, this.createSessionRecord(gatewayOrFactory));
    }
  }

  async subscribeTags(
    tagNames: readonly string[],
    callback: TagSubscriptionCallback,
    sessionId?: string,
  ): Promise<SubscriptionHandle> {
    const record = this.sessionFor(sessionId);
    record.activeSubscriptions += 1;
    let handle: SubscriptionHandle;
    try {
      handle = await record.gateway.watchTags([...tagNames], callback);
    } catch (cause) {
      record.activeSubscriptions = Math.max(0, record.activeSubscriptions - 1);
      record.lastUsedAt = this.now();
      throw cause;
    }
    let closed = false;
    return {
      id: handle.id,
      unsubscribe: async () => {
        if (closed) return;
        closed = true;
        try {
          await handle.unsubscribe();
        } finally {
          record.activeSubscriptions = Math.max(0, record.activeSubscriptions - 1);
          record.lastUsedAt = this.now();
        }
      },
    };
  }

  /**
   * Disconnects and removes inactive per-client gateway sessions. Active tag
   * subscriptions keep their session alive until the SSE/watch handle closes.
   */
  async closeIdleSessions(maxIdleMs: number, at = this.now()): Promise<number> {
    const idleLimitMs = Math.max(0, maxIdleMs);
    let closed = 0;
    for (const [id, record] of this.gateways) {
      if (record.activeSubscriptions > 0) continue;
      if (at - record.lastUsedAt < idleLimitMs) continue;
      await record.gateway.disconnect();
      this.gateways.delete(id);
      closed += 1;
    }
    return closed;
  }

  /**
   * Dispatches one request. Returns undefined when the path is not a gateway
   * route (the caller decides what else the server knows). Never throws —
   * operational failures become JSON error responses.
   */
  async handle(method: string, url: string, body: unknown, sessionId?: string): Promise<GatewayHostResponse | undefined> {
    const parsed = new URL(url, "http://gateway.local");
    const path = parsed.pathname;
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return undefined;
    const route = `${method.toUpperCase()} ${path.slice(PREFIX.length) || "/"}`;
    const resolvedSessionId = this.resolveSessionId(sessionId);
    const gateway = () => this.sessionForResolved(resolvedSessionId).gateway;

    try {
      switch (route) {
        case "GET /drivers":
          return ok(gateway().listDriverSummaries());
        case "GET /validation-readiness":
          return ok(gatewayValidationReadinessReport(gateway().listDriverSummaries()));
        case "GET /site-gateways":
          return ok(this.siteGatewayPolicy.report());
        case "GET /target-adapters":
          return ok(listTargetAdapterMetadata());
        case "GET /download-adapters":
          return ok(listPlcDownloadAdapters());
        case "POST /project-identity":
          return this.projectIdentity(body);
        case "POST /project-identity/proof-tags":
          return this.projectIdentityProofTags(body);
        case "GET /session":
          return ok(this.snapshotPayload(gateway(), resolvedSessionId));
        case "POST /session/connect":
          return this.connect(gateway(), body);
        case "POST /session/disconnect":
          await gateway().disconnect();
          return ok({ ok: true, state: gateway().snapshot().state });
        case "GET /identity":
          return ok(await gateway().getIdentity());
        case "GET /status":
          return ok(await this.statusPayload(gateway(), resolvedSessionId));
        case "POST /compare":
          return this.compareProject(gateway(), body);
        case "POST /snapshot/upload":
          return ok(await gateway().uploadSnapshot());
        case "GET /faults":
          return ok(await gateway().getFaults());
        case "GET /tags":
          return ok(await gateway().browseTags());
        case "GET /tags/read": {
          const name = parsed.searchParams.get("name")?.trim();
          if (!name) return error(400, 'Query parameter "name" is required.');
          return ok(await gateway().readTag(name));
        }
        case "POST /tags/read-batch":
          return this.readBatch(gateway(), body);
        case "GET /audit":
          return ok(gateway().auditLog);
        case "POST /download/preflight":
          return this.downloadPreflight(body);
        case "POST /write":
        case "POST /tags/write":
        case "POST /download":
          return error(
            405,
            route === "POST /download"
              ? "Physical PLC download is not exposed over the API. Future target adapters require compile, compare, backup, permission, audit, read-back, and lab/field validation gates."
              : "Controlled writes are not exposed over the API in the read-only milestone. " +
                "A future write path requires confirmation, permission, audit, and read-back review.",
          );
        default:
          return error(404, `Unknown gateway route: ${route}`);
      }
    } catch (cause) {
      // Gateway/driver operational errors (not online, unknown tag, link
      // loss) — surfaced, never swallowed, never a crash.
      return error(409, cause instanceof Error ? cause.message : String(cause));
    }
  }

  private async downloadPreflight(body: unknown): Promise<GatewayHostResponse> {
    if (typeof body !== "object" || body === null) {
      return error(400, 'Download preflight requires a JSON body with "targetAdapterId".');
    }
    const targetAdapterId = (body as { targetAdapterId?: unknown; adapterId?: unknown }).targetAdapterId ??
      (body as { adapterId?: unknown }).adapterId;
    if (typeof targetAdapterId !== "string" || !targetAdapterId.trim()) {
      return error(400, 'Download preflight requires a string "targetAdapterId".');
    }
    const request: DownloadPreflightRequest = {
      ...(body as Omit<DownloadPreflightRequest, "targetAdapterId">),
      targetAdapterId: targetAdapterId.trim(),
    };
    return ok(await TARGET_ADAPTER_REGISTRY.preflightDownload(request));
  }

  private projectIdentity(body: unknown): GatewayHostResponse {
    const localProject = parseLocalProject(body, "Project identity");
    if (localProject instanceof Error) return error(400, localProject.message);
    return ok(localProjectIdentity(localProject as PlcProject));
  }

  private projectIdentityProofTags(body: unknown): GatewayHostResponse {
    const localProject = parseLocalProject(body, "Project identity proof tag export");
    if (localProject instanceof Error) return error(400, localProject.message);
    return ok(buildIdentityProofTagExport(localProject as PlcProject));
  }

  private sessionFor(sessionId: string | undefined): GatewaySessionRecord {
    return this.sessionForResolved(this.resolveSessionId(sessionId));
  }

  private resolveSessionId(sessionId: string | undefined): string {
    return this.sharedGatewayMode ? DEFAULT_SESSION_ID : normalizeGatewaySessionId(sessionId);
  }

  private sessionForResolved(id: string): GatewaySessionRecord {
    let record = this.gateways.get(id);
    if (!record) {
      record = this.createSessionRecord(this.createGateway());
      this.gateways.set(id, record);
    }
    record.lastUsedAt = this.now();
    return record;
  }

  private createSessionRecord(gateway: ControllerGateway): GatewaySessionRecord {
    return {
      gateway,
      lastUsedAt: this.now(),
      activeSubscriptions: 0,
    };
  }

  private snapshotPayload(gateway: ControllerGateway, sessionId: string): GatewaySessionSnapshot {
    return {
      ...gateway.snapshot(),
      sessionId,
    };
  }

  private async connect(gateway: ControllerGateway, body: unknown): Promise<GatewayHostResponse> {
    if (typeof body !== "object" || body === null) {
      return error(400, "Connect requires a JSON body with a driverId.");
    }
    const request = body as {
      driverId?: unknown;
      config?: unknown;
      localProject?: unknown;
    };
    if (typeof request.driverId !== "string" || !request.driverId.trim()) {
      return error(400, 'Connect requires a string "driverId".');
    }
    const config = (
      typeof request.config === "object" && request.config !== null ? request.config : {}
    ) as ConnectionConfig;
    const driver = gateway.listDriverSummaries().find((summary) => summary.id === request.driverId);
    const siteGatewayDecision = this.siteGatewayPolicy.evaluateConnection(driver, config);
    if (!siteGatewayDecision.allowed) {
      return {
        status: 502,
        body: {
          ok: false,
          state: "disconnected",
          message: siteGatewayDecision.message,
          connectionEvidence: driver?.connectionEvidence,
        },
      };
    }
    const result = await gateway.connect(
      request.driverId,
      config,
      // The local project (when the UI sends one) feeds the identity-match
      // check; without it the gateway defaults to Online Read-Only.
      request.localProject as PlcProject | undefined,
    );
    return { status: result.ok ? 200 : 502, body: result };
  }

  /** Batched read-only polling: `{ names: string[] }` (read-only; max 200). */
  private async readBatch(gateway: ControllerGateway, body: unknown): Promise<GatewayHostResponse> {
    if (typeof body !== "object" || body === null) {
      return error(400, 'Batch read requires a JSON body with a "names" array.');
    }
    const names = (body as { names?: unknown }).names;
    if (
      !Array.isArray(names) ||
      names.length === 0 ||
      names.some((name) => typeof name !== "string" || !name.trim())
    ) {
      return error(400, '"names" must be a non-empty array of tag names.');
    }
    if (names.length > 200) {
      return error(400, `Batch read supports at most 200 tags per request, got ${names.length}.`);
    }
    return ok(await gateway.readTags(names as string[]));
  }

  /** Explicit B5 local-vs-online identity compare; read-only. */
  private async compareProject(gateway: ControllerGateway, body: unknown): Promise<GatewayHostResponse> {
    if (typeof body !== "object" || body === null) {
      return error(400, 'Compare requires a JSON body with a "localProject".');
    }
    const localProject = (body as { localProject?: unknown }).localProject;
    if (typeof localProject !== "object" || localProject === null) {
      return error(400, 'Compare requires a "localProject" object.');
    }
    return ok(await gateway.compareProject(localProject as PlcProject));
  }

  private async statusPayload(gateway: ControllerGateway, sessionId: string): Promise<unknown> {
    const snapshot = gateway.snapshot();
    if (!snapshot.state.startsWith("online-")) {
      return { snapshot: this.snapshotPayload(gateway, sessionId), status: undefined };
    }
    const status = await gateway.getStatus();
    return { snapshot: this.snapshotPayload(gateway, sessionId), status };
  }
}

export function normalizeGatewaySessionId(sessionId: string | undefined): string {
  const trimmed = sessionId?.trim();
  if (!trimmed) return DEFAULT_SESSION_ID;
  const safe = trimmed.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
  return safe || DEFAULT_SESSION_ID;
}

function parseLocalProject(body: unknown, label: string): PlcProject | Error {
  if (typeof body !== "object" || body === null) {
    return new Error(`${label} requires a JSON body with a "localProject".`);
  }
  const localProject = (body as { localProject?: unknown }).localProject;
  if (typeof localProject !== "object" || localProject === null) {
    return new Error(`${label} requires a "localProject" object.`);
  }
  return localProject as PlcProject;
}

function ok(body: unknown): GatewayHostResponse {
  return { status: 200, body };
}

function error(status: number, message: string): GatewayHostResponse {
  return { status, body: { error: message } };
}
