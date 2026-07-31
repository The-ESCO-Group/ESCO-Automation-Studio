import type { CloudProjectSummary } from "../gateway-contract";

interface Props {
  open: boolean;
  busy: boolean;
  projectOpen: boolean;
  activeProjectId?: string;
  activeRevision?: string;
  error?: string;
  projects: CloudProjectSummary[];
  onClose: () => void;
  onRefresh: () => void;
  onSaveCurrent: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

export function CloudProjectsDialog({
  open,
  busy,
  projectOpen,
  activeProjectId,
  activeRevision,
  error,
  projects,
  onClose,
  onRefresh,
  onSaveCurrent,
  onOpenProject,
  onDeleteProject,
}: Props) {
  if (!open) return null;

  return (
    <div className="esco-modal" role="presentation">
      <section
        className="esco-modal__panel esco-cloud-projects"
        role="dialog"
        aria-modal="true"
        aria-labelledby="esco-cloud-projects-title"
      >
        <header className="esco-modal__header">
          <div>
            <span className="esco-modal__eyebrow">Hosted workspace</span>
            <h2 id="esco-cloud-projects-title">Cloud Projects</h2>
            <p>Projects are stored through the ESCO API host with revision checks.</p>
          </div>
          <button type="button" className="esco-icon-btn" aria-label="Close Cloud Projects" onClick={onClose} />
        </header>
        <div className="esco-cloud-projects__body">
          {error ? <div className="esco-cloud-projects__error">{error}</div> : null}
          <div className="esco-cloud-projects__toolbar">
            <button type="button" className="esco-btn esco-btn--primary" onClick={onSaveCurrent} disabled={busy || !projectOpen}>
              Save Current
            </button>
            <button type="button" className="esco-btn" onClick={onRefresh} disabled={busy}>
              Refresh
            </button>
            {activeProjectId ? (
              <span className="esco-cloud-projects__active" title={activeRevision}>
                Active {activeProjectId} {activeRevision ? `(${shortRevision(activeRevision)})` : ""}
              </span>
            ) : null}
          </div>
          <div className="esco-cloud-projects__table-wrap">
            <table className="esco-cloud-projects__table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Saved</th>
                  <th>Model</th>
                  <th>Revision</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.name}</strong>
                        <small>{project.id}</small>
                      </td>
                      <td>{formatDateTime(project.savedAt)}</td>
                      <td>
                        {project.controllerCount} controller(s), {project.routineCount} routine(s), {project.tagCount} tag(s)
                      </td>
                      <td title={project.revision}>{shortRevision(project.revision)}</td>
                      <td>
                        <button type="button" className="esco-btn" onClick={() => onOpenProject(project.id)} disabled={busy}>
                          Open
                        </button>
                        <button type="button" className="esco-btn esco-btn--danger" onClick={() => onDeleteProject(project.id)} disabled={busy}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No hosted projects are stored on this API host.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function shortRevision(revision: string): string {
  const digest = revision.includes(":") ? revision.split(":").pop()! : revision;
  return digest.length > 12 ? digest.slice(0, 12) : digest;
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
