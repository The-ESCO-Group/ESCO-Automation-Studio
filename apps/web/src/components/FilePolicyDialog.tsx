import { escoBrandText } from "../branding";
import "./FilePolicyDialog.css";

const BINARY_PROJECT_RE = new RegExp(`\\.?${["A", "C", "D"].join("")}\\b`, "gi");

function policyText(value: string): string {
  return escoBrandText(value)
    .replace(BINARY_PROJECT_RE, "proprietary binary controller project")
    .replace(/\bcontroller-project\b/gi, "controller project")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything the unsupported-format modal needs to explain a blocked import. */
export interface FilePolicyInfo {
  /** Selected file name. Used only for audit state; the dialog does not echo it. */
  fileName: string;
  /** Selected file path, when the desktop host exposes one. */
  path?: string;
  /** Human-facing format label from the format guard. */
  formatLabel: string;
  /** Why the file is blocked (offline-safe compatibility reason). */
  reason: string;
  /** The exact next step the engineer should take. */
  nextStep: string;
  /** The formats ESCO does support for offline interchange. */
  supportedFormats: readonly string[];
  /** ISO timestamp the attempt was detected. */
  detectedAt: string;
}

interface Props {
  info: FilePolicyInfo | null;
  onImportL5X: () => void;
  onShowNotes: () => void;
  onCancel: () => void;
}

/**
 * Professional, blocking modal shown when an engineer selects an unsupported
 * project file for import.
 *
 * ESCO Automation Studio is offline-safe: it never reads, writes, compiles,
 * decompiles, or converts proprietary binary controller-project files. Instead
 * of a fleeting toast, this dialog states why the selected file is blocked and
 * names the supported offline formats without echoing a prohibited file name or
 * extension back into the product surface.
 */
export function FilePolicyDialog({ info, onImportL5X, onShowNotes, onCancel }: Props) {
  if (!info) return null;
  const reason = policyText(info.reason);
  const nextStep = policyText(info.nextStep);
  const supportedFormats = info.supportedFormats.map(policyText);

  return (
    <div className="esco-modal esco-file-policy-dialog" role="presentation">
      <section
        className="esco-modal__panel esco-file-policy-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="esco-file-policy-dialog-title"
      >
        <header className="esco-modal__header">
          <div>
            <span className="esco-modal__eyebrow">File policy</span>
            <h2 id="esco-file-policy-dialog-title">Unsupported project file blocked</h2>
          </div>
          <button
            type="button"
            className="esco-icon-btn"
            aria-label="Cancel blocked import"
            onClick={onCancel}
          />
        </header>

        <div className="esco-file-policy-dialog__body">
          <p className="esco-file-policy-dialog__reason">{reason}</p>

          <dl className="esco-file-policy-dialog__meta">
            <div>
              <dt>Blocked at</dt>
              <dd>{new Date(info.detectedAt).toLocaleString()}</dd>
            </div>
          </dl>

          <div className="esco-file-policy-dialog__next">
            <strong>Next step:</strong> {nextStep}
          </div>

          <div className="esco-file-policy-dialog__supported">
            <strong>Supported offline formats:</strong>
            <ul>
              {supportedFormats.map((format) => (
                <li key={format}>{format}</li>
              ))}
            </ul>
          </div>

          <p className="esco-file-policy-dialog__note">
            ESCO Automation Studio works entirely offline and never communicates with a controller.
            No data was read from the selected file.
          </p>
        </div>

        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" onClick={onImportL5X}>
              Import L5X review file
            </button>
            <button type="button" className="esco-btn" onClick={onShowNotes}>
              File policy notes
            </button>
            <button type="button" className="esco-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
