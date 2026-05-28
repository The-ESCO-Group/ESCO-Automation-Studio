import type { AssistantProvider } from "./provider";
import type { AssistantResult } from "./types";

/**
 * Placeholder for a future real LLM. It is intentionally NOT wired to any
 * network or API key — using it rejects with a clear "not configured" error so
 * the app can fall back to the local provider. A real implementation would call
 * its model here and translate the response into an {@link AssistantResult}
 * (message + optional plan), still applied only via the project-action layer.
 */
export class ExternalLlmProvider implements AssistantProvider {
  readonly mode = "external" as const;

  constructor(readonly name = "External LLM (not configured)") {}

  run(): Promise<AssistantResult> {
    return Promise.reject(
      new Error(
        "External LLM provider is not configured. No API key is bundled; wire up a provider to enable it.",
      ),
    );
  }
}
