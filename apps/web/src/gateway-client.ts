/**
 * ESCO Gateway API client — the web side of the ESCO Online Session Manager.
 *
 * Goal B rule 6: React components never talk to drivers. They call this
 * client (or hooks built on it), which speaks JSON to the ESCO backend API
 * host (`apps/api`, routes under /api/gateway). The real EtherNet/IP driver
 * exists only in that backend process; this module is fetch + types only.
 *
 * NO WRITE METHOD EXISTS on this client — the read-only milestone exposes
 * none end to end (the API answers 405 on write routes). A future write path
 * arrives with confirmation, permission, audit, and read-back flows, not as
 * a convenience method here.
 */

import type {
  ApiAuthContext,
  BatchTagReadResult,
  CloudProjectDeleteResult,
  CloudProjectListResponse,
  CloudProjectRecord,
  CloudProjectSummary,
  CompareResult,
  ConnectionConfig,
  ConnectionResult,
  ControllerDriverSummary,
  ControllerIdentity,
  ControllerStatus,
  DownloadPreflightResult,
  FaultInfo,
  GatewayValidationReadinessReport,
  IdentityProofTagExport,
  OnlineAuditEntry,
  OnlineSnapshot,
  ProjectSnapshot,
  SiteGatewayPolicyReport,
  TagDefinition,
  TargetAdapterMetadata,
  TagValue,
} from "./gateway-contract";
import type { PlcProject } from "@esco/core";

export type GatewayDriverSummary = ControllerDriverSummary;

export interface GatewayStatusPayload {
  snapshot: OnlineSnapshot;
  status?: ControllerStatus;
}

export interface GatewayDisconnectResult {
  ok: boolean;
  state: OnlineSnapshot["state"];
}

export interface GatewayTagStreamHandle {
  close(): void;
}

type EventSourceConstructor = new (url: string) => EventSource;
export const GATEWAY_API_TOKEN_STORAGE_KEY = "esco.gateway.apiToken.v1";

/** Raised when the gateway API answers with an error or unusable payload. */
export class GatewayApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayApiError";
  }
}

export interface EscoGatewayClientOptions {
  /** Gateway API origin, e.g. "http://localhost:4000". */
  baseUrl?: string;
  /** Per-browser/client online session id. Defaults to sessionStorage. */
  sessionId?: string;
  /** Optional hosted API token. Defaults to browser storage key `esco.gateway.apiToken.v1`. */
  apiToken?: string;
  /** Injectable fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Injectable EventSource (tests); defaults to the browser global. */
  eventSourceImpl?: EventSourceConstructor;
}

/**
 * Resolves the API origin: `VITE_ESCO_API_URL` wins (set it per stacked dev
 * server the same way E2E_URL is), falling back to the apps/api default port.
 */
export function defaultGatewayBaseUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ESCO_API_URL?.trim() || "http://localhost:4000";
}

export function defaultGatewaySessionId(): string {
  const key = "esco.gateway.sessionId.v1";
  try {
    const existing = globalThis.sessionStorage?.getItem(key)?.trim();
    if (existing) return existing;
    const next = `web-${randomId()}`;
    globalThis.sessionStorage?.setItem(key, next);
    return next;
  } catch {
    return `web-${randomId()}`;
  }
}

export class EscoGatewayClient {
  private readonly baseUrl: string;
  private readonly sessionId: string;
  private readonly apiToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceImpl: EventSourceConstructor | undefined;

  constructor(options: EscoGatewayClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultGatewayBaseUrl()).replace(/\/+$/, "");
    this.sessionId = options.sessionId?.trim() || defaultGatewaySessionId();
    this.apiToken = options.apiToken?.trim() || undefined;
    // Bind the global fetch: calling an unbound `window.fetch` through a
    // class field sets `this` to the client and browsers throw
    // "Illegal invocation" (Node's undici does not — tests alone won't
    // catch a regression here).
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.eventSourceImpl = options.eventSourceImpl ?? globalThis.EventSource;
  }

  listDrivers(): Promise<GatewayDriverSummary[]> {
    return this.request("GET", "/api/gateway/drivers");
  }

  authContext(): Promise<ApiAuthContext> {
    return this.request("GET", "/api/auth/context");
  }

  validationReadiness(): Promise<GatewayValidationReadinessReport> {
    return this.request("GET", "/api/gateway/validation-readiness");
  }

  siteGatewayPolicy(): Promise<SiteGatewayPolicyReport> {
    return this.request("GET", "/api/gateway/site-gateways");
  }

  async listCloudProjects(): Promise<CloudProjectSummary[]> {
    const response = await this.request<CloudProjectListResponse>("GET", "/api/projects");
    return response.projects;
  }

  saveCloudProject(project: PlcProject, expectedRevision?: string): Promise<CloudProjectRecord> {
    return this.request("POST", "/api/projects", { project, expectedRevision });
  }

  openCloudProject(projectId: string): Promise<CloudProjectRecord> {
    return this.request("GET", `/api/projects/${encodeURIComponent(projectId)}`);
  }

  deleteCloudProject(projectId: string): Promise<CloudProjectDeleteResult> {
    return this.request("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
  }

  /** Metadata-only planned target packs; no physical download execution exists in the browser. */
  listTargetAdapters(): Promise<TargetAdapterMetadata[]> {
    return this.request("GET", "/api/gateway/target-adapters");
  }

  /** Read-only backend target safety preflight; blocked is the expected current state for physical PLC targets. */
  targetAdapterPreflight(targetAdapterId: string): Promise<DownloadPreflightResult> {
    return this.request("POST", "/api/gateway/download/preflight", { targetAdapterId });
  }

  session(): Promise<OnlineSnapshot> {
    return this.request("GET", "/api/gateway/session");
  }

  /**
   * Opens an online session. A failed connect (unreachable controller, bad
   * endpoint) is an EXPECTED result, not an exception: the API answers 502
   * with the driver's `ConnectionResult`, which is returned as-is so the UI
   * can show the reason. Only transport/shape problems throw.
   */
  async connect(
    driverId: string,
    config: ConnectionConfig = {},
    localProject?: PlcProject,
  ): Promise<ConnectionResult> {
    const response = await this.send("POST", "/api/gateway/session/connect", {
      driverId,
      config,
      localProject,
    });
    const body = await parseJson(response);
    if ((response.status === 200 || response.status === 502) && isConnectionResult(body)) {
      return body;
    }
    throw toApiError(response.status, body);
  }

  disconnect(): Promise<GatewayDisconnectResult> {
    return this.request("POST", "/api/gateway/session/disconnect");
  }

  identity(): Promise<ControllerIdentity> {
    return this.request("GET", "/api/gateway/identity");
  }

  projectIdentity(localProject: PlcProject): Promise<ControllerIdentity> {
    return this.request("POST", "/api/gateway/project-identity", { localProject });
  }

  projectIdentityProofTags(localProject: PlcProject): Promise<IdentityProofTagExport> {
    return this.request("POST", "/api/gateway/project-identity/proof-tags", { localProject });
  }

  status(): Promise<GatewayStatusPayload> {
    return this.request("GET", "/api/gateway/status");
  }

  compareProject(localProject: PlcProject): Promise<CompareResult> {
    return this.request("POST", "/api/gateway/compare", { localProject });
  }

  uploadSnapshot(): Promise<ProjectSnapshot> {
    return this.request("POST", "/api/gateway/snapshot/upload");
  }

  faults(): Promise<FaultInfo[]> {
    return this.request("GET", "/api/gateway/faults");
  }

  browseTags(): Promise<TagDefinition[]> {
    return this.request("GET", "/api/gateway/tags");
  }

  readTag(tagName: string): Promise<TagValue> {
    return this.request("GET", `/api/gateway/tags/read?name=${encodeURIComponent(tagName)}`);
  }

  /** Batched read-only poll for watch surfaces (per-tag errors in the result). */
  readTags(tagNames: string[]): Promise<BatchTagReadResult> {
    return this.request("POST", "/api/gateway/tags/read-batch", { names: tagNames });
  }

  /** Read-only tag stream using the gateway subscription seam when a driver supports it. */
  subscribeTags(
    tagNames: string[],
    onValue: (value: TagValue) => void,
    onError: (message: string) => void,
  ): GatewayTagStreamHandle {
    if (!this.eventSourceImpl) {
      throw new GatewayApiError(0, "EventSource is not available in this browser.");
    }
    const params = new URLSearchParams();
    params.set("session", this.sessionId);
    const apiToken = this.currentApiToken();
    if (apiToken) params.set("apiToken", apiToken);
    for (const tagName of tagNames) params.append("name", tagName);
    const source = new this.eventSourceImpl(`${this.baseUrl}/api/gateway/tags/subscribe?${params.toString()}`);
    let closed = false;
    const close = (): void => {
      closed = true;
      source.close();
    };
    source.addEventListener("tag", (event) => {
      if (closed) return;
      try {
        onValue(JSON.parse(String((event as MessageEvent).data)) as TagValue);
      } catch {
        onError("Gateway tag stream returned an invalid tag payload.");
      }
    });
    source.addEventListener("error-message", (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse(String((event as MessageEvent).data)) as { error?: unknown };
        onError(typeof payload.error === "string" ? payload.error : "Gateway tag stream failed.");
      } catch {
        onError("Gateway tag stream failed.");
      }
      close();
    });
    source.onerror = () => {
      if (!closed) onError("Gateway tag stream disconnected.");
    };
    return { close };
  }

  audit(): Promise<OnlineAuditEntry[]> {
    return this.request("GET", "/api/gateway/audit");
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    const payload = await parseJson(response);
    if (!response.ok) throw toApiError(response.status, payload);
    return payload as T;
  }

  private send(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
    const apiToken = this.currentApiToken();
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "x-esco-session-id": this.sessionId,
        ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private currentApiToken(): string | undefined {
    return this.apiToken ?? defaultGatewayApiToken();
  }
}

export function defaultGatewayApiToken(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(GATEWAY_API_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function storeGatewayApiToken(token: string | undefined): boolean {
  try {
    const value = token?.trim();
    if (value) globalThis.localStorage?.setItem(GATEWAY_API_TOKEN_STORAGE_KEY, value);
    else globalThis.localStorage?.removeItem(GATEWAY_API_TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GatewayApiError(response.status, "Gateway API returned a non-JSON response.");
  }
}

function toApiError(status: number, body: unknown): GatewayApiError {
  const message =
    typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Gateway API request failed with status ${status}.`;
  return new GatewayApiError(status, message);
}

function isConnectionResult(body: unknown): body is ConnectionResult {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { ok?: unknown }).ok === "boolean" &&
    typeof (body as { state?: unknown }).state === "string"
  );
}
