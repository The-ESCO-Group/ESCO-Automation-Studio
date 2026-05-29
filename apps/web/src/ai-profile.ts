import { createSettingsStore, type SettingsStore } from "./settings";
import {
  AGENT_DEFAULT_MODELS,
  AGENT_DEFAULT_PROVIDER,
  AGENT_PROVIDER_LABELS,
  agentModelLabel,
  type AgentModelProvider,
} from "@esco/ai-assistant";

const PROFILE_KEY = "ai.profile.v2";
const PROFILE_SECRET_KEY = "ai.profile.secret.v1";
const LEGACY_PROFILE_KEY = "ai.profile.v1";

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

interface StoredAiProfile {
  displayName: string;
  email: string;
  provider: AiProvider;
  modelId: string;
  savedAt: string;
  keySaved: true;
}

export type PublicAiProfile = Omit<AiProfile, "apiKey"> & { keySaved: true };

function cleanProvider(value: unknown): AiProvider | null {
  if (value === "openai" || value === "anthropic") return value;
  return null;
}

function inferLegacyProvider(apiKey: string): AiProvider {
  return apiKey.trim().startsWith("sk-ant-") ? "anthropic" : AGENT_DEFAULT_PROVIDER;
}

function cleanProfile(
  value: Partial<AiProfile | StoredAiProfile>,
  apiKeyOverride?: string,
  allowLegacyInference = false,
): AiProfile | null {
  const displayName = value.displayName?.trim() ?? "";
  const apiKey = (apiKeyOverride ?? ("apiKey" in value ? value.apiKey : undefined))?.trim() ?? "";
  if (!displayName || !apiKey) return null;
  const provider = cleanProvider(value.provider) ?? (allowLegacyInference ? inferLegacyProvider(apiKey) : null);
  if (!provider) return null;
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

function toStoredProfile(profile: AiProfile): StoredAiProfile {
  return {
    displayName: profile.displayName,
    email: profile.email,
    provider: profile.provider,
    modelId: profile.modelId,
    savedAt: profile.savedAt,
    keySaved: true,
  };
}

export function publicAiProfile(profile: AiProfile | null): PublicAiProfile | null {
  if (!profile) return null;
  return { ...toStoredProfile(profile) };
}

function persistProfile(profile: AiProfile, store: SettingsStore): void {
  store.set(PROFILE_KEY, toStoredProfile(profile));
  store.set(PROFILE_SECRET_KEY, profile.apiKey);
  store.remove(LEGACY_PROFILE_KEY);
}

/**
 * Load the saved workstation AI profile, or null if setup hasn't happened. Once a
 * valid profile is saved we never need to ask for the API key again — this read
 * is what makes "ask once" work across sessions.
 */
export function loadAiProfile(store: SettingsStore = sharedStore): AiProfile | null {
  const raw = store.get<Partial<StoredAiProfile> | null>(PROFILE_KEY, null);
  const secret = store.get<string>(PROFILE_SECRET_KEY, "");
  const profile = raw ? cleanProfile(raw, secret) : null;
  if (profile) return profile;

  const legacy = store.get<Partial<AiProfile> | null>(LEGACY_PROFILE_KEY, null);
  const migrated = legacy ? cleanProfile(legacy, undefined, true) : null;
  if (migrated) persistProfile(migrated, store);
  return migrated;
}

export function saveAiProfile(
  value: Partial<AiProfile>,
  store: SettingsStore = sharedStore,
): AiProfile | null {
  const profile = cleanProfile({ ...value, savedAt: new Date().toISOString() });
  if (!profile) return null;
  persistProfile(profile, store);
  return profile;
}

/** True once a valid profile (incl. API key) has been saved on this workstation. */
export function hasAiProfile(store: SettingsStore = sharedStore): boolean {
  return loadAiProfile(store) !== null;
}

/** Remove the saved profile (e.g. "sign out" / rotate key). */
export function clearAiProfile(store: SettingsStore = sharedStore): void {
  store.remove(PROFILE_KEY);
  store.remove(PROFILE_SECRET_KEY);
  store.remove(LEGACY_PROFILE_KEY);
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
