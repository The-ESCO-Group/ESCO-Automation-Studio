import { useEffect, useState } from "react";
import type { BlankRoutineProjectOptions } from "../project-edit";
import { integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (options: BlankRoutineProjectOptions) => void;
}

const CONTROLLERS = [
  { label: "1756-L71 ESCO5571 Controller", catalogNumber: "1756-L71", revision: "32.11" },
  { label: "1756-L81E ESCO5580 Controller", catalogNumber: "1756-L81E", revision: "35.011" },
  { label: "1756-L85E ESCO5580 Controller", catalogNumber: "1756-L85E", revision: "35.011" },
] as const;

const CHASSIS = ["1756-A7", "1756-A10", "1756-A13", "1756-A17"] as const;

export function NewProjectDialog({ open, onClose, onCreate }: Props) {
  const [projectName, setProjectName] = useState("Untitled Project");
  const [description, setDescription] = useState("");
  const [controllerName, setControllerName] = useState("Controller_1");
  const [catalogNumber, setCatalogNumber] = useState<string>(CONTROLLERS[0].catalogNumber);
  const [firmwareRevision, setFirmwareRevision] = useState<string>(CONTROLLERS[0].revision);
  const [chassis, setChassis] = useState("1756-A10");
  const [slot, setSlot] = useState("0");
  const [securityAuthority, setSecurityAuthority] = useState("");

  useEffect(() => {
    if (!open) return;
    setProjectName("Untitled Project");
    setDescription("");
    setControllerName("Controller_1");
    setCatalogNumber(CONTROLLERS[0].catalogNumber);
    setFirmwareRevision(CONTROLLERS[0].revision);
    setChassis("1756-A10");
    setSlot("0");
    setSecurityAuthority("");
  }, [open]);

  if (!open) return null;

  const selectedController = CONTROLLERS.find((controller) => controller.catalogNumber === catalogNumber) ?? CONTROLLERS[0];
  const parsedSlot = Number(slot);
  const validationMessage =
    (!projectName.trim() ? "Project name is required." : undefined) ??
    studioIdentifierError(controllerName, "Controller") ??
    integerFieldError(slot, "Slot", { min: 0 });
  const canCreate = !validationMessage && Number.isFinite(parsedSlot);
  const showHelp = () =>
    showDialogHelp(
      "New Project",
      "OK creates a new offline ESCO project with the selected controller, chassis, slot, revision, and security metadata. Cancel closes without replacing the current project.",
    );
  const create = () => {
    if (!canCreate) return;
    onCreate({
      projectName: projectName.trim(),
      description: description.trim(),
      controllerName: controllerName.trim(),
      catalogNumber,
      firmwareRevision: firmwareRevision.trim(),
      chassis,
      slot: Math.trunc(parsedSlot),
      securityAuthority: securityAuthority.trim(),
    });
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-new-project" role="dialog" aria-modal="true" aria-label="New Project">
        <header className="esco-modal__header">
          <h2>New Project</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close New Project" onClick={onClose} />
        </header>

        <div className="esco-new-project__body">
          <aside className="esco-new-project__types" aria-label="Controller type">
            {CONTROLLERS.map((controller) => (
              <button
                key={controller.catalogNumber}
                type="button"
                className={controller.catalogNumber === catalogNumber ? "is-selected" : ""}
                onClick={() => {
                  setCatalogNumber(controller.catalogNumber);
                  setFirmwareRevision(controller.revision);
                }}
              >
                <span className="esco-new-project__controller-icon" aria-hidden="true" />
                <span>
                  <strong>{controller.catalogNumber}</strong>
                  <small>{controller.label.replace(`${controller.catalogNumber} `, "")}</small>
                </span>
              </button>
            ))}
          </aside>

          <div className="esco-new-project__fields">
            <label className="esco-field">
              <span>Name</span>
              <input value={projectName} spellCheck={false} autoFocus onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Description</span>
              <textarea value={description} rows={3} spellCheck={false} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Controller Name</span>
              <input value={controllerName} spellCheck={false} onChange={(event) => setControllerName(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Type</span>
              <input value={selectedController.label} readOnly />
            </label>
            <label className="esco-field">
              <span>Revision</span>
              <input value={firmwareRevision} spellCheck={false} onChange={(event) => setFirmwareRevision(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Chassis Type</span>
              <select value={chassis} onChange={(event) => setChassis(event.target.value)}>
                {CHASSIS.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </label>
            <label className="esco-field">
              <span>Slot</span>
              <input value={slot} inputMode="numeric" spellCheck={false} onChange={(event) => setSlot(event.target.value)} />
            </label>
            <label className="esco-field">
              <span>Security Authority</span>
              <input value={securityAuthority} spellCheck={false} onChange={(event) => setSecurityAuthority(event.target.value)} />
            </label>
            <div className="esco-new-project__summary">
              <span>Hardware path</span>
              <strong>No hardware path selected; offline slot {Number(slot) || 0}</strong>
            </div>
          </div>
        </div>

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!canCreate} onClick={create}>OK</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
