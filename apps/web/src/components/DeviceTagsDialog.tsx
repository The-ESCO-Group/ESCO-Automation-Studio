import { useEffect, useMemo, useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  deviceConnectionView,
  deviceKindLabel,
  planDeviceTags,
  type DeviceKind,
} from "@esco/project-actions";
import { showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface DeviceTagsInput {
  kind: DeviceKind;
  prefix: string;
  scope: "controller" | "program";
  programId?: string;
}

interface Props {
  open: boolean;
  project: PlcProject;
  onClose: () => void;
  onGenerate: (input: DeviceTagsInput) => void;
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

export function DeviceTagsDialog({ open, project, onClose, onGenerate }: Props) {
  const [kind, setKind] = useState<DeviceKind>("motor");
  const [prefix, setPrefix] = useState("");
  const [scope, setScope] = useState<"controller" | "program">("controller");
  const [programId, setProgramId] = useState("");

  const programOptions = useMemo(
    () =>
      project.controllers.flatMap((controller) =>
        controller.programs.map((program) => ({ id: program.id, name: program.name, controllerName: controller.name })),
      ),
    [project],
  );
  const knownTagNames = useMemo(() => {
    const names = new Set<string>();
    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) names.add(tag.name);
      for (const program of controller.programs) for (const tag of program.programTags) names.add(tag.name);
    }
    return names;
  }, [project]);

  useEffect(() => {
    if (!open) return;
    setKind("motor");
    setPrefix("");
    setScope("controller");
    setProgramId(programOptions[0]?.id ?? "");
  }, [open, programOptions]);

  const profile = { kind, prefix: prefix.trim() };
  const planned = useMemo(() => (profile.prefix ? planDeviceTags(profile) : []), [kind, prefix]);
  // Live device → tag → logic connection summary for the typed prefix.
  const connection = useMemo(
    () => (profile.prefix ? deviceConnectionView(project, profile) : null),
    [kind, prefix, project],
  );

  if (!open) return null;

  const validationMessage =
    studioIdentifierError(prefix.trim() || "_", "Device prefix") ??
    (!prefix.trim() ? "Enter a device prefix (e.g. P101)." : undefined) ??
    (scope === "program" && !programId ? "Select a program for program-scoped tags." : undefined);

  const generate = () => {
    if (validationMessage) return;
    onGenerate({ kind, prefix: prefix.trim(), scope, programId: scope === "program" ? programId || undefined : undefined });
  };

  const showHelp = () =>
    showDialogHelp(
      "Generate Device Tags",
      "Pick a vendor-neutral device kind and a tag prefix; ESCO generates the standard controller tags for that device (existing tags are skipped, never overwritten). The preview also shows how many of the device's tags are already used in ladder logic.",
    );

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-program-props" role="dialog" aria-modal="true" aria-label="Generate Device Tags">
        <header className="esco-modal__header">
          <h2>Generate Device Tags</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Generate Device Tags" onClick={onClose} />
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
            <label className="esco-field">
              <span>Scope</span>
              <select value={scope} onChange={(event) => setScope(event.target.value as "controller" | "program")}>
                <option value="controller">Controller</option>
                <option value="program">Program</option>
              </select>
            </label>
            <label className="esco-field">
              <span>Program</span>
              <select value={programId} disabled={scope !== "program"} onChange={(event) => setProgramId(event.target.value)}>
                {programOptions.map((program) => (
                  <option key={program.id} value={program.id}>{program.controllerName}.{program.name}</option>
                ))}
              </select>
            </label>

            <div className="esco-device-tags__preview" aria-label="Planned device tags">
              <strong>Tags to generate ({planned.length})</strong>
              {connection && connection.referenceCount > 0 ? (
                <p className="esco-device-tags__usage">
                  {connection.referenceCount} ladder reference{connection.referenceCount === 1 ? "" : "s"} already use this device's tags.
                </p>
              ) : null}
              <ul className="esco-device-tags__list">
                {planned.map((tag) => {
                  const exists = knownTagNames.has(tag.tagName);
                  return (
                    <li key={tag.tagName} className={exists ? "is-existing" : ""}>
                      <code>{tag.tagName}</code> <span>{tag.dataType}</span>
                      {exists ? <em> (exists — will skip)</em> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={generate}>Generate</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
