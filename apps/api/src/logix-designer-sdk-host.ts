import {
  buildLogixDesignerSdkHandoffPlan,
  probeLogixDesignerSdk,
  type LogixDesignerSdkHandoffRequest,
} from "@esco/logix-designer-sdk";

export interface LogixDesignerSdkHostResponse {
  status: number;
  body: unknown;
}

const PREFIX = "/api/logix-designer-sdk";

export class LogixDesignerSdkHost {
  async handle(method: string, url: string, body: unknown): Promise<LogixDesignerSdkHostResponse | undefined> {
    const parsed = new URL(url, "http://api.local");
    const path = parsed.pathname;
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return undefined;
    const route = `${method.toUpperCase()} ${path.slice(PREFIX.length) || "/"}`;

    switch (route) {
      case "GET /status":
        return ok(await probeLogixDesignerSdk());
      case "POST /handoff/preflight":
        return this.handoffPreflight(body);
      case "POST /download":
      case "POST /go-online":
      case "POST /controller-mode":
        return error(
          405,
          "Logix Designer SDK controller-transfer routes are intentionally not exposed. Use Studio 5000 or approved Rockwell tooling for physical upload/download, go-online, online edit, and controller mode changes.",
        );
      default:
        return error(404, `Unknown Logix Designer SDK route: ${route}`);
    }
  }

  private handoffPreflight(body: unknown): LogixDesignerSdkHostResponse {
    if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body))) {
      return error(400, "Logix Designer SDK handoff preflight requires a JSON object body.");
    }
    return ok(buildLogixDesignerSdkHandoffPlan((body ?? {}) as LogixDesignerSdkHandoffRequest));
  }
}

function ok(body: unknown): LogixDesignerSdkHostResponse {
  return { status: 200, body };
}

function error(status: number, message: string): LogixDesignerSdkHostResponse {
  return { status, body: { error: message } };
}
