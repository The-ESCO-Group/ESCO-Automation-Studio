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
  AGENT_DEFAULT_MODELS,
  AGENT_DEFAULT_PROVIDER,
  AGENT_PROXY_PATH,
  ANTHROPIC_API_VERSION,
  type AgentModelProvider,
  type AgentProviderMode,
  type ModelCaller,
  type AgentContentBlock,
  type AgentToolDef,
  type ModelReply,
  type ModelRequest,
} from "@esco/ai-assistant";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface ModelCallerOptions {
  mode: AgentProviderMode;
  provider?: AgentModelProvider;
  modelId?: string;
  /** Required for "browser-key" mode; ignored for "proxy" mode. */
  apiKey?: string;
  timeoutMs?: number;
}

function buildAnthropicBody(request: ModelRequest, modelId: string) {
  return {
    model: modelId,
    max_tokens: request.max_tokens,
    // cache_control on the system block caches tools+system across the loop's turns.
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    tools: request.tools,
    messages: request.messages,
  };
}

function openAiTools(tools: AgentToolDef[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function openAiMessages(request: ModelRequest) {
  const messages: Record<string, unknown>[] = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
      const toolCalls = message.content
        .filter((block) => block.type === "tool_use" && block.id && block.name)
        .map((block) => ({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        }));
      messages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    for (const block of message.content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.content ?? "",
        });
      } else if (block.type === "text" && block.text) {
        messages.push({ role: "user", content: block.text });
      }
    }
  }
  return messages;
}

function buildOpenAiBody(request: ModelRequest, modelId: string) {
  return {
    model: modelId,
    max_tokens: request.max_tokens,
    messages: openAiMessages(request),
    tools: openAiTools(request.tools),
  };
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function openAiReplyToModelReply(data: {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
}): ModelReply {
  const message = data.choices?.[0]?.message;
  const content: AgentContentBlock[] = [];
  if (message?.content) content.push({ type: "text", text: message.content });
  for (const call of message?.tool_calls ?? []) {
    if (!call.id || !call.function?.name) continue;
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: parseJsonObject(call.function.arguments),
    });
  }
  return { content, stop_reason: (message?.tool_calls?.length ?? 0) > 0 ? "tool_use" : "end_turn" };
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
  const provider = options.provider ?? AGENT_DEFAULT_PROVIDER;
  const modelId = options.modelId?.trim() || AGENT_DEFAULT_MODELS[provider];
  if (options.mode === "browser-key" && !options.apiKey?.trim()) {
    throw new Error("Open Settings to add your AI provider API key.");
  }

  return async (request: ModelRequest): Promise<ModelReply> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const url = options.mode === "proxy"
        ? AGENT_PROXY_PATH
        : provider === "openai"
          ? OPENAI_URL
          : ANTHROPIC_URL;
      if (options.mode === "browser-key") {
        if (provider === "openai") {
          headers.authorization = `Bearer ${options.apiKey!.trim()}`;
        } else {
          headers["x-api-key"] = options.apiKey!.trim();
          headers["anthropic-version"] = ANTHROPIC_API_VERSION;
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        }
      }
      const body = provider === "openai"
        ? buildOpenAiBody({ ...request, model: modelId }, modelId)
        : buildAnthropicBody({ ...request, model: modelId }, modelId);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
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

      const data = await response.json();
      if (provider === "openai") return openAiReplyToModelReply(data);
      const anthropic = data as { content?: ModelReply["content"]; stop_reason?: string };
      return { content: anthropic.content ?? [], stop_reason: anthropic.stop_reason ?? "end_turn" };
    } finally {
      clearTimeout(timer);
    }
  };
}
