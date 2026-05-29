import { invokeDesktopCommand, isDesktopRuntime } from "./desktop-runtime";
import { browserStorage, memoryStorage, type StorageLike } from "./settings";

/**
 * Secure-key abstraction for secrets (the AI API key today).
 *
 * Two honest backends behind one async contract:
 *   - `os-keychain`   — the packaged Windows desktop shell stores the secret in
 *                       the OS credential store (Windows Credential Manager) via
 *                       Tauri `secure_key_*` commands. Encrypted at rest, not in
 *                       app storage.
 *   - `browser-local` — the web build (and any desktop build WITHOUT the secure
 *                       commands compiled in) falls back to local storage. This is
 *                       NOT OS-encrypted; callers surface `label`/`backend` so the
 *                       user knows exactly where the secret lives.
 *
 * The point is to make the storage location explicit and swappable, and to never
 * silently claim "secure" storage when only the local fallback is active. The
 * factory probes for the desktop secure-key commands and degrades to the local
 * store if they are absent or fail — so the web app and an un-upgraded desktop
 * build both keep working.
 *
 * NOTE: the desktop `secure_key_*` commands are specified and scaffolded in the
 * Tauri shell but require a real `tauri build` (Rust toolchain) to verify. Until
 * then `secure_key_available` resolves falsy and this falls back to browser-local.
 */

export type SecretBackendKind = "os-keychain" | "browser-local";

export interface SecretStore {
  /** Which backend is actually active (for honest UI: "stored in OS keychain" vs "browser local"). */
  readonly backend: SecretBackendKind;
  /** Human-readable description of where secrets live. */
  readonly label: string;
  /** True when the backend encrypts at rest via the OS. */
  readonly osEncrypted: boolean;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Minimal invoker shape (matches {@link invokeDesktopCommand}); injectable for tests. */
export type DesktopInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T | undefined>;

/** Tauri command names the desktop shell must expose for OS-keychain storage. */
export const SECURE_KEY_COMMANDS = {
  available: "secure_key_available",
  get: "secure_key_get",
  set: "secure_key_set",
  delete: "secure_key_delete",
} as const;

/**
 * A {@link SecretStore} backed by the desktop OS keychain via Tauri commands.
 * Created only after {@link createSecretStore} confirms the commands exist.
 */
export function osKeychainSecretStore(invoke: DesktopInvoker = invokeDesktopCommand): SecretStore {
  return {
    backend: "os-keychain",
    label: "Windows Credential Manager (OS keychain)",
    osEncrypted: true,
    async get(name) {
      const value = await invoke<string | null>(SECURE_KEY_COMMANDS.get, { name });
      return value ?? null;
    },
    async set(name, value) {
      await invoke<void>(SECURE_KEY_COMMANDS.set, { name, value });
    },
    async delete(name) {
      await invoke<void>(SECURE_KEY_COMMANDS.delete, { name });
    },
  };
}

/** A {@link SecretStore} backed by local storage. Not OS-encrypted. */
export function browserLocalSecretStore(
  storage: StorageLike = browserStorage() ?? memoryStorage(),
  namespace = "esco.secret",
): SecretStore {
  const key = (name: string) => `${namespace}.${name}`;
  return {
    backend: "browser-local",
    label: "Browser local storage (not OS-encrypted)",
    osEncrypted: false,
    async get(name) {
      try {
        return storage.getItem(key(name));
      } catch {
        return null;
      }
    },
    async set(name, value) {
      try {
        storage.setItem(key(name), value);
      } catch {
        /* best-effort */
      }
    },
    async delete(name) {
      try {
        storage.removeItem(key(name));
      } catch {
        /* ignore */
      }
    },
  };
}

export interface CreateSecretStoreOptions {
  /** Override desktop detection (defaults to {@link isDesktopRuntime}). */
  isDesktop?: boolean;
  /** Override the Tauri invoker (defaults to {@link invokeDesktopCommand}). */
  invoke?: DesktopInvoker;
  /** Override the local-storage backend used for the fallback. */
  storage?: StorageLike;
}

/**
 * Resolve the best available secret store. Prefers the OS keychain on desktop when
 * the `secure_key_*` commands are present and report available; otherwise falls
 * back to browser-local. Never throws — a probe failure degrades to local storage.
 */
export async function createSecretStore(options: CreateSecretStoreOptions = {}): Promise<SecretStore> {
  const isDesktop = options.isDesktop ?? isDesktopRuntime();
  const invoke = options.invoke ?? invokeDesktopCommand;

  if (isDesktop) {
    try {
      const available = await invoke<boolean>(SECURE_KEY_COMMANDS.available);
      if (available === true) return osKeychainSecretStore(invoke);
    } catch {
      // Secure-key commands not compiled in / failed — fall back honestly below.
    }
  }

  return browserLocalSecretStore(options.storage ?? browserStorage() ?? memoryStorage());
}
