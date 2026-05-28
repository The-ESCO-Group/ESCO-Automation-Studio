import type { AssistantInput, AssistantResult } from "./types";

/**
 * Which backend answers an assistant request:
 *  - `local`    — the shipping offline, rule-based planner (default);
 *  - `mock`     — a deterministic stand-in for tests / demos;
 *  - `external` — a future real LLM, behind the same seam (no key bundled).
 */
export type ProviderMode = "local" | "mock" | "external";

/**
 * An assistant backend. Every provider returns a previewable {@link AssistantResult}
 * and must NEVER mutate the project: any plan it proposes is applied later,
 * explicitly, through the controlled project-action layer (`applyPlan`). This is
 * the seam a real LLM would plug into without changing the rest of the app.
 */
export interface AssistantProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  run(input: AssistantInput): Promise<AssistantResult>;
}

/** The provider the UI uses unless explicitly changed. */
export const DEFAULT_PROVIDER_MODE: ProviderMode = "local";
