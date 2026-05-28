const RECENT_KEY = "esco.recentProjects.v1";
const RECENT_LIMIT = 8;

export interface RecentProjectEntry {
  id: string;
  name: string;
  source: "created" | "opened" | "imported" | "exported";
  fileName?: string;
  at: string;
}

function readRaw(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentProjectEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.name && entry?.at) : [];
  } catch {
    return [];
  }
}

export function loadRecentProjects(): RecentProjectEntry[] {
  return readRaw().slice(0, RECENT_LIMIT);
}

export function rememberRecentProject(
  current: RecentProjectEntry[],
  entry: Omit<RecentProjectEntry, "id" | "at">,
): RecentProjectEntry[] {
  const next: RecentProjectEntry = {
    ...entry,
    id: `${entry.source}:${entry.name}:${entry.fileName ?? ""}`,
    at: new Date().toISOString(),
  };
  const deduped = [next, ...current.filter((item) => item.id !== next.id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(deduped));
  } catch {
    /* Recent projects are convenience metadata only. */
  }
  return deduped;
}
