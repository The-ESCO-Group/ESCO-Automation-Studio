import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  diffProjectBundles,
  splitProjectBundle,
  summarizeStructuredDiff,
  type StructuredChange,
  type StructuredChangeKind,
  type StructuredDiff,
} from "@esco/project-store";
import type { ToastKind } from "../toasts";
import {
  addRemote,
  compareChanges,
  createWorkCopy,
  getHistory,
  getProjectStatus,
  initVersionControl,
  isVersionControlAvailable,
  readRevisionFiles,
  restoreVersion,
  saveVersion,
  selectProjectFolder,
  switchWorkCopy,
  syncProject,
  type ProjectStatus,
  type Revision,
  type VcsResult,
} from "../git-vcs";
import { requestConfirmation } from "../confirmation";
import "./ProjectHistoryView.css";

interface Props {
  project: PlcProject;
  onRestored: (project: PlcProject) => void;
  onToast: (kind: ToastKind, message: string) => void;
}

type DiffRef = { kind: "current" } | { kind: "rev"; id: string; label: string };
type Pending = null | "save" | "branch" | "remote";

const KIND_LABEL: Record<StructuredChangeKind, string> = {
  device: "Device",
  setting: "Setting",
  tag: "Tag",
  routine: "Routine",
  program: "Program",
  alarm: "Alarm",
};

const CHANGE_VERB: Record<StructuredChange["change"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

const repoStorageKey = (projectId: string) => `esco:vcs:repo:${projectId}`;

export function ProjectHistoryView({ project, onRestored, onToast }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [history, setHistory] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [field, setField] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseRef, setBaseRef] = useState<DiffRef>({ kind: "current" });
  const [targetRef, setTargetRef] = useState<DiffRef>({ kind: "current" });
  const [diff, setDiff] = useState<StructuredDiff | null>(null);

  useEffect(() => {
    void isVersionControlAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    try {
      setRepoPath(window.localStorage.getItem(repoStorageKey(project.id)));
    } catch {
      setRepoPath(null);
    }
    setDiff(null);
  }, [project.id]);

  const rememberRepo = useCallback(
    (path: string | null) => {
      setRepoPath(path);
      try {
        if (path) window.localStorage.setItem(repoStorageKey(project.id), path);
        else window.localStorage.removeItem(repoStorageKey(project.id));
      } catch {
        /* best effort */
      }
    },
    [project.id],
  );

  const refresh = useCallback(async (path: string) => {
    setLoadError(null);
    const [statusResult, historyResult] = await Promise.all([getProjectStatus(path), getHistory(path, 100)]);
    if (statusResult.ok) setStatus(statusResult.value);
    else {
      setStatus(null);
      setLoadError(statusResult.error);
    }
    if (historyResult.ok) setHistory(historyResult.value);
    else {
      setHistory([]);
      setLoadError(historyResult.error);
    }
  }, []);

  useEffect(() => {
    if (repoPath) void refresh(repoPath);
    else {
      setStatus(null);
      setHistory([]);
    }
  }, [repoPath, refresh]);

  useEffect(() => {
    if (history.length === 0) {
      setBaseRef({ kind: "current" });
      setTargetRef({ kind: "current" });
      setDiff(null);
      return;
    }
    const head = history[0];
    const latest: DiffRef = { kind: "rev", id: head.id, label: `${head.shortId} - ${head.message}` };
    setBaseRef((current) => {
      if (current.kind === "current") return latest;
      if (!history.some((rev) => rev.id === current.id)) return latest;
      return current;
    });
    setTargetRef((current) => {
      if (current.kind === "rev" && !history.some((rev) => rev.id === current.id)) return { kind: "current" };
      return current;
    });
  }, [history]);

  const guard = useCallback(
    async <T,>(action: () => Promise<VcsResult<T>>, onSuccess: (value: T) => void) => {
      if (busy) {
        onToast("info", "A Project History action is still running.");
        return;
      }
      setBusy(true);
      try {
        const result = await action();
        if (result.ok) onSuccess(result.value);
        else onToast("error", result.error);
      } finally {
        setBusy(false);
      }
    },
    [busy, onToast],
  );

  const handleSetUp = useCallback(() => {
    void guard(
      async () => {
        const folder = await selectProjectFolder();
        if (!folder.ok) return folder;
        if (!folder.value) return { ok: true as const, value: null };
        const init = await initVersionControl(folder.value);
        if (!init.ok) return init;
        rememberRepo(folder.value);
        return { ok: true as const, value: folder.value };
      },
      (path) => {
        if (path) onToast("success", "Project History is set up for this project.");
        else onToast("info", "Choose a project history folder when you are ready to save versions.");
      },
    );
  }, [guard, onToast, rememberRepo]);

  const beginSave = () => {
    setField(`Updated ${project.name}`);
    setPending("save");
  };

  const submitSave = () => {
    if (!repoPath) return onToast("warning", "Set up Project History before saving a version.");
    const message = field.trim();
    if (!message) return onToast("warning", "Describe what changed before saving this version.");
    setPending(null);
    void guard(
      () => saveVersion(repoPath, project, message),
      (revision) => {
        onToast("success", `Saved version "${revision.message}".`);
        void refresh(repoPath);
        setDiff(null);
      },
    );
  };

  const submitBranch = () => {
    if (!repoPath) return onToast("warning", "Set up Project History before creating a work copy.");
    if (!status?.hasCommits) return onToast("warning", "Save a version before creating a work copy.");
    const name = field.trim();
    if (!name) return onToast("warning", "Name this work copy before creating it.");
    setPending(null);
    void guard(
      () => createWorkCopy(repoPath, name),
      (next) => {
        setStatus(next);
        onToast("success", `Created work copy "${next.currentBranch}".`);
        void refresh(repoPath);
      },
    );
  };

  const submitRemote = () => {
    if (!repoPath) return onToast("warning", "Set up Project History before adding a remote.");
    const url = field.trim();
    if (!url) return onToast("warning", "Enter the remote address before saving it.");
    setPending(null);
    void guard(
      () => addRemote(repoPath, "origin", url),
      (next) => {
        setStatus(next);
        onToast("success", "Remote address saved.");
      },
    );
  };

  const handleRestore = async (revision: Revision) => {
    if (!repoPath) return onToast("warning", "Set up Project History before restoring a version.");
    if (
      !(await requestConfirmation({
        title: "Restore Version",
        message: `Restore the project to "${revision.message}" (${revision.shortId})?\n\nYour current work is backed up first.`,
        confirmLabel: "Restore",
        tone: "warning",
      }))
    ) {
      return;
    }
    void guard(
      () => restoreVersion(repoPath, revision.id),
      ({ outcome, project: restored }) => {
        onRestored(restored);
        onToast("success", `Restored "${revision.message}". Backup kept at ${outcome.backupBranch}.`);
        void refresh(repoPath);
        setDiff(null);
      },
    );
  };

  const handleSync = () => {
    if (!repoPath) return onToast("warning", "Set up Project History before syncing this project.");
    if (!status?.hasCommits) return onToast("warning", "Save a version before syncing this project.");
    const remote = status.remotes[0]?.name;
    if (!remote) {
      setAdvancedOpen(true);
      setPending("remote");
      onToast("info", "Add a remote address in Advanced Settings to sync this project.");
      return;
    }
    void guard(
      () => syncProject(repoPath, remote),
      (result) => {
        onToast(result.conflicts ? "warning" : "success", result.message);
        void refresh(repoPath);
      },
    );
  };

  const handleSwitch = (name: string) => {
    if (!repoPath) return onToast("warning", "Set up Project History before switching work copies.");
    if (!status?.hasCommits) return onToast("warning", "Save a version before switching work copies.");
    void guard(
      () => switchWorkCopy(repoPath, name),
      (next) => {
        setStatus(next);
        onToast("success", `Switched to work copy "${next.currentBranch}".`);
        void refresh(repoPath);
      },
    );
  };

  const compareOptions = useMemo<DiffRef[]>(() => {
    return [{ kind: "current" }, ...history.map((rev) => ({ kind: "rev" as const, id: rev.id, label: `${rev.shortId} - ${rev.message}` }))];
  }, [history]);

  const refLabel = (ref: DiffRef) => (ref.kind === "current" ? "Current (unsaved)" : ref.label);
  const refKey = (ref: DiffRef) => (ref.kind === "current" ? "current" : ref.id);
  const findRef = (key: string): DiffRef =>
    key === "current" ? { kind: "current" } : compareOptions.find((opt) => refKey(opt) === key) ?? { kind: "current" };

  const runCompare = async (baseOverride?: DiffRef, targetOverride?: DiffRef) => {
    if (!repoPath) return onToast("warning", "Set up Project History before comparing changes.");
    if (history.length === 0) return onToast("warning", "Save a version before comparing changes.");
    if (busy) return onToast("info", "A Project History action is still running.");

    const latest = history[0];
    let base = baseOverride ?? baseRef;
    const target = targetOverride ?? targetRef;
    if (!baseOverride && latest && base.kind === "current" && target.kind === "current") {
      base = { kind: "rev", id: latest.id, label: `${latest.shortId} - ${latest.message}` };
      setBaseRef(base);
    }

    setBusy(true);
    try {
      const bundleFor = async (ref: DiffRef): Promise<VcsResult<Record<string, string>>> =>
        ref.kind === "current" ? { ok: true, value: splitProjectBundle(project) } : readRevisionFiles(repoPath, ref.id);
      if (base.kind === "rev" && target.kind === "rev") {
        const result = await compareChanges(repoPath, base.id, target.id);
        if (result.ok) setDiff(result.value);
        else onToast("error", result.error);
        return;
      }
      const before = await bundleFor(base);
      if (!before.ok) return onToast("error", before.error);
      const after = await bundleFor(target);
      if (!after.ok) return onToast("error", after.error);
      setDiff(diffProjectBundles(before.value, after.value));
    } finally {
      setBusy(false);
    }
  };

  const canCompare = history.length > 0 && !busy;
  const canCreateWorkCopy = Boolean(status?.hasCommits) && !busy;
  const canSync = Boolean(status?.hasCommits) && !busy;
  const actionNotice = loadError
    ? loadError
    : !status
      ? "Loading this project's history folder..."
      : history.length === 0
        ? "Save a first version before comparing, restoring, creating work copies, or syncing."
        : !status.remotes.length
          ? "Sync Project will ask for a remote address before sending versions."
          : null;

  if (available === null) {
    return (
      <div className="esco-vcs">
        <div className="esco-vcs__setup">
          <h2>Project History</h2>
          <p className="esco-vcs__hint">Checking Project History availability...</p>
        </div>
      </div>
    );
  }

  if (available === false) {
    return (
      <div className="esco-vcs">
        <div className="esco-vcs__setup">
          <h2>Project History</h2>
          <p className="esco-vcs__hint">
            Project History keeps saved versions of your project and lets you compare and restore them. It runs in the ESCO Automation Studio
            desktop app with version control installed.
          </p>
        </div>
      </div>
    );
  }

  if (!repoPath) {
    return (
      <div className="esco-vcs">
        <div className="esco-vcs__setup">
          <h2>Project History</h2>
          <p className="esco-vcs__hint">
            Track saved versions of <strong>{project.name}</strong> in a project folder. Each saved version is a complete, restorable snapshot.
          </p>
          <button type="button" className="esco-btn esco-btn--primary" onClick={handleSetUp} disabled={busy}>
            Set Up Project History...
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="esco-vcs">
      <div className="esco-vcs__bar">
        <div className="esco-vcs__actions">
          <button type="button" className="esco-btn esco-btn--primary" onClick={beginSave} disabled={busy}>
            Save Version
          </button>
          <button type="button" className="esco-btn" onClick={() => void runCompare()} disabled={!canCompare}>
            Compare Changes
          </button>
          <button
            type="button"
            className="esco-btn"
            onClick={() => {
              setField("");
              setPending("branch");
            }}
            disabled={!canCreateWorkCopy}
          >
            Create Work Copy
          </button>
          <button type="button" className="esco-btn" onClick={handleSync} disabled={!canSync}>
            Sync Project
          </button>
        </div>
        <div className="esco-vcs__status">
          <span className="esco-vcs__chip" title="Active work copy">
            {status?.currentBranch || "-"}
          </span>
          {status?.hasUncommittedChanges ? <span className="esco-vcs__chip esco-vcs__chip--dirty">Unsaved changes</span> : null}
          {status?.hasCommits && !status.hasUncommittedChanges ? <span className="esco-vcs__chip esco-vcs__chip--clean">Up to date</span> : null}
        </div>
      </div>

      {actionNotice ? <p className={`esco-vcs__notice${loadError ? " esco-vcs__notice--error" : ""}`}>{actionNotice}</p> : null}

      {pending ? (
        <div className="esco-vcs__inline" role="dialog" aria-label="Version control input">
          <label className="esco-vcs__inline-label" htmlFor="vcs-field">
            {pending === "save" ? "Describe what changed" : pending === "branch" ? "Name this work copy" : "Remote address"}
          </label>
          <input
            id="vcs-field"
            className="esco-vcs__inline-input"
            value={field}
            autoFocus
            placeholder={pending === "remote" ? "https://example.com/project.git" : undefined}
            onChange={(event) => setField(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (pending === "save") submitSave();
                else if (pending === "branch") submitBranch();
                else submitRemote();
              }
            }}
          />
          <button
            type="button"
            className="esco-btn esco-btn--primary"
            onClick={pending === "save" ? submitSave : pending === "branch" ? submitBranch : submitRemote}
            disabled={busy || !field.trim()}
          >
            {pending === "save" ? "Save Version" : pending === "branch" ? "Create" : "Save Remote"}
          </button>
          <button type="button" className="esco-btn" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : null}

      <div className="esco-vcs__body">
        <section className="esco-vcs__timeline" aria-label="Saved versions">
          <header className="esco-panel__header">Saved Versions</header>
          <div className="esco-panel__body">
            {history.length === 0 ? (
              <p className="esco-empty">No versions saved yet. Use "Save Version" to capture the current project.</p>
            ) : (
              <ol className="esco-vcs__revs">
                {history.map((rev) => (
                  <li key={rev.id} className="esco-vcs__rev">
                    <div className="esco-vcs__rev-main">
                      <span className="esco-vcs__rev-msg">{rev.message}</span>
                      <span className="esco-vcs__rev-meta">
                        {rev.shortId} - {rev.authorName} - {formatStamp(rev.timestamp)}
                      </span>
                    </div>
                    <div className="esco-vcs__rev-actions">
                      <button
                        type="button"
                        className="esco-btn esco-btn--ghost"
                        onClick={() => {
                          const base: DiffRef = { kind: "rev", id: rev.id, label: `${rev.shortId} - ${rev.message}` };
                          const target: DiffRef = { kind: "current" };
                          setBaseRef(base);
                          setTargetRef(target);
                          void runCompare(base, target);
                        }}
                        disabled={busy}
                      >
                        Compare to current
                      </button>
                      <button type="button" className="esco-btn esco-btn--ghost" onClick={() => handleRestore(rev)} disabled={busy}>
                        Restore
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="esco-vcs__detail" aria-label="Changes">
          <header className="esco-panel__header">Compare Changes</header>
          <div className="esco-panel__body">
            <div className="esco-vcs__compare-controls">
              <label>
                <span>From</span>
                <select value={refKey(baseRef)} onChange={(event) => setBaseRef(findRef(event.target.value))} disabled={!canCompare}>
                  {compareOptions.map((opt) => (
                    <option key={refKey(opt)} value={refKey(opt)}>
                      {refLabel(opt)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>To</span>
                <select value={refKey(targetRef)} onChange={(event) => setTargetRef(findRef(event.target.value))} disabled={!canCompare}>
                  {compareOptions.map((opt) => (
                    <option key={refKey(opt)} value={refKey(opt)}>
                      {refLabel(opt)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="esco-btn" onClick={() => void runCompare()} disabled={!canCompare}>
                Compare
              </button>
            </div>
            {diff ? (
              <StructuredDiffList diff={diff} />
            ) : history.length === 0 ? (
              <p className="esco-empty">Save a first version to unlock comparison and restore actions.</p>
            ) : (
              <p className="esco-empty">Choose two points to compare, or use "Compare to current" on a saved version.</p>
            )}
          </div>
        </section>
      </div>

      <AdvancedSettings
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((open) => !open)}
        repoPath={repoPath}
        status={status}
        busy={busy}
        onSwitch={handleSwitch}
        onAddRemote={() => {
          setField("");
          setPending("remote");
        }}
        onForget={() => {
          rememberRepo(null);
          onToast("info", "This project is no longer linked to a history folder. Your saved versions remain on disk.");
        }}
      />
    </div>
  );
}

function StructuredDiffList({ diff }: { diff: StructuredDiff }) {
  if (diff.summary.total === 0) return <p className="esco-empty">No engineering changes between these versions.</p>;
  return (
    <div className="esco-vcs__changes">
      <p className="esco-vcs__changes-summary">{summarizeStructuredDiff(diff)}</p>
      <ul>
        {diff.changes.map((change, index) => (
          <li key={`${change.kind}-${change.name}-${index}`} className="esco-vcs__change">
            <span className={`esco-vcs__verb esco-vcs__verb--${change.change}`}>{CHANGE_VERB[change.change]}</span>
            <span className="esco-vcs__kind">{KIND_LABEL[change.kind]}</span>
            <span className="esco-vcs__change-name">{change.name}</span>
            {change.scope ? <span className="esco-vcs__change-scope">in {change.scope}</span> : null}
            {change.fields?.length ? <span className="esco-vcs__change-fields">({change.fields.join(", ")})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface AdvancedProps {
  open: boolean;
  onToggle: () => void;
  repoPath: string;
  status: ProjectStatus | null;
  busy: boolean;
  onSwitch: (name: string) => void;
  onAddRemote: () => void;
  onForget: () => void;
}

function AdvancedSettings({ open, onToggle, repoPath, status, busy, onSwitch, onAddRemote, onForget }: AdvancedProps) {
  return (
    <section className="esco-vcs__advanced">
      <button type="button" className="esco-vcs__advanced-toggle" aria-expanded={open} onClick={onToggle}>
        <span>{open ? "v" : ">"}</span> Advanced Settings (version control internals)
      </button>
      {open ? (
        <div className="esco-vcs__advanced-body">
          <dl className="esco-vcs__kv">
            <dt>Repository (Git)</dt>
            <dd className="esco-vcs__mono">{repoPath}</dd>
            <dt>Current branch</dt>
            <dd>{status?.currentBranch || "-"}</dd>
            <dt>Tracking</dt>
            <dd>{status && (status.ahead || status.behind) ? `${status.ahead} ahead, ${status.behind} behind` : "in sync"}</dd>
          </dl>

          <div className="esco-vcs__advanced-group">
            <span className="esco-vcs__advanced-label">Branches</span>
            {status?.branches.length ? (
              <div className="esco-vcs__chips">
                {status.branches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    className={`esco-vcs__chip esco-vcs__chip--button${branch === status.currentBranch ? " is-active" : ""}`}
                    onClick={() => onSwitch(branch)}
                    disabled={busy || branch === status.currentBranch}
                  >
                    {branch}
                  </button>
                ))}
              </div>
            ) : (
              <p className="esco-vcs__hint">Save a version to create the first work copy.</p>
            )}
          </div>

          <div className="esco-vcs__advanced-group">
            <span className="esco-vcs__advanced-label">Remotes</span>
            {status?.remotes.length ? (
              <ul className="esco-vcs__remotes">
                {status.remotes.map((remote) => (
                  <li key={remote.name}>
                    <span className="esco-vcs__mono">{remote.name}</span> - {remote.url}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="esco-vcs__hint">No remote configured.</p>
            )}
            <button type="button" className="esco-btn" onClick={onAddRemote} disabled={busy}>
              Add / Update Remote (git remote)...
            </button>
          </div>

          {status?.changedFiles.length ? (
            <div className="esco-vcs__advanced-group">
              <span className="esco-vcs__advanced-label">Uncommitted files (raw)</span>
              <ul className="esco-vcs__raw">
                {status.changedFiles.map((file) => (
                  <li key={file.path}>
                    <span className={`esco-vcs__raw-status esco-vcs__raw-status--${file.status}`}>{file.status}</span>
                    <span className="esco-vcs__mono">{file.path}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button type="button" className="esco-btn esco-btn--ghost" onClick={onForget} disabled={busy}>
            Unlink this project from its history folder
          </button>
        </div>
      ) : null}
    </section>
  );
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
