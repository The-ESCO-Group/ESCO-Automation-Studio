import { createSettingsStore, type SettingsStore } from "./settings";
import type { DockTab } from "./components/BottomPanel";
import type { CopilotTab } from "./components/RightCopilotPanel";

/**
 * Workbench layout persistence (not tied to a project): which bottom-dock tab is
 * active, which Copilot/inspector tab is active, and whether the right inspector
 * is expanded. A real IDE remembers how you left the workbench, so the dock and
 * panels come back the way you parked them on the next launch.
 *
 * Persisted locally via the shared {@link SettingsStore} (localStorage with a
 * memory fallback for tests/SSR). Reads never throw and always normalise to a
 * valid layout, so a corrupt or stale value silently falls back to the default
 * rather than wedging the shell.
 */

const LAYOUT_KEY = "workbench.layout.v1";

// These Record literals are the single source of truth for the allowed values.
// They are typed by the component unions, so if BottomPanel/RightCopilotPanel
// add or rename a tab, these objects fail to typecheck until kept in sync — that
// keeps runtime validation honest instead of silently drifting.
const DOCK_TAB_VALUES: Record<DockTab, true> = {
  diagnostics: true,
  controller: true,
  model: true,
  search: true,
  references: true,
  build: true,
  handoff: true,
  tasks: true,
  watch: true,
  trend: true,
  forces: true,
};
const COPILOT_TAB_VALUES: Record<CopilotTab, true> = {
  chat: true,
  model: true,
  history: true,
  help: true,
};

const DOCK_TABS = Object.keys(DOCK_TAB_VALUES) as DockTab[];
const COPILOT_TABS = Object.keys(COPILOT_TAB_VALUES) as CopilotTab[];

export interface WorkbenchLayout {
  /** The bottom-dock tab that was last active (Watch, Forces, Diagnostics, …). */
  dockTab: DockTab;
  /** The right inspector / Copilot tab that was last active. */
  copilotTab: CopilotTab;
  /** Whether the right inspector panel was expanded. */
  rightPanelOpen: boolean;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  dockTab: "watch",
  copilotTab: "chat",
  rightPanelOpen: false,
};

function isDockTab(value: unknown): value is DockTab {
  return typeof value === "string" && DOCK_TABS.includes(value as DockTab);
}

function isCopilotTab(value: unknown): value is CopilotTab {
  return typeof value === "string" && COPILOT_TABS.includes(value as CopilotTab);
}

/** Coerce any stored/partial value into a complete, valid layout. */
export function normalizeWorkbenchLayout(value: unknown): WorkbenchLayout {
  const partial = (value ?? {}) as Partial<Record<keyof WorkbenchLayout, unknown>>;
  return {
    dockTab: isDockTab(partial.dockTab) ? partial.dockTab : DEFAULT_WORKBENCH_LAYOUT.dockTab,
    copilotTab: isCopilotTab(partial.copilotTab)
      ? partial.copilotTab
      : DEFAULT_WORKBENCH_LAYOUT.copilotTab,
    rightPanelOpen:
      typeof partial.rightPanelOpen === "boolean"
        ? partial.rightPanelOpen
        : DEFAULT_WORKBENCH_LAYOUT.rightPanelOpen,
  };
}

const sharedStore = createSettingsStore();

/** Read the persisted workbench layout, falling back to the default. */
export function loadWorkbenchLayout(store: SettingsStore = sharedStore): WorkbenchLayout {
  return normalizeWorkbenchLayout(store.get<Partial<WorkbenchLayout> | null>(LAYOUT_KEY, null));
}

/**
 * Persist a (partial) layout update, merged over what is already stored, and
 * return the resulting normalised layout. Best-effort: storage failures are
 * swallowed by the underlying store.
 */
export function saveWorkbenchLayout(
  patch: Partial<WorkbenchLayout>,
  store: SettingsStore = sharedStore,
): WorkbenchLayout {
  const next = normalizeWorkbenchLayout({ ...loadWorkbenchLayout(store), ...patch });
  store.set(LAYOUT_KEY, next);
  return next;
}
