import type { HmiProject } from "./types";

/**
 * Runtime localization for the HMI preview. Language packs hold `strings` keyed
 * by a string id; a localized-text binding resolves those ids in the session's
 * current language, falling back to the project's default language when the
 * current pack is missing a key. Truly-missing keys (in no pack) are left
 * unresolved so the binding engine can flag them.
 */

export interface HmiLanguageOption {
  languageId: string;
  displayName: string;
  isDefault: boolean;
}

/** The languages available to switch between at runtime. */
export function hmiLanguageOptions(project: HmiProject): HmiLanguageOption[] {
  return project.languagePacks.map((pack) => ({
    languageId: pack.languageId,
    displayName: pack.displayName,
    isDefault: pack.languageId === project.defaultLanguage,
  }));
}

/**
 * Resolve every known string id for `languageId`, falling back to the default
 * language pack per-key. Returns a flat `id -> text` map (only keys present in
 * some pack appear).
 */
export function resolveHmiLanguageStrings(project: HmiProject, languageId: string): Record<string, string> {
  const current = project.languagePacks.find((pack) => pack.languageId === languageId);
  const fallback = project.languagePacks.find((pack) => pack.languageId === project.defaultLanguage);
  const result: Record<string, string> = {};
  const keys = new Set<string>([
    ...Object.keys(fallback?.strings ?? {}),
    ...Object.keys(current?.strings ?? {}),
  ]);
  for (const key of keys) {
    const value = current?.strings[key] ?? fallback?.strings[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Resolve a single string id in `languageId` with default-language fallback.
 * Returns `undefined` when no pack defines the key.
 */
export function localizeHmiText(project: HmiProject, languageId: string, key: string): string | undefined {
  const current = project.languagePacks.find((pack) => pack.languageId === languageId);
  if (current && key in current.strings) return current.strings[key];
  const fallback = project.languagePacks.find((pack) => pack.languageId === project.defaultLanguage);
  if (fallback && key in fallback.strings) return fallback.strings[key];
  return undefined;
}

/** System-tag namespace prefix under which localized strings are published. */
export const HMI_LOCALIZED_TEXT_PREFIX = "Text.";

/** Build the `Text.<id>` system-tag map a binding can resolve for the current language. */
export function hmiLocalizedSystemTags(project: HmiProject, languageId: string): Record<string, string> {
  const strings = resolveHmiLanguageStrings(project, languageId);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(strings)) out[`${HMI_LOCALIZED_TEXT_PREFIX}${key}`] = value;
  return out;
}
