const PROFILE_KEY = "esco.ai.profile.v1";

export interface AiProfile {
  displayName: string;
  email: string;
  apiKey: string;
  savedAt: string;
}

function cleanProfile(value: Partial<AiProfile>): AiProfile | null {
  const displayName = value.displayName?.trim() ?? "";
  const apiKey = value.apiKey?.trim() ?? "";
  if (!displayName || !apiKey) return null;
  return {
    displayName,
    email: value.email?.trim() ?? "",
    apiKey,
    savedAt: value.savedAt ?? new Date().toISOString(),
  };
}

export function loadAiProfile(): AiProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return cleanProfile(JSON.parse(raw) as Partial<AiProfile>);
  } catch {
    return null;
  }
}

export function saveAiProfile(value: Partial<AiProfile>): AiProfile | null {
  const profile = cleanProfile({ ...value, savedAt: new Date().toISOString() });
  if (!profile) return null;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
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
