import type { AssistantProvider } from "./provider";
import type { AssistantResult } from "./types";
import {
  runAgent,
  type AgentRunResult,
  type ModelCaller,
} from "./agentLoop";

export interface ExternalLlmProviderOptions {
  /** Injectable model transport. The provider never owns keys or network setup. */
  caller?: ModelCaller;
  /** Optional display name for UI/tests. */
  name?: string;
  /** Model id passed through to the agent loop when configured. */
  modelId?: string;
  /** Test/dev guard override; defaults to the shared agent-loop cap. */
  maxIterations?: number;
}

function messageFromAgent(result: AgentRunResult): string {
  if (result.error) return result.error;
  return result.plan.explanation || "External LLM completed without proposing project changes.";
}

/**
 * Real LLM provider seam. It intentionally owns no API key and performs no
 * network calls by itself; callers inject a ModelCaller (browser fetch,
 * server-side proxy, desktop bridge, or test double). All model writes still go
 * through the agent loop as previewed project-actions for explicit user Apply.
 */
export class ExternalLlmProvider implements AssistantProvider {
  readonly mode = "external" as const;
  readonly name: string;
  private readonly caller?: ModelCaller;
  private readonly modelId?: string;
  private readonly maxIterations?: number;

  constructor(options: ExternalLlmProviderOptions | string = {}) {
    const normalized = typeof options === "string" ? { name: options } : options;
    this.name = normalized.name ?? (normalized.caller ? "External LLM" : "External LLM (not configured)");
    this.caller = normalized.caller;
    this.modelId = normalized.modelId;
    this.maxIterations = normalized.maxIterations;
  }

  async run(input: Parameters<AssistantProvider["run"]>[0]): Promise<AssistantResult> {
    if (!this.caller) {
      throw new Error(
        "External LLM provider is not configured. No API key is bundled; inject a ModelCaller to enable it.",
      );
    }

    const result = await runAgent({
      caller: this.caller,
      project: input.project,
      prompt: input.prompt,
      selection: input.selection,
      modelId: this.modelId,
      maxIterations: this.maxIterations,
    });

    const hasPlanContent = result.plan.actions.length > 0 || result.plan.warnings.length > 0;
    return {
      ok: result.ok,
      message: messageFromAgent(result),
      ...(hasPlanContent ? { plan: result.plan } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }
}
