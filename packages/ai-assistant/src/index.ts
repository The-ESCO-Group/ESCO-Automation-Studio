export * from "./types";
export * from "./context";
export * from "./explain";
export * from "./templates";
export * from "./planner";
export * from "./apply";
export * from "./provider";
export * from "./localProvider";
export * from "./mockProvider";
export * from "./externalProvider";
export * from "./agentConfig";
export * from "./agentTools";
export * from "./agentContext";
export * from "./agentLoop";
export * from "./handoff";

import { DEFAULT_PROVIDER_MODE, type AssistantProvider, type ProviderMode } from "./provider";
import { LocalRuleBasedProvider } from "./localProvider";
import { MockProvider } from "./mockProvider";
import { ExternalLlmProvider } from "./externalProvider";

/** Construct an assistant provider for the given mode (defaults to local). */
export function createProvider(mode: ProviderMode = DEFAULT_PROVIDER_MODE): AssistantProvider {
  switch (mode) {
    case "mock":
      return new MockProvider();
    case "external":
      return new ExternalLlmProvider();
    case "local":
    default:
      return new LocalRuleBasedProvider();
  }
}

/** The provider the UI uses by default (offline, rule-based). */
export function getDefaultProvider(): AssistantProvider {
  return createProvider(DEFAULT_PROVIDER_MODE);
}
