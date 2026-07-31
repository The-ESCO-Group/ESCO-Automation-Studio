/**
 * HTTP wiring for the ESCO API host: JSON body handling, CORS for the local
 * dev servers, /health, and the ESCO Controller Gateway routes. Exported
 * without `listen()` so integration tests can run the real server on an
 * ephemeral port.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PlcProject } from "@esco/core";
import { GatewayHost, normalizeGatewaySessionId } from "./gateway-host";
import { ApiAuthPolicy, apiAuthPolicyFromEnv } from "./auth";
import {
  CloudProjectConflictError,
  CloudProjectNotFoundError,
  cloudProjectStoreFromEnv,
  type CloudProjectStore,
} from "./cloud-project-store";
import { LogixDesignerSdkHost } from "./logix-designer-sdk-host";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // local project JSON can be sizable
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface ApiServerOptions {
  /** How long an inactive ESCO online session may sit around before cleanup. */
  sessionIdleMs?: number;
  /** How often the backend checks for inactive sessions. Set to 0 to disable. */
  sessionCleanupIntervalMs?: number;
  /** Optional hosted auth policy. Defaults to ESCO_API_AUTH_TOKEN when set. */
  authPolicy?: ApiAuthPolicy;
  /** Optional hosted project store. Defaults to ESCO_PROJECT_STORE_DIR or .esco-cloud-projects. */
  projectStore?: CloudProjectStore;
  /** Optional Logix Designer SDK host. Defaults to the guarded local probe/preflight host. */
  logixDesignerSdkHost?: LogixDesignerSdkHost;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    // Local engineering tool: the Vite dev servers (5173+) and the desktop
    // shell call this API cross-origin on the same machine.
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-esco-api-token, x-esco-session-id",
  });
  res.end(JSON.stringify(body));
}

function writeSse(res: ServerResponse, event: string, body: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function parseSubscribeNames(url: string): { names: string[]; error?: string } {
  const parsed = new URL(url, "http://api.local");
  const names = parsed.searchParams
    .getAll("name")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length > 200) {
    return { names: [], error: `Tag subscriptions support at most 200 tags per request, got ${names.length}.` };
  }
  return { names };
}

function requestSessionId(req: IncomingMessage, url: string): string | undefined {
  const parsed = new URL(url, "http://api.local");
  const querySession = parsed.searchParams.get("session")?.trim();
  if (querySession) return normalizeGatewaySessionId(querySession);
  const header = req.headers["x-esco-session-id"];
  if (Array.isArray(header)) return normalizeGatewaySessionId(header[0]);
  return normalizeGatewaySessionId(header);
}

function isProjectRoute(pathname: string): boolean {
  return pathname === "/api/projects" || pathname.startsWith("/api/projects/");
}

function projectIdFromPath(pathname: string): string | undefined {
  const prefix = "/api/projects/";
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return undefined;
  return decodeURIComponent(encoded);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function handleTagSubscribe(host: GatewayHost, req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  const { names, error } = parseSubscribeNames(url);
  const sessionId = requestSessionId(req, url);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-esco-api-token, x-esco-session-id",
  });
  if (error) {
    writeSse(res, "error-message", { error });
    res.end();
    return;
  }
  if (names.length === 0) {
    writeSse(res, "error-message", { error: 'At least one "name" query parameter is required.' });
    res.end();
    return;
  }

  let closed = false;
  let handle: Awaited<ReturnType<GatewayHost["subscribeTags"]>> | undefined;
  req.on("close", () => {
    closed = true;
    void handle?.unsubscribe();
  });

  try {
    handle = await host.subscribeTags(names, (value) => {
      if (!closed) writeSse(res, "tag", value);
    }, sessionId);
    if (closed) {
      await handle.unsubscribe();
      return;
    }
    if (!closed) writeSse(res, "ready", { names });
  } catch (cause) {
    if (!closed) {
      writeSse(res, "error-message", { error: cause instanceof Error ? cause.message : String(cause) });
      res.end();
    }
  }
}

export function createApiServer(host: GatewayHost = new GatewayHost(), options: ApiServerOptions = {}): Server {
  const authPolicy = options.authPolicy ?? apiAuthPolicyFromEnv();
  const projectStore = options.projectStore ?? cloudProjectStoreFromEnv();
  const logixDesignerSdkHost = options.logixDesignerSdkHost ?? new LogixDesignerSdkHost();
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const parsedUrl = new URL(url, "http://api.local");

    if (method === "OPTIONS") {
      send(res, 204, {});
      return;
    }

    if (url === "/health") {
      send(res, 200, { status: "ok", service: "esco-automation-studio-api" });
      return;
    }

    if (method === "GET" && parsedUrl.pathname === "/api/auth/context") {
      send(res, 200, authPolicy.context(req.headers, parsedUrl.searchParams.get("apiToken") ?? undefined));
      return;
    }

    if (
      parsedUrl.pathname.startsWith("/api/gateway/") ||
      parsedUrl.pathname.startsWith("/api/logix-designer-sdk/") ||
      isProjectRoute(parsedUrl.pathname)
    ) {
      const auth = authPolicy.require(req.headers, parsedUrl.searchParams.get("apiToken") ?? undefined);
      if (!auth.allowed) {
        send(res, auth.status, { error: auth.error, auth: auth.context });
        return;
      }
    }

    if (isProjectRoute(parsedUrl.pathname)) {
      try {
        if (method === "GET" && parsedUrl.pathname === "/api/projects") {
          send(res, 200, { projects: await projectStore.list() });
          return;
        }

        if (method === "POST" && parsedUrl.pathname === "/api/projects") {
          const body = await readBody(req);
          if (!isRecord(body) || !isRecord(body.project)) {
            send(res, 400, { error: "Project save requires a JSON body with a project object." });
            return;
          }
          const expectedRevision =
            typeof body.expectedRevision === "string" ? body.expectedRevision : undefined;
          send(res, 200, await projectStore.save(body.project as unknown as PlcProject, { expectedRevision }));
          return;
        }

        const projectId = projectIdFromPath(parsedUrl.pathname);
        if (projectId && method === "GET") {
          send(res, 200, await projectStore.read(projectId));
          return;
        }
        if (projectId && method === "DELETE") {
          const deleted = await projectStore.delete(projectId);
          send(
            res,
            deleted ? 200 : 404,
            deleted ? { ok: true } : { error: `Cloud project "${projectId}" was not found.` },
          );
          return;
        }
      } catch (cause) {
        if (cause instanceof CloudProjectConflictError) {
          send(res, 409, {
            error: cause.message,
            projectId: cause.projectId,
            expectedRevision: cause.expectedRevision,
            actualRevision: cause.actualRevision,
          });
          return;
        }
        if (cause instanceof CloudProjectNotFoundError) {
          send(res, 404, { error: cause.message, projectId: cause.projectId });
          return;
        }
        send(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
        return;
      }
    }

    if (parsedUrl.pathname.startsWith("/api/logix-designer-sdk/")) {
      try {
        const body = method === "POST" ? await readBody(req) : undefined;
        const handled = await logixDesignerSdkHost.handle(method, url, body);
        if (handled) {
          send(res, handled.status, handled.body);
          return;
        }
      } catch (cause) {
        send(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
        return;
      }
    }

    if (method === "GET" && parsedUrl.pathname === "/api/gateway/tags/subscribe") {
      await handleTagSubscribe(host, req, res, url);
      return;
    }

    try {
      const body = method === "POST" ? await readBody(req) : undefined;
      const handled = await host.handle(method, url, body, requestSessionId(req, url));
      if (handled) {
        send(res, handled.status, handled.body);
        return;
      }
    } catch (cause) {
      send(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
      return;
    }

    send(res, 404, { error: "not found" });
  });

  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
  const cleanupIntervalMs = options.sessionCleanupIntervalMs ?? DEFAULT_SESSION_CLEANUP_INTERVAL_MS;
  if (sessionIdleMs >= 0 && cleanupIntervalMs > 0) {
    const cleanupTimer = setInterval(() => {
      void host.closeIdleSessions(sessionIdleMs).catch((cause) => {
        console.warn(
          "[esco-api] idle session cleanup failed:",
          cause instanceof Error ? cause.message : String(cause),
        );
      });
    }, cleanupIntervalMs);
    cleanupTimer.unref?.();
    server.on("close", () => clearInterval(cleanupTimer));
  }

  return server;
}
