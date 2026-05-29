import { describe, expect, it, vi } from "vitest";
import {
  SECURE_KEY_COMMANDS,
  browserLocalSecretStore,
  createSecretStore,
  osKeychainSecretStore,
} from "./desktop-secret-store";
import { memoryStorage } from "./settings";

describe("browserLocalSecretStore", () => {
  it("round-trips a secret and reports it is NOT OS-encrypted", async () => {
    const store = browserLocalSecretStore(memoryStorage());
    expect(store.backend).toBe("browser-local");
    expect(store.osEncrypted).toBe(false);
    expect(await store.get("ai.apiKey")).toBeNull();
    await store.set("ai.apiKey", "sk-test-123");
    expect(await store.get("ai.apiKey")).toBe("sk-test-123");
    await store.delete("ai.apiKey");
    expect(await store.get("ai.apiKey")).toBeNull();
  });

  it("namespaces keys so different secrets don't collide", async () => {
    const backing = memoryStorage();
    const store = browserLocalSecretStore(backing, "esco.secret");
    await store.set("ai.apiKey", "x");
    expect(backing.getItem("esco.secret.ai.apiKey")).toBe("x");
  });
});

describe("osKeychainSecretStore", () => {
  it("maps get/set/delete to the secure_key_* Tauri commands", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === SECURE_KEY_COMMANDS.get) return "sk-from-keychain" as never;
      return undefined as never;
    });
    const store = osKeychainSecretStore(invoke);
    expect(store.backend).toBe("os-keychain");
    expect(store.osEncrypted).toBe(true);

    expect(await store.get("ai.apiKey")).toBe("sk-from-keychain");
    await store.set("ai.apiKey", "sk-new");
    await store.delete("ai.apiKey");

    expect(calls.map((c) => c.command)).toEqual([
      SECURE_KEY_COMMANDS.get,
      SECURE_KEY_COMMANDS.set,
      SECURE_KEY_COMMANDS.delete,
    ]);
    expect(calls[1].args).toEqual({ name: "ai.apiKey", value: "sk-new" });
  });

  it("treats a missing keychain value (undefined) as null", async () => {
    const invoke = vi.fn(async () => undefined as never);
    const store = osKeychainSecretStore(invoke);
    expect(await store.get("missing")).toBeNull();
  });
});

describe("createSecretStore picks the right backend honestly", () => {
  it("uses the OS keychain on desktop when secure_key_available is true", async () => {
    const invoke = vi.fn(async (command: string) =>
      (command === SECURE_KEY_COMMANDS.available ? true : undefined) as never,
    );
    const store = await createSecretStore({ isDesktop: true, invoke });
    expect(store.backend).toBe("os-keychain");
    expect(store.osEncrypted).toBe(true);
  });

  it("falls back to browser-local on desktop when the secure commands are absent", async () => {
    // Simulate a desktop build WITHOUT the secure-key commands compiled in.
    const invoke = vi.fn(async () => {
      throw new Error("command secure_key_available not found");
    });
    const store = await createSecretStore({ isDesktop: true, invoke, storage: memoryStorage() });
    expect(store.backend).toBe("browser-local");
    expect(store.osEncrypted).toBe(false);
  });

  it("falls back to browser-local on desktop when availability reports false", async () => {
    const invoke = vi.fn(async () => false as never);
    const store = await createSecretStore({ isDesktop: true, invoke, storage: memoryStorage() });
    expect(store.backend).toBe("browser-local");
  });

  it("uses browser-local in the web build (not desktop) and never probes Tauri", async () => {
    const invoke = vi.fn(async () => true as never);
    const store = await createSecretStore({ isDesktop: false, invoke, storage: memoryStorage() });
    expect(store.backend).toBe("browser-local");
    expect(invoke).not.toHaveBeenCalled();
  });
});
