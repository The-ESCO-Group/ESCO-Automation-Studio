import { createSettingsStore, type SettingsStore } from "./settings";

const RECENT_KEY = "recentProjects.v2";
const RECENT_LIMIT = 8;
const sharedStore = createSettingsStore();

export interface RecentProjectEntry {
  id: string;
  projectId?: string;
  name: string;
  source: "created" | "opened" | "imported" | "exported";
  storage: "desktop-file" | "browser-file" | "download" | "metadata";
  fileName?: string;
  path?: string;
  at: string;
  status?: "available" | "missing" | "unknown";
}

export interface RecentProjectInput {
  projectId?: string;
  name: string;
  source: RecentProjectEntry["source"];
  storage?: RecentProjectEntry["storage"];
  fileName?: string;
  path?: string;
  status?: RecentProjectEntry["status"];
}

function stableId(entry: Omit<RecentProjectInput, "source"> & { source?: RecentProjectInput["source"] }): string {
  if (entry.path) return `path:${entry.path}`;
  if (entry.projectId && entry.fileName) return `project-file:${entry.projectId}:${entry.fileName}`;
  if (entry.projectId) return `project:${entry.projectId}`;
  return `${entry.source}:${entry.name}:${entry.fileName ?? ""}`;
}

export function normalizeRecentProjects(value: unknown): RecentProjectEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Partial<RecentProjectEntry> & { name: string; at: string } =>
      typeof entry?.name === "string" && typeof entry?.at === "string",
    )
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : stableId(entry),
      projectId: typeof entry.projectId === "string" ? entry.projectId : undefined,
      name: entry.name,
      source: entry.source ?? "opened",
      storage: entry.storage ?? (entry.path ? "desktop-file" : "metadata"),
      fileName: typeof entry.fileName === "string" ? entry.fileName : undefined,
      path: typeof entry.path === "string" ? entry.path : undefined,
      at: entry.at,
      status: entry.status ?? (entry.path ? "available" : "unknown"),
    }))
    .slice(0, RECENT_LIMIT);
}

export function loadRecentProjects(store: SettingsStore = sharedStore): RecentProjectEntry[] {
  return normalizeRecentProjects(store.get<unknown>(RECENT_KEY, []));
}

function saveRecentProjects(entries: RecentProjectEntry[], store: SettingsStore): void {
  store.set(RECENT_KEY, entries.slice(0, RECENT_LIMIT));
}

export function rememberRecentProject(
  current: RecentProjectEntry[],
  entry: RecentProjectInput,
  store: SettingsStore = sharedStore,
): RecentProjectEntry[] {
  const next: RecentProjectEntry = {
    ...entry,
    id: stableId(entry),
    storage: entry.storage ?? (entry.path ? "desktop-file" : "metadata"),
    status: entry.status ?? (entry.path ? "available" : "unknown"),
    at: new Date().toISOString(),
  };
  const deduped = [next, ...current.filter((item) => item.id !== next.id)].slice(0, RECENT_LIMIT);
  saveRecentProjects(deduped, store);
  return deduped;
}

export function markRecentProjectMissing(
  current: RecentProjectEntry[],
  id: string,
  store: SettingsStore = sharedStore,
): RecentProjectEntry[] {
  const next = current.map((entry) =>
    entry.id === id ? { ...entry, status: "missing" as const, at: new Date().toISOString() } : entry,
  );
  saveRecentProjects(next, store);
  return next;
}
