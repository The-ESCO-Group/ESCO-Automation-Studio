import type { AssistantProvider } from "./provider";
import type { AssistantInput, AssistantPlan, AssistantResult } from "./types";

/**
 * A deterministic stand-in for a real LLM, used by tests and demos. It returns a
 * previewable plan (here: create a BOOL tag) to prove the seam carries proposed
 * actions that still require an explicit Apply through the project-action layer.
 * A custom `responder` can be supplied to simulate other LLM outputs.
 */
export class MockProvider implements AssistantProvider {
  readonly name = "Mock LLM";
  readonly mode = "mock" as const;

  constructor(private readonly responder?: (input: AssistantInput) => AssistantResult) {}

  run(input: AssistantInput): Promise<AssistantResult> {
    if (this.responder) return Promise.resolve(this.responder(input));

    const plan: AssistantPlan = {
      id: "mock-plan",
      title: "Mock suggestion",
      explanation: `Mock LLM response for: "${input.prompt}"`,
      actions: [
        {
          id: "mock-create-tag",
          kind: "createTag",
          label: "Create tag MockTag",
          description: "Add a BOOL tag named MockTag (deterministic mock output).",
          input: { name: "MockTag", dataType: "BOOL" },
        },
      ],
      warnings: [],
    };
    return Promise.resolve({ ok: true, message: plan.explanation, plan });
  }
}
