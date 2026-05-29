import { createSettingsStore, type SettingsStore } from "./settings";
import {
  AGENT_DEFAULT_MODELS,
  AGENT_DEFAULT_PROVIDER,
  AGENT_PROVIDER_LABELS,
  agentModelLabel,
  type AgentModelProvider,
} from "@esco/ai-assistant";

const PROFILE_KEY = "ai.profile.v1";

export type AiProvider = AgentModelProvider;

export interface AiProfile {
  displayName: string;
  email: string;
  provider: AiProvider;
  modelId: string;
  apiKey: string;
  savedAt: string;
}

const sharedStore = createSettingsStore();

function cleanProvider(value: unknown, apiKey: string): AiProvider {
  if (value === "openai" || value === "anthropic") return value;
  return apiKey.trim().startsWith("sk-ant-") ? "anthropic" : AGENT_DEFAULT_PROVIDER;
}

function cleanProfile(value: Partial<AiProfile>): AiProfile | null {
  const displayName = value.displayName?.trim() ?? "";
  const apiKey = value.apiKey?.trim() ?? "";
  if (!displayName || !apiKey) return null;
  const provider = cleanProvider(value.provider, apiKey);
  const modelId = value.modelId?.trim() || AGENT_DEFAULT_MODELS[provider];
  return {
    displayName,
    email: value.email?.trim() ?? "",
    provider,
    modelId,
    apiKey,
    savedAt: value.savedAt ?? new Date().toISOString(),
  };
}

/**
 * Load the saved workstation AI profile, or null if setup hasn't happened. Once a
 * valid profile is saved we never need to ask for the API key again — this read
 * is what makes "ask once" work across sessions.
 */
export function loadAiProfile(store: SettingsStore = sharedStore): AiProfile | null {
  const raw = store.get<Partial<AiProfile> | null>(PROFILE_KEY, null);
  return raw ? cleanProfile(raw) : null;
}

export function saveAiProfile(
  value: Partial<AiProfile>,
  store: SettingsStore = sharedStore,
): AiProfile | null {
  const profile = cleanProfile({ ...value, savedAt: new Date().toISOString() });
  if (!profile) return null;
  store.set(PROFILE_KEY, profile);
  return profile;
}

/** True once a valid profile (incl. API key) has been saved on this workstation. */
export function hasAiProfile(store: SettingsStore = sharedStore): boolean {
  return loadAiProfile(store) !== null;
}

/** Remove the saved profile (e.g. "sign out" / rotate key). */
export function clearAiProfile(store: SettingsStore = sharedStore): void {
  store.remove(PROFILE_KEY);
}

export function profileInitials(profile: AiProfile | null): string {
  const source = profile?.displayName || profile?.email || "User";
  const letters = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "U";
}

export function defaultModelForProvider(provider: AiProvider): string {
  return AGENT_DEFAULT_MODELS[provider];
}

export function providerLabel(provider: AiProvider): string {
  return AGENT_PROVIDER_LABELS[provider];
}

export function aiProfileModelLabel(profile: AiProfile | null): string {
  if (!profile) return "Not configured";
  return agentModelLabel(profile.provider, profile.modelId);
}
