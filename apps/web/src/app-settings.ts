import { createSettingsStore, type SettingsStore } from "./settings";

/**
 * Workstation-level app settings (not tied to a project): whether first-run setup
 * has been completed and the user's preferred controller-connection mode. These
 * persist locally via the shared {@link SettingsStore}, so the app never re-nags
 * once configured.
 */

const FIRST_RUN_KEY = "app.firstRunComplete.v1";
const CONNECTION_MODE_KEY = "app.connectionMode.v1";

/** The connection modes the user can pre-select (all offline-safe in this build). */
export type ConnectionModePreference = "offline-simulation" | "request-readonly";

const sharedStore = createSettingsStore();

export function isFirstRunComplete(store: SettingsStore = sharedStore): boolean {
  return store.get<boolean>(FIRST_RUN_KEY, false);
}

export function markFirstRunComplete(store: SettingsStore = sharedStore): void {
  store.set(FIRST_RUN_KEY, true);
}

export function loadConnectionMode(store: SettingsStore = sharedStore): ConnectionModePreference {
  return store.get<ConnectionModePreference>(CONNECTION_MODE_KEY, "offline-simulation");
}

export function saveConnectionMode(
  mode: ConnectionModePreference,
  store: SettingsStore = sharedStore,
): void {
  store.set(CONNECTION_MODE_KEY, mode);
}
