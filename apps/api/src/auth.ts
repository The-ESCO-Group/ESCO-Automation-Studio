import type { IncomingHttpHeaders } from "node:http";

export type ApiAuthMode = "local-dev" | "token-required";
export type ApiPermission =
  | "gateway:read"
  | "gateway:connect"
  | "project:read"
  | "project:write";

export interface ApiAuthUser {
  id: string;
  displayName: string;
}

export interface ApiAuthContext {
  mode: ApiAuthMode;
  authenticated: boolean;
  user?: ApiAuthUser;
  roles: string[];
  permissions: ApiPermission[];
  summary: string;
  nextStep: string;
}

export interface ApiAuthDecision {
  allowed: boolean;
  status: 200 | 401;
  context: ApiAuthContext;
  error?: string;
}

export interface ApiAuthPolicyOptions {
  token?: string;
}

const ALL_LOCAL_PERMISSIONS: ApiPermission[] = [
  "gateway:read",
  "gateway:connect",
  "project:read",
  "project:write",
];

export class ApiAuthPolicy {
  private readonly token: string | undefined;

  constructor(options: ApiAuthPolicyOptions = {}) {
    this.token = options.token?.trim() || undefined;
  }

  get mode(): ApiAuthMode {
    return this.token ? "token-required" : "local-dev";
  }

  context(headers: IncomingHttpHeaders = {}, tokenOverride?: string): ApiAuthContext {
    if (!this.token) {
      return {
        mode: "local-dev",
        authenticated: true,
        user: { id: "local-dev", displayName: "Local Developer" },
        roles: ["developer"],
        permissions: ALL_LOCAL_PERMISSIONS,
        summary: "Local development auth is active; gateway routes are open on this machine.",
        nextStep: "Set ESCO_API_AUTH_TOKEN before hosting this API outside local development.",
      };
    }
    if ((tokenOverride?.trim() || presentedToken(headers)) === this.token) {
      return {
        mode: "token-required",
        authenticated: true,
        user: { id: "token-user", displayName: "Authenticated ESCO User" },
        roles: ["engineer"],
        permissions: ALL_LOCAL_PERMISSIONS,
        summary: "Token authentication is active and this request is authenticated.",
        nextStep: "Replace the single shared token with organization users, roles, and project permissions before production hosting.",
      };
    }
    return {
      mode: "token-required",
      authenticated: false,
      roles: [],
      permissions: [],
      summary: "Token authentication is active and this request is not authenticated.",
      nextStep: "Send Authorization: Bearer <token> or x-esco-api-token to use protected gateway and project routes.",
    };
  }

  require(headers: IncomingHttpHeaders = {}, tokenOverride?: string): ApiAuthDecision {
    const context = this.context(headers, tokenOverride);
    if (context.authenticated) return { allowed: true, status: 200, context };
    return {
      allowed: false,
      status: 401,
      context,
      error: "ESCO API authentication is required.",
    };
  }
}

export function apiAuthPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): ApiAuthPolicy {
  return new ApiAuthPolicy({ token: env.ESCO_API_AUTH_TOKEN });
}

function presentedToken(headers: IncomingHttpHeaders): string | undefined {
  const authorization = firstHeader(headers.authorization);
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return firstHeader(headers["x-esco-api-token"])?.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
