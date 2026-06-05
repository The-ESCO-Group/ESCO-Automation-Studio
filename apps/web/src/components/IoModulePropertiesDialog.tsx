import { useEffect, useState } from "react";
import type { Controller, IoModule } from "@esco/core";
import { escoBrandText } from "../branding";
import { deviceImageUrl } from "../device-image-assets";
import type { UpdateIoModuleInput } from "@esco/project-actions";
import {
  findIoDeviceCatalogEntry,
  ioDeviceChannelProfiles,
  ioDeviceKeyingLabel,
  ioDeviceProfileDiagnostics,
  ioDeviceProfileSummary,
  type IoDeviceChannelProfile,
  type IoDeviceProfileDiagnostic,
} from "../io-device-catalog";
import { duplicateNameError, integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export type IoModulePropertiesInput = UpdateIoModuleInput;

interface Props {
  open: boolean;
  controller?: Controller;
  module?: IoModule;
  onClose: () => void;
  onSave: (input: IoModulePropertiesInput, options?: { close?: boolean }) => void;
}

type ModulePropertiesTab = "General" | "Connection" | "Channels" | "Module Info";
type ProfiledIoModule = IoModule & { profileChannels?: IoDeviceChannelProfile[] };

const CHANNEL_FORMAT_OPTIONS = ["BOOL", "Float", "Float + HART", "Integer", "Raw/Proportional", "Engineering Units", "Safety BOOL", "Profile default"] as const;
const ELECTRONIC_KEYING_VALUES = ["ExactMatch", "CompatibleModule", "Disabled"] as const;

function slotLabel(module: IoModule | undefined): string {
  return module?.slot != null ? `Slot ${module.slot}` : "Slot --";
}

function normalizeChannelRows(rows: IoDeviceChannelProfile[] | undefined): IoDeviceChannelProfile[] {
  return (rows ?? []).map((row, index) => ({
    id: row.id || `Ch${index}`,
    label: row.label || `Channel ${index}`,
    direction: row.direction || "Profile",
    signal: row.signal || "Profile default",
    enabled: row.enabled !== false,
    dataFormat: row.dataFormat || "Profile default",
    range: row.range || "Profile-defined",
    diagnostic: row.diagnostic || "Offline profile review only",
  }));
}

function numberFromField(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function normalizeElectronicKeying(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "";
  if (/^disable(?:d| keying)?$/i.test(text) || text === "DisableKeying") return "Disabled";
  if (/^exact match$/i.test(text)) return "ExactMatch";
  if (/^compatible module$/i.test(text)) return "CompatibleModule";
  return text;
}

export function IoModulePropertiesDialog({ open, controller, module, onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<ModulePropertiesTab>("General");
  const [name, setName] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [slot, setSlot] = useState("");
  const [description, setDescription] = useState("");
  const [parentModule, setParentModule] = useState("");
  const [parentPortId, setParentPortId] = useState("");
  const [commPath, setCommPath] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [productCode, setProductCode] = useState("");
  const [majorRevision, setMajorRevision] = useState("");
  const [minorRevision, setMinorRevision] = useState("");
  const [electronicKeying, setElectronicKeying] = useState("");
  const [inhibited, setInhibited] = useState(false);
  const [connectionName, setConnectionName] = useState("");
  const [connectionType, setConnectionType] = useState("");
  const [connectionRpi, setConnectionRpi] = useState("");
  const [connectionPriority, setConnectionPriority] = useState("");
  const [connectionUnicast, setConnectionUnicast] = useState(false);
  const [inputConnectionType, setInputConnectionType] = useState("");
  const [inputProductionTrigger, setInputProductionTrigger] = useState("");
  const [outputRedundantOwner, setOutputRedundantOwner] = useState(false);
  const [channelRows, setChannelRows] = useState<IoDeviceChannelProfile[]>([]);

  useEffect(() => {
    if (!open || !module) return;
    const nextConnection = module.connections?.[0];
    setActiveTab("General");
    setName(module.name);
    setCatalogNumber(module.catalogNumber ?? "");
    setSlot(module.slot != null ? String(module.slot) : "");
    setDescription(module.description ?? "");
    setParentModule(module.parentModule ?? "");
    setParentPortId(module.parentPortId ?? "");
    setCommPath(module.commPath ?? "");
    setVendor(escoBrandText(module.vendor ?? ""));
    setProductType(escoBrandText(module.productType ?? ""));
    setProductCode(module.productCode ?? "");
    setMajorRevision(module.majorRevision ?? "");
    setMinorRevision(module.minorRevision ?? "");
    setElectronicKeying(normalizeElectronicKeying(module.electronicKeying));
    setInhibited(module.inhibited === true);
    setConnectionName(nextConnection?.name ?? "");
    setConnectionType(nextConnection?.type ?? "");
    setConnectionRpi(nextConnection?.rpi != null ? String(nextConnection.rpi) : "");
    setConnectionPriority(nextConnection?.priority ?? "");
    setConnectionUnicast(nextConnection?.unicast === true);
    setInputConnectionType(nextConnection?.inputConnectionType ?? "");
    setInputProductionTrigger(nextConnection?.inputProductionTrigger ?? "");
    setOutputRedundantOwner(nextConnection?.outputRedundantOwner === true);
    setChannelRows(
      normalizeChannelRows((module as ProfiledIoModule).profileChannels).length
        ? normalizeChannelRows((module as ProfiledIoModule).profileChannels)
        : ioDeviceChannelProfiles(findIoDeviceCatalogEntry(module)),
    );
  }, [module, open]);

  if (!open || !controller || !module) return null;
  const catalogEntry = findIoDeviceCatalogEntry(module);
  const profileSummary = catalogEntry ? ioDeviceProfileSummary(catalogEntry) : undefined;
  const moduleImageUrl = deviceImageUrl(
    catalogEntry ?? {
      catalogNumber: catalogNumber || module.catalogNumber,
      productType: productType || module.productType,
      label: module.name,
      vendor: vendor || module.vendor,
      dataDirection: connectionType,
    },
  );
  const connectionRpiNumber = numberFromField(connectionRpi);
  const slotNumber = Number(slot.trim());
  const normalizedParent = parentModule.trim();
  const normalizedParentPort = parentPortId.trim();
  const slotConflict =
    slot.trim() && Number.isInteger(slotNumber)
      ? controller.ioConfiguration.modules.some(
          (candidate) =>
            candidate.id !== module.id &&
            candidate.slot === slotNumber &&
            (candidate.parentModule ?? "") === normalizedParent &&
            (candidate.parentPortId ?? "") === normalizedParentPort,
        )
      : false;
  const keyingRequiresRevision = electronicKeying === "ExactMatch" || electronicKeying === "CompatibleModule";
  const validationMessage =
    studioIdentifierError(name, "Module") ??
    duplicateNameError(name, controller.ioConfiguration.modules.map((candidate) => candidate.name), "Module", module.name) ??
    integerFieldError(slot, "Slot", { required: false, min: 0 }) ??
    (slotConflict ? `Slot ${slotNumber} is already used at this I/O location.` : undefined) ??
    (keyingRequiresRevision && !majorRevision.trim() ? "Major revision is required when electronic keying is enabled." : undefined) ??
    integerFieldError(majorRevision, "Major revision", { required: false, min: 1 }) ??
    (keyingRequiresRevision && !minorRevision.trim() ? "Minor revision is required when electronic keying is enabled." : undefined) ??
    integerFieldError(minorRevision, "Minor revision", { required: false, min: 0 }) ??
    (!electronicKeying.trim() || ELECTRONIC_KEYING_VALUES.includes(electronicKeying as (typeof ELECTRONIC_KEYING_VALUES)[number])
      ? undefined
      : "Electronic keying must be Exact Match, Compatible Module, or Disable Keying.") ??
    integerFieldError(connectionRpi, "RPI", { required: Boolean(connectionName.trim() || connectionType.trim() || catalogEntry?.connection), min: 1 });
  const profileDiagnostics = ioDeviceProfileDiagnostics(catalogEntry, {
    majorRevision,
    minorRevision,
    electronicKeying,
    rpi: connectionName.trim() || connectionType.trim() || catalogEntry?.connection ? connectionRpiNumber : undefined,
    slot: Number.isFinite(slotNumber) ? slotNumber : undefined,
    slotConflict,
  });
  const rpiMsLabel = connectionRpiNumber != null ? `${connectionRpiNumber / 1000} ms` : "Not set";
  const showHelp = () =>
    showDialogHelp(
      "Module Properties",
      "OK saves module identity, connection, revision, keying, and inhibit metadata and closes. Apply saves without closing. Cancel discards unapplied edits. Slot conflicts and invalid RPI values are guarded before writing the offline project model.",
    );

  const updateChannelRow = (id: string, patch: Partial<IoDeviceChannelProfile>) => {
    setChannelRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const renderProfileDiagnostics = (rows: IoDeviceProfileDiagnostic[] = profileDiagnostics) => (
    <table className="esco-detail__table" aria-label="Offline profile diagnostics">
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.label}-${row.detail}`}>
            <th>{row.status.toUpperCase()}</th>
            <td>
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const buildInput = (): IoModulePropertiesInput => {
    const input: IoModulePropertiesInput & { profileChannels?: IoDeviceChannelProfile[] } = {
      controllerId: controller.id,
      moduleId: module.id,
      name: name.trim(),
      catalogNumber: catalogNumber.trim(),
      slot: slot.trim() ? Number(slot) : undefined,
      description: description.trim(),
      parentModule: parentModule.trim(),
      parentPortId: parentPortId.trim(),
      commPath: commPath.trim(),
      vendor: vendor.trim(),
      productType: productType.trim(),
      productCode: productCode.trim(),
      majorRevision: majorRevision.trim(),
      minorRevision: minorRevision.trim(),
      electronicKeying: normalizeElectronicKeying(electronicKeying),
      inhibited,
      connection: {
        name: connectionName.trim(),
        type: connectionType.trim(),
        rpi: connectionRpi.trim() ? Number(connectionRpi) : undefined,
        priority: connectionPriority.trim(),
        unicast: connectionUnicast,
        inputConnectionType: inputConnectionType.trim(),
        inputProductionTrigger: inputProductionTrigger.trim(),
        outputRedundantOwner,
      },
      profileChannels: channelRows,
    };
    return input;
  };

  return (
    <div className="esco-modal" role="presentation">
      <section className="esco-modal__panel esco-iomodule-dialog" role="dialog" aria-modal="true" aria-label="Module Properties">
        <header className="esco-modal__header">
          <h2>Module Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Module Properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Module property tabs">
          {(["General", "Connection", "Channels", "Module Info"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "is-active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "General" ? (
          <div className="esco-routine-props__body">
            <aside className="esco-routine-props__identity" aria-label="Module identity">
              <img className="esco-iomodule-dialog__image" src={moduleImageUrl} alt="" aria-hidden="true" />
              <strong>{catalogNumber || "Module"}</strong>
              <small>{slotLabel(module)}</small>
            </aside>

            <div className="esco-routine-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Catalog Number</span>
                <input value={catalogNumber} spellCheck={false} onChange={(event) => setCatalogNumber(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Slot</span>
                <input value={slot} inputMode="numeric" spellCheck={false} onChange={(event) => setSlot(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Parent Module</span>
                <input value={parentModule} spellCheck={false} onChange={(event) => setParentModule(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Parent Port</span>
                <input value={parentPortId} spellCheck={false} onChange={(event) => setParentPortId(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Comm Path</span>
                <input value={commPath} spellCheck={false} onChange={(event) => setCommPath(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Description</span>
                <textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input type="checkbox" checked={inhibited} onChange={(event) => setInhibited(event.target.checked)} />
                  Inhibit Module
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {activeTab === "Connection" ? (
          <div className="esco-program-props__pane">
            <table className="esco-detail__table" aria-label="Connection profile summary">
              <tbody>
                <tr><th>Profile</th><td>{profileSummary?.connection ?? "Imported/offline connection metadata"}</td></tr>
                <tr><th>RPI</th><td>{connectionRpiNumber != null ? `${connectionRpiNumber} us (${rpiMsLabel})` : "Not set"}</td></tr>
                <tr><th>Keying</th><td>{ioDeviceKeyingLabel(electronicKeying)}</td></tr>
                <tr><th>Revision</th><td>{[majorRevision, minorRevision].filter(Boolean).join(".") || "Not specified"}</td></tr>
                <tr><th>Slot Review</th><td>{slotConflict ? `Slot ${slotNumber} is already used at this I/O location.` : slot || "No slot assigned"}</td></tr>
                <tr><th>Controller connection</th><td>Offline metadata only; no module connection is opened.</td></tr>
              </tbody>
            </table>
            <div className="esco-program-props__grid">
              <label className="esco-field">
                <span>Name</span>
                <input value={connectionName} spellCheck={false} onChange={(event) => setConnectionName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Type</span>
                <input value={connectionType} spellCheck={false} onChange={(event) => setConnectionType(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>RPI (us)</span>
                <input value={connectionRpi} inputMode="numeric" spellCheck={false} onChange={(event) => setConnectionRpi(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Priority</span>
                <input value={connectionPriority} spellCheck={false} onChange={(event) => setConnectionPriority(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Input Type</span>
                <input value={inputConnectionType} spellCheck={false} onChange={(event) => setInputConnectionType(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Trigger</span>
                <input value={inputProductionTrigger} spellCheck={false} onChange={(event) => setInputProductionTrigger(event.target.value)} />
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input type="checkbox" checked={connectionUnicast} onChange={(event) => setConnectionUnicast(event.target.checked)} />
                  Use Unicast Connection
                </span>
              </label>
              <label className="esco-check-field">
                <span />
                <span>
                  <input
                    type="checkbox"
                    checked={outputRedundantOwner}
                    onChange={(event) => setOutputRedundantOwner(event.target.checked)}
                  />
                  Output Redundant Owner
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {activeTab === "Channels" ? (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__list">
              <strong>Channel Configuration</strong>
              <span>
                {channelRows.length
                  ? `${channelRows.length} profile channel${channelRows.length === 1 ? "" : "s"} available for offline review/edit`
                  : "No profile channel table is available for this module."}
                <small>{profileSummary?.channels ?? "Imported/offline module metadata"}</small>
              </span>
            </div>
            {channelRows.length ? (
              <table className="esco-new-module__table" aria-label="Profile channel configuration">
                <thead>
                  <tr>
                    <th>Use</th>
                    <th>Channel</th>
                    <th>Direction</th>
                    <th>Signal</th>
                    <th>Data Format</th>
                    <th>Range / Mode</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${row.label} enabled`}
                          checked={row.enabled}
                          onChange={(event) => updateChannelRow(row.id, { enabled: event.target.checked })}
                        />
                      </td>
                      <td><strong>{row.label}</strong></td>
                      <td>{row.direction}</td>
                      <td>{row.signal}</td>
                      <td>
                        <select
                          aria-label={`${row.label} data format`}
                          value={row.dataFormat}
                          onChange={(event) => updateChannelRow(row.id, { dataFormat: event.target.value })}
                        >
                          {CHANNEL_FORMAT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`${row.label} range`}
                          value={row.range}
                          spellCheck={false}
                          onChange={(event) => updateChannelRow(row.id, { range: event.target.value })}
                        />
                      </td>
                      <td>{row.enabled ? row.diagnostic : "Disabled in offline profile"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {renderProfileDiagnostics()}
          </div>
        ) : null}

        {activeTab === "Module Info" ? (
          <div className="esco-program-props__pane">
            <div className="esco-program-props__grid">
              <label className="esco-field">
                <span>Vendor</span>
                <input value={vendor} spellCheck={false} onChange={(event) => setVendor(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Product Type</span>
                <input value={productType} spellCheck={false} onChange={(event) => setProductType(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Product Code</span>
                <input value={productCode} spellCheck={false} onChange={(event) => setProductCode(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Major Rev</span>
                <input value={majorRevision} spellCheck={false} onChange={(event) => setMajorRevision(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Minor Rev</span>
                <input value={minorRevision} spellCheck={false} onChange={(event) => setMinorRevision(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Electronic Keying</span>
                <select value={electronicKeying} onChange={(event) => setElectronicKeying(event.target.value)}>
                  <option value="">Not Specified</option>
                  <option value="ExactMatch">Exact Match</option>
                  <option value="CompatibleModule">Compatible Module</option>
                  <option value="Disabled">Disable Keying</option>
                </select>
              </label>
              <div className="esco-program-props__list">
                <strong>Ports</strong>
                {module.ports?.length ? (
                  module.ports.map((port, index) => (
                    <span key={`${port.id ?? "port"}-${index}`}>
                      {port.id ?? `Port ${index + 1}`}<small>{port.type ?? port.address ?? "Module Port"}</small>
                    </span>
                  ))
                ) : (
                  <span>No port metadata<small>Not available</small></span>
                )}
              </div>
              <div className="esco-program-props__list">
                <strong>Profile Status</strong>
                <span>
                  {profileSummary?.profile ?? "Imported module profile"}
                  <small>{profileSummary?.configuration ?? "Catalog match unavailable"}</small>
                </span>
              </div>
            </div>
            {renderProfileDiagnostics()}
          </div>
        ) : null}

        <footer className="esco-modal__footer">
          {validationMessage ? <p className="esco-dialog-validation" role="alert">{validationMessage}</p> : null}
          <div className="esco-modal__actions">
            <button type="button" className="esco-btn esco-btn--primary" disabled={!!validationMessage} onClick={() => onSave(buildInput(), { close: true })}>OK</button>
            <button type="button" className="esco-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="esco-btn" disabled={!!validationMessage} onClick={() => onSave(buildInput(), { close: false })}>Apply</button>
            <button type="button" className="esco-btn" onClick={showHelp}>Help</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
