import type { TagCsvImportPreview } from "@esco/project-actions";

interface Props {
  fileName: string;
  preview: TagCsvImportPreview;
  onCancel: () => void;
  onApply: () => void;
}

export function TagCsvPreviewDialog({ fileName, preview, onCancel, onApply }: Props) {
  const canApply = preview.rows.some((row) => row.status !== "error") && preview.errorCount === 0;
  return (
    <div className="esco-modal" role="dialog" aria-modal="true" aria-labelledby="esco-tagcsv-title">
      <section className="esco-modal__panel esco-tagcsv">
        <header className="esco-modal__header">
          <div>
            <span className="esco-modal__eyebrow">Tag CSV import</span>
            <h2 id="esco-tagcsv-title">Preview changes from {fileName}</h2>
            <p>Review the parsed tag rows before applying them through project-actions.</p>
          </div>
          <button type="button" className="esco-icon-btn" aria-label="Close tag CSV preview" onClick={onCancel}>
            x
          </button>
        </header>

        <div className="esco-tagcsv__summary">
          <span className="is-ok">{preview.createCount} create</span>
          <span className="is-info">{preview.updateCount} update</span>
          <span className={preview.errorCount ? "is-error" : "is-muted"}>{preview.errorCount} errors</span>
        </div>

        {preview.warnings.length > 0 ? (
          <ul className="esco-tagcsv__warnings">
            {preview.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <div className="esco-tagcsv__tablewrap">
          <table className="esco-detail__table esco-tagcsv__table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Status</th>
                <th>Name</th>
                <th>Type</th>
                <th>Scope</th>
                <th>Messages</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No tag rows found.</td>
                </tr>
              ) : (
                preview.rows.map((row) => (
                  <tr key={row.line} className={`esco-tagcsv__row--${row.status}`}>
                    <td>{row.line}</td>
                    <td>{row.status}</td>
                    <td>{row.row?.name ?? "-"}</td>
                    <td>{row.row?.dataType ?? "-"}</td>
                    <td>
                      {row.row?.scope ?? "-"}
                      {row.row?.program ? ` / ${row.row.program}` : ""}
                    </td>
                    <td>{row.messages.join("; ") || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="esco-modal__footer">
          <span>
            {canApply
              ? "Ready to apply. Validation will run after import."
              : "Resolve CSV errors before applying."}
          </span>
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="esco-btn esco-btn--primary" disabled={!canApply} onClick={onApply}>
              Apply CSV
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
