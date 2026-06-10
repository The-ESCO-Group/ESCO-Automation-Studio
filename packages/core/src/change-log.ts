/**
 * Immutable helpers for a project's persistent change history (audit log).
 *
 * The change log lives on the {@link PlcProject} model so it survives a
 * save/open of an `.easproj` file. These helpers never mutate the input
 * project; they return a new project with the log updated, and cap the log to
 * the most recent {@link MAX_CHANGE_LOG_ENTRIES} entries so it cannot grow
 * without bound.
 */

import type { PlcProject, ProjectChangeEntry } from "./types";

/**
 * Maximum number of change-history entries retained on a project. When the log
 * exceeds this, the oldest entries are dropped so the most recent
 * {@link MAX_CHANGE_LOG_ENTRIES} are kept.
 */
export const MAX_CHANGE_LOG_ENTRIES = 500;

/**
 * Return a new project with `entry` appended to its change history. The input
 * project is never mutated. The log is kept oldest-first and capped to the most
 * recent {@link MAX_CHANGE_LOG_ENTRIES} entries.
 */
export function appendProjectChange(project: PlcProject, entry: ProjectChangeEntry): PlcProject {
  const existing = project.changeLog ?? [];
  const next = [...existing, entry];
  const capped = next.length > MAX_CHANGE_LOG_ENTRIES ? next.slice(next.length - MAX_CHANGE_LOG_ENTRIES) : next;
  return { ...project, changeLog: capped };
}
