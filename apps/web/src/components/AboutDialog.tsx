import { escoCapabilityCounts } from "../escoCapabilityMap";
import type { FilePolicyInfo } from "./FilePolicyDialog";
import { HelpPanel } from "./HelpPanel";
import "./AboutDialog.css";

export type AboutDialogMode = "about" | "help";

/** Kept in step with apps/web/package.json `version`. */
const APP_VERSION = "0.0.1";

interface Props {
  open: boolean;
  mode: AboutDialogMode;
  /** The most recent unsupported-format import blocked this session, if any. */
  lastBlockedImport?: FilePolicyInfo | null;
  onClose: () => void;
}

/**
 * Help Contents / About surface as a self-contained modal. The IDE shell no longer
 * keeps an always-mounted right inspector, so the Help menu opens its safety and
 * capability notes here rather than depending on a docked panel being present.
 */
export function AboutDialog({ open, mode, lastBlockedImport, onClose }: Props) {
  if (!open) return null;

  const counts = escoCapabilityCounts();
  const runnableOffline = counts.implemented + counts["simulation-only"];
  const reviewOnly = counts["model-only"] + counts["review-only"];
  const title = mode === "about" ? "About ESCO Automation Studio" : "Help Contents";

  return (
    <div className="esco-modal" role="presentation">
      <section
        className="esco-modal__panel esco-about"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="esco-modal__header">
          <h2>{title}</h2>
          <button type="button" className="esco-icon-btn" aria-label={`Close ${title}`} onClick={onClose} />
        </header>

        <div className="esco-about__body">
          {mode === "about" ? (
            <div className="esco-about__identity">
              <strong>ESCO Automation Studio</strong>
              <span>Offline engineering workstation · Version {APP_VERSION}</span>
              <p>
                Reads and edits ESCO-native automation project models locally and never communicates
                with a real physical controller. {runnableOffline} implemented or simulation-only
                areas, {counts.partial} partial areas, {reviewOnly} model/review-only areas,{" "}
                {counts.planned} planned area, and {counts.unsupported} unsupported hardware or
                native-format areas. Verify all generated logic in a sandbox project before any
                production use.
              </p>
            </div>
          ) : null}

          <section className="esco-about__file-policy" aria-label="File policy">
            <strong>File policy</strong>
            <p>
              ESCO Automation Studio is offline-safe and blocks proprietary binary controller-project
              files. The primary workflow is ESCO-native project/runtime files; <strong>L5X (XML)</strong>{" "}
              remains a legacy review interchange only.
            </p>
            {lastBlockedImport ? (
              <p className="esco-about__file-policy-blocked" role="status">
                Last blocked unsupported import this session:{" "}
                {new Date(lastBlockedImport.detectedAt).toLocaleString()}.
              </p>
            ) : null}
          </section>

          <HelpPanel />
        </div>

        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
