import { describe, expect, it } from "vitest";
import { SettingsStore, memoryStorage } from "./settings";
import { exportProjectJson } from "@esco/project-actions";
import { createBlankRoutineProject } from "./project-edit";
import {
  aiProfileModelLabel,
  clearAiProfile,
  hasAiProfile,
  loadAiProfile,
  publicAiProfile,
  saveAiProfile,
} from "./ai-profile";
import {
  isFirstRunComplete,
  loadConnectionMode,
  markFirstRunComplete,
  saveConnectionMode,
} from "./app-settings";

describe("SettingsStore", () => {
  it("round-trips JSON values under a namespace", () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage, "esco");
    store.set("foo", { a: 1, b: ["x"] });
    expect(store.get("foo", null)).toEqual({ a: 1, b: ["x"] });
    // Namespaced key actually written.
    expect(storage.getItem("esco.foo")).toBe('{"a":1,"b":["x"]}');
  });

  it("returns the fallback for missing or corrupt values, never throws", () => {
    const store = new SettingsStore(memoryStorage({ "esco.bad": "{not json" }), "esco");
    expect(store.get("missing", "fallback")).toBe("fallback");
    expect(store.get("bad", "fallback")).toBe("fallback");
  });

  it("has() and remove() work", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(store.has("k")).toBe(false);
    store.set("k", 1);
    expect(store.has("k")).toBe(true);
    store.remove("k");
    expect(store.has("k")).toBe(false);
  });
});

describe("AI profile persistence (ask once)", () => {
  it("persists a valid profile and never asks again", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(hasAiProfile(store)).toBe(false);
    const saved = saveAiProfile({
      displayName: "Eng",
      email: "e@x.com",
      provider: "anthropic",
      apiKey: "sk-ant-123",
    }, store);
    expect(saved).not.toBeNull();
    // A fresh read (new session simulated) still has it — no re-prompt needed.
    expect(hasAiProfile(store)).toBe(true);
    expect(loadAiProfile(store)?.apiKey).toBe("sk-ant-123");
    expect(loadAiProfile(store)?.provider).toBe("anthropic");
  });

  it("stores public profile metadata separately from the workstation secret", () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage, "esco");
    const saved = saveAiProfile({
      displayName: "Eng",
      provider: "openai",
      modelId: "gpt-4.1",
      apiKey: "sk-secret-openai",
    }, store);

    expect(saved?.apiKey).toBe("sk-secret-openai");
    expect(String(storage.getItem("esco.ai.profile.v2"))).not.toContain("sk-secret-openai");
    expect(storage.getItem("esco.ai.profile.secret.v1")).toBe('"sk-secret-openai"');
    expect(publicAiProfile(saved)?.keySaved).toBe(true);
    expect(JSON.stringify(publicAiProfile(saved))).not.toContain("sk-secret-openai");
  });

  it("persists the selected provider and model for the Copilot footer/transport", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    const saved = saveAiProfile({
      displayName: "Eng",
      provider: "openai",
      modelId: "gpt-4.1",
      apiKey: "sk-test-openai",
    }, store);
    expect(saved?.provider).toBe("openai");
    expect(saved?.modelId).toBe("gpt-4.1");
    expect(aiProfileModelLabel(loadAiProfile(store))).toBe("OpenAI: gpt-4.1");
  });

  it("rejects an incomplete profile (no API key)", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(saveAiProfile({ displayName: "Eng", provider: "anthropic", apiKey: "" }, store)).toBeNull();
    expect(hasAiProfile(store)).toBe(false);
  });

  it("fails closed when the saved provider is unknown or unconfigured", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(saveAiProfile({
      displayName: "Eng",
      provider: "vendorx" as never,
      modelId: "vendor-model",
      apiKey: "sk-vendor",
    }, store)).toBeNull();
    expect(loadAiProfile(store)).toBeNull();
  });

  it("keeps AI secrets out of project export JSON", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    saveAiProfile({
      displayName: "Eng",
      provider: "openai",
      modelId: "gpt-4.1",
      apiKey: "sk-project-export-secret",
    }, store);

    const exported = exportProjectJson(createBlankRoutineProject()).data?.text ?? "";
    expect(exported).not.toContain("sk-project-export-secret");
    expect(exported).not.toContain("ai.profile");
  });

  it("can clear the saved profile (rotate key / sign out)", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    saveAiProfile({ displayName: "Eng", provider: "anthropic", apiKey: "sk-ant-123" }, store);
    clearAiProfile(store);
    expect(hasAiProfile(store)).toBe(false);
  });

  it("migrates legacy v1 profiles into split metadata plus secret storage", () => {
    const storage = memoryStorage({
      "esco.ai.profile.v1": JSON.stringify({
        displayName: "Legacy Eng",
        apiKey: "sk-ant-legacy",
        savedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    const store = new SettingsStore(storage, "esco");

    const profile = loadAiProfile(store);

    expect(profile?.provider).toBe("anthropic");
    expect(profile?.apiKey).toBe("sk-ant-legacy");
    expect(storage.getItem("esco.ai.profile.v1")).toBeNull();
    expect(String(storage.getItem("esco.ai.profile.v2"))).not.toContain("sk-ant-legacy");
    expect(storage.getItem("esco.ai.profile.secret.v1")).toBe('"sk-ant-legacy"');
  });
});

describe("app settings", () => {
  it("tracks first-run completion", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(isFirstRunComplete(store)).toBe(false);
    markFirstRunComplete(store);
    expect(isFirstRunComplete(store)).toBe(true);
  });

  it("defaults connection mode to offline-simulation and persists changes", () => {
    const store = new SettingsStore(memoryStorage(), "esco");
    expect(loadConnectionMode(store)).toBe("offline-simulation");
    saveConnectionMode("request-readonly", store);
    expect(loadConnectionMode(store)).toBe("request-readonly");
  });
});
