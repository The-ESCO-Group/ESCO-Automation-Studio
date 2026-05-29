/**
 * Local settings persistence abstraction.
 *
 * A thin, testable layer over a key/value store. In the browser (and the future
 * Windows desktop shell) it persists to `localStorage`; in tests / SSR it falls
 * back to an in-memory store. Keeping the storage behind an interface means the
 * persistence logic is unit-testable without a DOM, and the storage backend can
 * be swapped (e.g. for an OS keychain in the packaged app) without touching call
 * sites.
 *
 * Security note: secrets like the AI API key are stored locally only — never sent
 * to git, never logged. The desktop packaging path (see docs/desktop.md) can
 * replace `browserStorage()` with an encrypted OS-backed store via the same
 * `StorageLike` contract.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** An in-memory StorageLike, used for tests and any non-browser environment. */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** The browser's localStorage if available, else null. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    // Touch it to surface SecurityError in locked-down contexts.
    const probe = "__esco_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * A namespaced JSON settings store. All keys are prefixed with the namespace so
 * different feature areas don't collide. Reads never throw — a corrupt or missing
 * value yields the provided fallback.
 */
export class SettingsStore {
  constructor(
    private readonly storage: StorageLike,
    private readonly namespace = "esco",
  ) {}

  private k(key: string): string {
    return `${this.namespace}.${key}`;
  }

  get<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(this.k(key));
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      this.storage.setItem(this.k(key), JSON.stringify(value));
    } catch {
      /* storage full / unavailable — settings are best-effort */
    }
  }

  remove(key: string): void {
    try {
      this.storage.removeItem(this.k(key));
    } catch {
      /* ignore */
    }
  }

  has(key: string): boolean {
    try {
      return this.storage.getItem(this.k(key)) !== null;
    } catch {
      return false;
    }
  }
}

/** The default app settings store, backed by localStorage with a memory fallback. */
export function createSettingsStore(): SettingsStore {
  return new SettingsStore(browserStorage() ?? memoryStorage(), "esco");
}
