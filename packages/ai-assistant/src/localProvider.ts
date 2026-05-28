import { runAssistant } from "./planner";
import type { AssistantProvider } from "./provider";
import type { AssistantInput, AssistantResult } from "./types";

/**
 * The shipping assistant: deterministic, fully offline, rule-based. It wraps the
 * existing {@link runAssistant} planner behind the async provider interface, so
 * the UI can target the provider seam while behaviour is unchanged.
 */
export class LocalRuleBasedProvider implements AssistantProvider {
  readonly name = "Local (rule-based)";
  readonly mode = "local" as const;

  run(input: AssistantInput): Promise<AssistantResult> {
    return Promise.resolve(runAssistant(input));
  }
}
