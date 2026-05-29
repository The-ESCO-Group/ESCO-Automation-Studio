// Single source of truth for AI agent model/provider configuration.
//
// Update the model string HERE (and nowhere else) when the provider publishes a
// new model id. Always copy the exact id from the official provider docs — do not
// guess or append date suffixes. See docs/ai-assistant.md.

/** AI model providers supported by the live online assistant transport. */
export type AgentModelProvider = "anthropic" | "openai";

export const AGENT_PROVIDER_LABELS: Record<AgentModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

/** Default model ids used only when a saved workstation profile has no model yet. */
export const AGENT_DEFAULT_MODELS: Record<AgentModelProvider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-4.1",
};

export const AGENT_DEFAULT_PROVIDER: AgentModelProvider = "anthropic";

/** Back-compat default for older call sites/tests that do not pass a saved model. */
export const AGENT_MODEL_ID = AGENT_DEFAULT_MODELS[AGENT_DEFAULT_PROVIDER];

export function agentModelLabel(provider: AgentModelProvider, modelId: string): string {
  return `${AGENT_PROVIDER_LABELS[provider]}: ${modelId}`;
}

/** Anthropic API version header value for direct/proxied Messages API calls. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/** How the browser reaches the model. */
export type AgentProviderMode =
  | "browser-key" // dev/local only: browser calls the provider with a user-pasted key
  | "proxy"; // production: same-origin proxy injects an env key server-side

export const AGENT_DEFAULT_PROVIDER_MODE: AgentProviderMode = "browser-key";

/** Same-origin route the proxy mode posts to (handled by a dev/server middleware). */
export const AGENT_PROXY_PATH = "/api/ai";

/** Hard cap on agentic tool-use rounds, so a run always terminates. */
export const AGENT_MAX_ITERATIONS = 16;

/** Max tokens per model response. */
export const AGENT_MAX_TOKENS = 4096;

/** Context-size guard: above this many rungs, the context builder summarizes. */
export const LARGE_PROJECT_RUNG_THRESHOLD = 200;
