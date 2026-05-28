// Single source of truth for AI agent model/provider configuration.
//
// Update the model string HERE (and nowhere else) when the provider publishes a
// new model id. Always copy the exact id from the official provider docs — do not
// guess or append date suffixes. See docs/ai-assistant.md.

/** The Anthropic Messages API model id used for the live online assistant. */
export const AGENT_MODEL_ID = "claude-opus-4-7";

/** Human-friendly label shown in the UI. Keep in sync with AGENT_MODEL_ID. */
export const AGENT_MODEL_LABEL = "Claude Opus 4.7";

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
