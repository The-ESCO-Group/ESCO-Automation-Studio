import { describe, expect, it } from "vitest";
import {
  hmiLanguageOptions,
  hmiLocalizedSystemTags,
  localizeHmiText,
  resolveHmiLanguageStrings,
} from "./localization";
import { createDefaultHmiProject } from "./factory";
import type { HmiProject } from "./types";

function projectWithLanguages(): HmiProject {
  const project = createDefaultHmiProject("Localized");
  project.defaultLanguage = "en-US";
  project.languagePacks = [
    {
      id: "lang-en",
      languageId: "en-US",
      displayName: "English (United States)",
      strings: { greeting: "Hello", motor: "Motor", onlyEn: "EnglishOnly" },
      missingStringIds: [],
    },
    {
      id: "lang-de",
      languageId: "de-DE",
      displayName: "Deutsch",
      strings: { greeting: "Hallo", motor: "Motor" },
      missingStringIds: [],
    },
  ];
  return project;
}

describe("localization", () => {
  it("lists language options with the default flagged", () => {
    const options = hmiLanguageOptions(projectWithLanguages());
    expect(options).toEqual([
      { languageId: "en-US", displayName: "English (United States)", isDefault: true },
      { languageId: "de-DE", displayName: "Deutsch", isDefault: false },
    ]);
  });

  it("resolves a string in the requested language", () => {
    expect(localizeHmiText(projectWithLanguages(), "de-DE", "greeting")).toBe("Hallo");
  });

  it("falls back to the default language for a missing key", () => {
    // onlyEn exists only in en-US; requesting de-DE falls back.
    expect(localizeHmiText(projectWithLanguages(), "de-DE", "onlyEn")).toBe("EnglishOnly");
  });

  it("returns undefined for a key in no pack", () => {
    expect(localizeHmiText(projectWithLanguages(), "de-DE", "ghost")).toBeUndefined();
  });

  it("resolves the full string set with per-key fallback", () => {
    expect(resolveHmiLanguageStrings(projectWithLanguages(), "de-DE")).toEqual({
      greeting: "Hallo",
      motor: "Motor",
      onlyEn: "EnglishOnly",
    });
  });

  it("publishes Text.<id> system tags for the language", () => {
    const tags = hmiLocalizedSystemTags(projectWithLanguages(), "de-DE");
    expect(tags["Text.greeting"]).toBe("Hallo");
    expect(tags["Text.onlyEn"]).toBe("EnglishOnly");
  });
});
