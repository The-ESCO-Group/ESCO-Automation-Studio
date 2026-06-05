import { useEffect, useMemo, useState } from "react";
import type { Controller } from "@esco/core";
import { escoBrandText } from "../branding";
import { integerFieldError, showDialogHelp, studioIdentifierError } from "./dialogValidation";

export interface ControllerPropertiesInput {
  controllerId: string;
  name: string;
  processorType?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  chassis?: string;
  slot?: number;
  faultRoutineName?: string;
  powerUpRoutineName?: string;
  commPath?: string;
  commDriver?: string;
}

interface Props {
  open: boolean;
  controller?: Controller;
  projectName: string;
  onClose: () => void;
  onSave: (input: ControllerPropertiesInput, options?: { close?: boolean }) => void;
}

const CONTROLLER_TYPES = [
  { label: "1756-L71 ESCO5571 Controller", catalogNumber: "1756-L71", processorType: "ESCO5571", revision: "32.11" },
  { label: "1756-L81E ESCO5580 Controller", catalogNumber: "1756-L81E", processorType: "ESCO5580", revision: "35.011" },
  { label: "1756-L85E ESCO5580 Controller", catalogNumber: "1756-L85E", processorType: "ESCO5580", revision: "35.011" },
] as const;

const CHASSIS = ["1756-A7", "1756-A10", "1756-A13", "1756-A17"] as const;
const TABS = [
  "General",
  "Major/Minor Faults",
  "Date/Time",
  "Advanced",
  "SFC Execution",
  "Project",
  "Redundancy",
  "Nonvolatile Memory",
  "Capacity",
  "Internet Protocol",
  "Port Configuration",
  "Security",
  "Alarm Log",
] as const;
type TabName = (typeof TABS)[number];

function processorTypeForCatalog(catalogNumber: string, fallback?: string): string {
  if (/L8|558/i.test(catalogNumber)) return "ESCO5580";
  if (/L7|557/i.test(catalogNumber)) return "ESCO5571";
  return escoBrandText(fallback?.trim() || "ESCO5571");
}

function parseSlot(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function displayValue(value: unknown, fallback = "Not configured"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return String(value);
}

function displayFlag(value: unknown): string {
  if (value === true || value === "true" || value === "1" || value === "Enabled") return "Enabled";
  if (value === false || value === "false" || value === "0" || value === "Disabled") return "Disabled";
  return displayValue(value);
}

export function ControllerPropertiesDialog({ open, controller, projectName, onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<TabName>("General");
  const [name, setName] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [firmwareRevision, setFirmwareRevision] = useState("");
  const [chassis, setChassis] = useState("");
  const [slot, setSlot] = useState("0");
  const [faultRoutineName, setFaultRoutineName] = useState("");
  const [powerUpRoutineName, setPowerUpRoutineName] = useState("");
  const [commDriver, setCommDriver] = useState("");
  const [commPath, setCommPath] = useState("");

  useEffect(() => {
    if (!open || !controller) return;
    setActiveTab("General");
    setName(controller.name);
    setCatalogNumber(controller.catalogNumber ?? "1756-L71");
    setFirmwareRevision(controller.firmwareRevision ?? "");
    setChassis(controller.chassis ?? "1756-A10");
    setSlot(controller.slot != null ? String(controller.slot) : "0");
    setFaultRoutineName(controller.faultRoutineName ?? "");
    setPowerUpRoutineName(controller.powerUpRoutineName ?? "");
    setCommDriver(controller.commDriver ?? "Offline Model");
    setCommPath(controller.commPath ?? "");
  }, [controller, open]);

  const selectedType = useMemo(
    () => CONTROLLER_TYPES.find((type) => type.catalogNumber === catalogNumber),
    [catalogNumber],
  );
  const processorType = processorTypeForCatalog(catalogNumber, controller?.processorType);
  const computedPath = `Offline Model\\Local Backplane\\Slot ${parseSlot(slot) ?? 0}`;

  if (!open || !controller) return null;
  const validationMessage =
    studioIdentifierError(name, "Controller") ??
    (!catalogNumber.trim() ? "Controller type is required." : undefined) ??
    integerFieldError(slot, "Slot", { min: 0 });
  const showHelp = () =>
    showDialogHelp(
      "Controller Properties",
      "OK saves controller identity, processor, chassis, slot, and handler metadata and closes. Apply saves without closing. Cancel discards unapplied edits. These are offline project edits until a verified controller transport exists.",
    );

  const buildInput = (): ControllerPropertiesInput => ({
      controllerId: controller.id,
      name,
      processorType,
      catalogNumber,
      firmwareRevision,
      chassis,
      slot: parseSlot(slot),
      faultRoutineName: faultRoutineName.trim() || undefined,
      powerUpRoutineName: powerUpRoutineName.trim() || undefined,
      commDriver: commDriver.trim() || undefined,
      commPath: commPath.trim() || undefined,
    });
  const propertyRow = (label: string, value: unknown) => (
    <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>
  );
  const propertyGroup = (title: string, rows: Array<ReturnType<typeof propertyRow>>) => (
    <div className="esco-controller-props__group" key={title}>
      <h3>{title}</h3>
      <dl>{rows}</dl>
    </div>
  );
  const attributeRows = (attributes: Record<string, string> | undefined) =>
    Object.entries(attributes ?? {}).map(([key, value]) => propertyRow(key, value));
  const renderReadOnlyPane = (groups: Array<ReturnType<typeof propertyGroup>>) => (
    <div className="esco-controller-props__pane">
      <div className="esco-controller-props__stack">
        {groups}
      </div>
    </div>
  );
  const renderActiveTab = () => {
    switch (activeTab) {
      case "General":
        return (
          <div className="esco-controller-props__body">
            <aside className="esco-controller-props__identity" aria-label="Controller identity">
              <span className="esco-controller-props__cpu-icon" aria-hidden="true" />
              <strong>{catalogNumber || "Controller"}</strong>
              <small>{processorType}</small>
            </aside>

            <div className="esco-controller-props__fields">
              <label className="esco-field">
                <span>Name</span>
                <input value={name} spellCheck={false} autoFocus onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Project</span>
                <input value={projectName} readOnly />
              </label>
              <label className="esco-field">
                <span>Type</span>
                <select
                  value={catalogNumber}
                  onChange={(event) => {
                    const type = CONTROLLER_TYPES.find((candidate) => candidate.catalogNumber === event.target.value);
                    setCatalogNumber(event.target.value);
                    if (type) setFirmwareRevision(type.revision);
                  }}
                >
                  {CONTROLLER_TYPES.map((type) => (
                    <option key={type.catalogNumber} value={type.catalogNumber}>
                      {type.label}
                    </option>
                  ))}
                  {!selectedType ? (
                    <option value={catalogNumber}>{catalogNumber || "Custom controller"}</option>
                  ) : null}
                </select>
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
                  {!CHASSIS.includes(chassis as (typeof CHASSIS)[number]) ? (
                    <option value={chassis}>{chassis || "Custom chassis"}</option>
                  ) : null}
                </select>
              </label>
              <label className="esco-field">
                <span>Slot</span>
                <input value={slot} inputMode="numeric" spellCheck={false} onChange={(event) => setSlot(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Driver</span>
                <input
                  value={commDriver}
                  spellCheck={false}
                  placeholder="Offline Model"
                  onChange={(event) => setCommDriver(event.target.value)}
                />
              </label>
              <label className="esco-field">
                <span>Path (offline metadata)</span>
                <input
                  value={commPath}
                  spellCheck={false}
                  placeholder={computedPath}
                  onChange={(event) => setCommPath(event.target.value)}
                />
              </label>
              <label className="esco-field">
                <span>Fault Handler</span>
                <input value={faultRoutineName} spellCheck={false} onChange={(event) => setFaultRoutineName(event.target.value)} />
              </label>
              <label className="esco-field">
                <span>Power-Up Handler</span>
                <input value={powerUpRoutineName} spellCheck={false} onChange={(event) => setPowerUpRoutineName(event.target.value)} />
              </label>
            </div>
          </div>
        );
      case "Major/Minor Faults":
        return renderReadOnlyPane([
          propertyGroup("Major Faults", [
            propertyRow("Controller Fault Handler", faultRoutineName),
            propertyRow("Power-Up Handler", powerUpRoutineName),
            propertyRow("Major fault program", controller.faultRoutineName),
          ]),
          propertyGroup("Minor Faults", [
            propertyRow("Report Minor Overflow", displayFlag(controller.reportMinorOverflow)),
            propertyRow("Arithmetic overflow minor fault", displayFlag(controller.reportMinorOverflow)),
          ]),
        ]);
      case "Date/Time":
        return renderReadOnlyPane([
          propertyGroup("Wall Clock Time", [
            propertyRow("Local Time Adjustment", controller.wallClockTime?.localTimeAdjustment),
            propertyRow("Time Zone", controller.wallClockTime?.timeZone),
          ]),
          propertyGroup("Time Synchronization", [
            propertyRow("PTP Enable", displayFlag(controller.timeSync?.ptpEnable)),
            propertyRow("Priority 1", controller.timeSync?.priority1),
            propertyRow("Priority 2", controller.timeSync?.priority2),
            propertyRow("CST Master", controller.cst?.masterId),
          ]),
        ]);
      case "Advanced":
        return renderReadOnlyPane([
          propertyGroup("System Overhead", [
            propertyRow("System Overhead Time Slice", controller.timeSlice ?? "20"),
            propertyRow("Share Unused Time Slice", displayFlag(controller.shareUnusedTimeSlice ?? "Enabled")),
          ]),
          propertyGroup("Controller Matching", [
            propertyRow("Match Project to Controller", displayFlag(controller.matchProjectToController)),
            propertyRow("Project Serial Number", controller.projectSN),
            propertyRow("Inhibit Automatic Firmware Update", displayFlag(controller.inhibitAutomaticFirmwareUpdate)),
            propertyRow("Use RPI From Producer", displayFlag(controller.canUseRPIFromProducer ?? controller.canUseRPIFromController)),
          ]),
        ]);
      case "SFC Execution":
        return renderReadOnlyPane([
          propertyGroup("SFC Execution", [
            propertyRow("Execution Control", controller.sfcExecutionControl ?? "CurrentActive"),
            propertyRow("Restart Position", controller.sfcRestartPosition ?? "MostRecent"),
            propertyRow("Last Scan", controller.sfcLastScan ?? "DontScan"),
          ]),
        ]);
      case "Project":
        return renderReadOnlyPane([
          propertyGroup("Project Documentation", [
            propertyRow("Current Project Language", controller.currentProjectLanguage),
            propertyRow("Default Project Language", controller.defaultProjectLanguage),
            propertyRow("Controller Language", controller.controllerLanguage),
            propertyRow("Pass Through Configuration", controller.passThroughConfiguration),
            propertyRow("Download Project Documentation", displayFlag(controller.downloadProjectDocumentationAndExtendedProperties)),
            propertyRow("Download Custom Properties", displayFlag(controller.downloadProjectCustomProperties)),
          ]),
          propertyGroup("Source L5X", [
            propertyRow("Software Revision", controller.softwareRevision),
            propertyRow("Owner", controller.exportOwner),
            propertyRow("Export Date", controller.exportDate),
            propertyRow("Contains Context", displayFlag(controller.containsContext)),
            propertyRow("Export Options", controller.exportOptions),
          ]),
        ]);
      case "Redundancy":
        return renderReadOnlyPane([
          propertyGroup("Redundancy", [
            propertyRow("Enabled", displayFlag(controller.redundancyInfo?.enabled)),
            propertyRow("Keep Test Edits On Switchover", displayFlag(controller.redundancyInfo?.keepTestEditsOnSwitchOver)),
            propertyRow("I/O Memory Pad Percentage", controller.redundancyInfo?.ioMemoryPadPercentage),
            propertyRow("Data Table Pad Percentage", controller.redundancyInfo?.dataTablePadPercentage),
            propertyRow("Front Port Crossload Ports", controller.redundancyInfo?.frontPortCrossloadEnabledPorts),
            propertyRow("Front Port Crossload Security", displayFlag(controller.redundancyInfo?.frontPortCrossloadSecurityEnabled)),
          ]),
        ]);
      case "Nonvolatile Memory":
        return renderReadOnlyPane([
          propertyGroup("Nonvolatile Memory", [
            propertyRow("Load Image", "Not configured"),
            propertyRow("Store Image", "Not configured"),
            propertyRow("Load Mode", "User Initiated"),
            propertyRow("Firmware Supervisor", displayFlag(controller.inhibitAutomaticFirmwareUpdate ? false : undefined)),
          ]),
        ]);
      case "Capacity":
        return renderReadOnlyPane([
          propertyGroup("Project Capacity", [
            propertyRow("Tasks", controller.tasks.length),
            propertyRow("Programs", controller.programs.length),
            propertyRow("Routines", controller.programs.reduce((sum, program) => sum + program.routines.length, 0)),
            propertyRow("Controller Tags", controller.controllerTags.length),
            propertyRow("Program Tags", controller.programs.reduce((sum, program) => sum + program.programTags.length, 0)),
            propertyRow("Data Types", controller.dataTypes.length),
            propertyRow("Add-On Instructions", controller.addOnInstructions.length),
            propertyRow("I/O Modules", controller.ioConfiguration.modules.length),
            propertyRow("Trends", controller.trends?.length ?? 0),
            propertyRow("Quick Watch Lists", controller.quickWatchLists?.length ?? 0),
          ]),
        ]);
      case "Internet Protocol": {
        const protocolRows = attributeRows(controller.ethernetConfig?.internetProtocol?.attributes);
        const networkRows = attributeRows(controller.ethernetConfig?.network?.attributes);
        return renderReadOnlyPane([
          propertyGroup("Internet Protocol", protocolRows.length ? protocolRows : [propertyRow("Configuration", "Not configured")]),
          propertyGroup("Ethernet Network", networkRows.length ? networkRows : [propertyRow("Network", "Not configured")]),
        ]);
      }
      case "Port Configuration":
        return renderReadOnlyPane([
          propertyGroup("Ethernet Ports", controller.ethernetConfig?.ports.length
            ? controller.ethernetConfig.ports.map((port) => propertyRow(port.id, Object.entries(port.attributes).map(([key, value]) => `${key}: ${value}`).join(", ")))
            : [propertyRow("Ports", "Not configured")]),
          propertyGroup("Serial Ports", controller.commPorts?.serialPorts.length
            ? controller.commPorts.serialPorts.map((port) => propertyRow(port.id, port.description ?? Object.entries(port.attributes).map(([key, value]) => `${key}: ${value}`).join(", ")))
            : [propertyRow("Serial Port", "Not configured")]),
        ]);
      case "Security":
        return renderReadOnlyPane([
          propertyGroup("Security", [
            propertyRow("Security Authority", controller.security?.securityAuthorityName ?? controller.security?.securityAuthorityId),
            propertyRow("Source Protection Code", controller.security?.code),
            propertyRow("Changes To Detect", controller.security?.changesToDetect),
          ]),
          propertyGroup("Safety", [
            propertyRow("Safety Enabled", displayFlag(controller.safetyInfo?.safetyEnabled)),
            propertyRow("Safety Level", controller.safetyInfo?.safetyLevel),
            propertyRow("Safety Locked", displayFlag(controller.safetyInfo?.safetyLocked)),
            propertyRow("Safety Signature ID", controller.safetyInfo?.safetySignatureId),
            propertyRow("Safety Signature Timestamp", controller.safetyInfo?.safetySignatureTimestamp),
            propertyRow("Signature Run Mode Protect", displayFlag(controller.safetyInfo?.signatureRunModeProtect)),
          ]),
        ]);
      case "Alarm Log":
        return renderReadOnlyPane([
          propertyGroup("Alarm Log", [
            propertyRow("Alarm Manager", "Not configured"),
            propertyRow("Controller Alarm Definitions", 0),
            propertyRow("Alarm History", "Offline project review only"),
          ]),
        ]);
      default:
        return null;
    }
  };

  return (
    <div className="esco-modal" role="presentation">
      <section
        className="esco-modal__panel esco-controller-props"
        role="dialog"
        aria-modal="true"
        aria-label="Controller Properties"
      >
        <header className="esco-modal__header">
          <h2>Controller Properties</h2>
          <button type="button" className="esco-icon-btn" aria-label="Close Controller Properties" onClick={onClose} />
        </header>

        <div className="esco-controller-props__tabs" role="tablist" aria-label="Controller property tabs">
          {TABS.map((tab) => (
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

        {renderActiveTab()}

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
