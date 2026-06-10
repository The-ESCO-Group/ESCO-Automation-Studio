import { useEffect, useMemo, useState } from "react";
import type { PlcProject } from "@esco/core";
import { deviceConnectionView, deviceKindLabel, type DeviceKind } from "@esco/project-actions";
import { showDialogHelp } from "./dialogValidation";

interface Props {
  open: boolean;
  project: PlcProject;
  onClose: () => void;
  /** Jump to a tag's cross-reference results (reuses the references dock). */
  onOpenTagReferences?: (tagName: string) => void;
}

const DEVICE_KINDS: DeviceKind[] = [
  "motor",
  "vfd",
  "valve",
  "flow-meter",
  "level-transmitter",
  "temperature-sensor",
  "discrete-sensor",
  "analog-sensor",
];

/**
 * Read-only "what logic uses this device" panel. For a device kind + prefix it
 * lists every device tag and each place it is referenced in ladder logic
 * (routine / rung / instruction / read-write), plus the device's unused tags —
 * the full {@link deviceConnectionView}, not just a count.
 */
export function DeviceConnectionsDialog({ open, project, onClose, onOpenTagReferences }: Props) {
  const [kind, setKind] = useState<DeviceKind>("motor");
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind("motor");
    setPrefix("");
  }, [open]);

  const view = useMemo(
    () => (prefix.trim() ? deviceConnectionView(project, { kind, prefix: prefix.trim() }) : null),
    [kind, prefix, project],
  );

  if (!open) return null;

  const showHelp = () =>
    showDialogHelp(
      "Device Connections",
      "Enter a device kind and prefix to see every tag that device owns and where each is used in ladder logic (routine, rung, instruction, read/write). Tags with no references are listed as unused.",
    );

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="Device Connections">
        <header className="esco-modal__header">
          <h2>Device Connections</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Device Connections" onClick={onClose} />
        </header>

        <div className="esco-routine-props__body">
          <aside className="esco-routine-props__identity" aria-label="Device identity">
            <span className="esco-tag-props__icon" aria-hidden="true" />
            <strong>Device</strong>
            <small>{deviceKindLabel(kind)}</small>
          </aside>

          <div className="esco-routine-props__fields">
            <label className="esco-field">
              <span>Device Kind</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as DeviceKind)}>
                {DEVICE_KINDS.map((option) => (
                  <option key={option} value={option}>{deviceKindLabel(option)}</option>
                ))}
              </select>
            </label>
            <label className="esco-field">
              <span>Prefix</span>
              <input
                value={prefix}
                placeholder="e.g. P101"
                spellCheck={false}
                autoFocus
                onChange={(event) => setPrefix(event.target.value)}
              />
            </label>

            <div className="esco-device-conn" aria-label="Device connections">
              {!view ? (
                <p className="esco-device-conn__hint">Enter a device prefix to see its tag-to-logic connections.</p>
              ) : (
                <>
                  <p className="esco-device-conn__summary">
                    {view.tags.length} tag{view.tags.length === 1 ? "" : "s"} · {view.referenceCount} ladder
                    reference{view.referenceCount === 1 ? "" : "s"} · {view.unusedTags.length} unused
                  </p>
                  <ul className="esco-device-conn__list">
                    {view.tags.map((tag) => (
                      <li key={tag.tagName} className={tag.references.length === 0 ? "is-unused" : ""}>
                        <div className="esco-device-conn__tag">
                          {onOpenTagReferences && tag.references.length > 0 ? (
                            <button
                              type="button"
                              className="esco-link-btn"
                              onClick={() => onOpenTagReferences(tag.tagName)}
                              title={`Open cross-reference for ${tag.tagName}`}
                            >
                              <code>{tag.tagName}</code>
                            </button>
                          ) : (
                            <code>{tag.tagName}</code>
                          )}
                          <span className="esco-device-conn__dir">{tag.direction}</span>
                          <span className="esco-device-conn__count">
                            {tag.references.length === 0 ? "unused" : `${tag.references.length} ref${tag.references.length === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        {tag.references.length > 0 ? (
                          <ul className="esco-device-conn__refs">
                            {tag.references.map((ref, index) => (
                              <li key={`${ref.rungId}:${ref.operand}:${index}`}>
                                {ref.instructionType} · {ref.programName}/{ref.routineName} · rung {ref.rungNumber} · {ref.direction}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="esco-modal__footer">
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn" onClick={onClose}>Close</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
