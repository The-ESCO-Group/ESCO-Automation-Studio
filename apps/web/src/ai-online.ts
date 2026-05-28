// Browser transport for the live online agent. This is the ONLY module in the
// web app that performs an external network call, and only when the user has
// explicitly enabled online mode. Two modes:
//   - "browser-key": dev/local testing only. The browser calls the provider
//     directly with a user-pasted key (never written to disk; session-only).
//   - "proxy": production pattern. The browser posts to a same-origin route; a
//     server/dev middleware injects ANTHROPIC_API_KEY from the environment, so
//     the browser never sees the key.
// The model id and provider config come from @esco/ai-assistant (one place).

import {
  AGENT_PROXY_PATH,
  ANTHROPIC_API_VERSION,
  type AgentProviderMode,
  type ModelCaller,
  type ModelReply,
  type ModelRequest,
} from "@esco/ai-assistant";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface ModelCallerOptions {
  mode: AgentProviderMode;
  /** Required for "browser-key" mode; ignored for "proxy" mode. */
  apiKey?: string;
  timeoutMs?: number;
}

function buildBody(request: ModelRequest) {
  return {
    model: request.model,
    max_tokens: request.max_tokens,
    // cache_control on the system block caches tools+system across the loop's turns.
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    tools: request.tools,
    messages: request.messages,
  };
}

async function parseError(response: Response): Promise<string> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: string; type?: string } };
    if (body.error?.message) detail = body.error.message;
  } catch {
    /* keep status-only detail */
  }
  switch (response.status) {
    case 401:
      return "Invalid or missing API key (401). Check your key and try again.";
    case 403:
      return "The API key does not have access to this model (403).";
    case 404:
      return `Model not found (404). The configured model may be wrong: ${detail}`;
    case 429:
      return "Rate limited (429). Wait a moment and try again.";
    case 500:
    case 529:
      return "The AI provider is temporarily unavailable. Try again shortly.";
    default:
      return detail;
  }
}

/**
 * Create the injectable ModelCaller for the agent loop. Throws synchronously for
 * a missing key in browser-key mode so the UI can show a clear message before
 * any prompt/project context leaves the browser.
 */
export function createModelCaller(options: ModelCallerOptions): ModelCaller {
  if (options.mode === "browser-key" && !options.apiKey?.trim()) {
    throw new Error("Open Settings to add your Opus 4.7 API key.");
  }

  return async (request: ModelRequest): Promise<ModelReply> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const url = options.mode === "proxy" ? AGENT_PROXY_PATH : ANTHROPIC_URL;
      if (options.mode === "browser-key") {
        headers["x-api-key"] = options.apiKey!.trim();
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(buildBody(request)),
          signal: controller.signal,
        });
      } catch (networkError) {
        if (networkError instanceof DOMException && networkError.name === "AbortError") {
          throw new Error("The AI provider timed out. Try again or simplify the request.");
        }
        throw new Error(
          options.mode === "proxy"
            ? "Could not reach the AI proxy. Is the server/proxy running with ANTHROPIC_API_KEY set?"
            : "Network error reaching the AI provider.",
        );
      }

      if (!response.ok) throw new Error(await parseError(response));

      const data = (await response.json()) as { content?: ModelReply["content"]; stop_reason?: string };
      return { content: data.content ?? [], stop_reason: data.stop_reason ?? "end_turn" };
    } finally {
      clearTimeout(timer);
    }
  };
}
