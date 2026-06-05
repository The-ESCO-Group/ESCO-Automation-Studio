import type { PlcProject } from "@esco/core";
import {
  diffProjectBundles,
  mergeProjectBundle,
  splitProjectBundle,
  type ProjectBundle,
  type StructuredDiff,
} from "@esco/project-store";
import { invokeDesktopCommand, isDesktopRuntime } from "./desktop-runtime";

export const WORKING_COPY = "WORKTREE";

export interface VcsFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface VcsRemote {
  name: string;
  url: string;
}

export interface ProjectStatus {
  initialized: boolean;
  currentBranch: string;
  detached: boolean;
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  changedFiles: VcsFileChange[];
  branches: string[];
  remotes: VcsRemote[];
  ahead: number;
  behind: number;
}

export interface Revision {
  id: string;
  shortId: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
}

export interface RawDiffEntry {
  path: string;
  status: string;
  oldContent: string | null;
  newContent: string | null;
}

export interface RestoreOutcome {
  backupBranch: string;
  revision: Revision;
}

export interface SyncResult {
  ok: boolean;
  conflicts: boolean;
  backupBranch: string | null;
  message: string;
}

export type VcsResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NOT_DESKTOP = "Project History is available in the ESCO Automation Studio desktop app.";
const COMMAND_BRIDGE_UNAVAILABLE =
  "Project History is waiting for the desktop command bridge. Restart the desktop app if this keeps happening.";

function fail<T>(error: string): Promise<VcsResult<T>> {
  return Promise.resolve({ ok: false, error });
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<VcsResult<T>> {
  if (!isDesktopRuntime()) return { ok: false, error: NOT_DESKTOP };
  try {
    const value = await invokeDesktopCommand<T>(command, args);
    if (value === undefined) {
      return { ok: false, error: isDesktopRuntime() ? COMMAND_BRIDGE_UNAVAILABLE : NOT_DESKTOP };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "An unexpected version-control error occurred.";
}

export async function isVersionControlAvailable(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  const result = await call<boolean>("git_available");
  return result.ok && result.value;
}

export function selectProjectFolder(): Promise<VcsResult<string | null>> {
  return call<string | null>("git_select_project_folder");
}

export function initVersionControl(repoPath: string): Promise<VcsResult<ProjectStatus>> {
  if (!repoPath.trim()) return fail("Choose a project history folder before setting up versions.");
  return call<ProjectStatus>("git_init_repo", { repoPath });
}

export function getProjectStatus(repoPath: string): Promise<VcsResult<ProjectStatus>> {
  if (!repoPath.trim()) return fail("Choose a project history folder before reading version status.");
  return call<ProjectStatus>("git_get_status", { repoPath });
}

export function saveVersion(repoPath: string, project: PlcProject, message: string): Promise<VcsResult<Revision>> {
  if (!repoPath.trim()) return fail("Set up Project History before saving a version.");
  if (!message.trim()) return fail("Describe what changed before saving this version.");
  return call<Revision>("git_create_revision", {
    repoPath,
    files: splitProjectBundle(project),
    message: message.trim(),
  });
}

export function getHistory(repoPath: string, max?: number): Promise<VcsResult<Revision[]>> {
  if (!repoPath.trim()) return fail("Choose a project history folder before reading saved versions.");
  return call<Revision[]>("git_get_history", { repoPath, max });
}

export function compareRaw(repoPath: string, from: string, to: string): Promise<VcsResult<RawDiffEntry[]>> {
  if (!repoPath.trim()) return fail("Set up Project History before comparing versions.");
  return call<RawDiffEntry[]>("git_compare_revisions", { repoPath, from, to });
}

export function readRevisionFiles(repoPath: string, rev: string): Promise<VcsResult<ProjectBundle>> {
  if (!repoPath.trim()) return fail("Set up Project History before reading a saved version.");
  return call<ProjectBundle>("git_read_revision_files", { repoPath, rev });
}

export async function compareChanges(repoPath: string, from: string, to: string): Promise<VcsResult<StructuredDiff>> {
  const before = await readRevisionFiles(repoPath, from);
  if (!before.ok) return before;
  const after = await readRevisionFiles(repoPath, to);
  if (!after.ok) return after;
  try {
    return { ok: true, value: diffProjectBundles(before.value, after.value) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function restoreVersion(
  repoPath: string,
  rev: string,
): Promise<VcsResult<{ outcome: RestoreOutcome; project: PlcProject }>> {
  if (!repoPath.trim()) return fail("Set up Project History before restoring a version.");
  const restored = await call<RestoreOutcome>("git_restore_revision", { repoPath, rev });
  if (!restored.ok) return restored;
  const files = await readRevisionFiles(repoPath, WORKING_COPY);
  if (!files.ok) return files;
  try {
    return { ok: true, value: { outcome: restored.value, project: mergeProjectBundle(files.value) } };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export async function openRevision(repoPath: string, rev: string): Promise<VcsResult<PlcProject>> {
  const files = await readRevisionFiles(repoPath, rev);
  if (!files.ok) return files;
  try {
    return { ok: true, value: mergeProjectBundle(files.value) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export function createWorkCopy(repoPath: string, name: string): Promise<VcsResult<ProjectStatus>> {
  if (!repoPath.trim()) return fail("Set up Project History before creating a work copy.");
  if (!name.trim()) return fail("Name this work copy before creating it.");
  return call<ProjectStatus>("git_create_branch", { repoPath, name: name.trim(), checkout: true });
}

export function switchWorkCopy(repoPath: string, name: string): Promise<VcsResult<ProjectStatus>> {
  if (!repoPath.trim()) return fail("Set up Project History before switching work copies.");
  if (!name.trim()) return fail("Choose a work copy before switching.");
  return call<ProjectStatus>("git_switch_branch", { repoPath, name: name.trim() });
}

export function addRemote(repoPath: string, name: string, url: string): Promise<VcsResult<ProjectStatus>> {
  if (!repoPath.trim()) return fail("Set up Project History before adding a remote.");
  if (!name.trim()) return fail("Name the remote before saving it.");
  if (!url.trim()) return fail("Enter the remote address before saving it.");
  return call<ProjectStatus>("git_add_remote", { repoPath, name: name.trim(), url: url.trim() });
}

export function pushRemote(
  repoPath: string,
  remote: string,
  options: { branch?: string; setUpstream?: boolean } = {},
): Promise<VcsResult<SyncResult>> {
  if (!repoPath.trim()) return fail("Set up Project History before sending versions.");
  if (!remote.trim()) return fail("Add a remote address before sending versions.");
  return call<SyncResult>("git_push_remote", {
    repoPath,
    remote: remote.trim(),
    branch: options.branch,
    setUpstream: options.setUpstream ?? false,
  });
}

export function pullRemote(repoPath: string, remote: string, branch?: string): Promise<VcsResult<SyncResult>> {
  if (!repoPath.trim()) return fail("Set up Project History before syncing this project.");
  if (!remote.trim()) return fail("Add a remote address before syncing this project.");
  return call<SyncResult>("git_pull_remote", { repoPath, remote: remote.trim(), branch });
}

export async function syncProject(repoPath: string, remote: string, branch?: string): Promise<VcsResult<SyncResult>> {
  if (!remote.trim()) return fail("Add a remote address before syncing this project.");
  const pulled = await pullRemote(repoPath, remote, branch);
  if (!pulled.ok) return pulled;
  if (pulled.value.conflicts) return { ok: true, value: pulled.value };
  const pushed = await pushRemote(repoPath, remote, { branch, setUpstream: true });
  if (!pushed.ok) return pushed;
  return {
    ok: true,
    value: {
      ok: true,
      conflicts: false,
      backupBranch: pulled.value.backupBranch,
      message: "Project synced with the remote.",
    },
  };
}
