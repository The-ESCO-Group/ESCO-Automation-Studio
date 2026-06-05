import { useMemo, useState } from "react";
import {
  collectAllTags,
  availableScenarioTemplates,
  COMPAT_HELPERS,
  CONTROLLER_MODELS,
  DEVICE_BLUEPRINTS,
  DEVICE_KINDS,
  LOGIC_TEMPLATES,
  PROCESS_TYPES,
  SCENARIO_TEMPLATES,
  SIM_BLOCKED_REAL_OPERATIONS,
  SIM_LAB_OFFLINE_BADGE,
  SIM_LAB_OFFLINE_BOUNDARY,
  type SimCompatHelperId,
  type SimDeviceKind,
  type SimFaultKind,
  type SimHmiWidgetKind,
  type SimLogicTemplateKind,
  type SimProcessType,
  type SimScenarioTemplateKind,
  type SimVirtualTag,
} from "@esco/sim-lab";
import { useSimLab, type SimStage } from "./useSimLab";
import { OnsiteExperience } from "./screens";

const STAGES: { id: SimStage; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "onsite", label: "Onsite Screens" },
  { id: "devices", label: "Devices" },
  { id: "logic", label: "Logic" },
  { id: "hmi", label: "HMI" },
  { id: "simulation", label: "Run" },
  { id: "reports", label: "Reports" },
  { id: "help", label: "Boundaries" },
];

const WIDGET_KINDS: SimHmiWidgetKind[] = ["value", "indicator", "button", "gauge", "trend", "alarm-banner"];

function processLabel(id: SimProcessType): string {
  return PROCESS_TYPES.find((process) => process.id === id)?.label ?? id;
}

function deviceKindLabel(kind: SimDeviceKind): string {
  return DEVICE_BLUEPRINTS[kind]?.label ?? kind;
}

function valueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value == null) return "";
  return String(value);
}

function tagNames(tags: SimVirtualTag[], predicate: (tag: SimVirtualTag) => boolean): string[] {
  return tags.filter(predicate).map((tag) => tag.name);
}

function firstTag(tags: SimVirtualTag[], predicate: (tag: SimVirtualTag) => boolean, fallback: string): string {
  return tagNames(tags, predicate)[0] ?? fallback;
}

function logicDefaults(kind: SimLogicTemplateKind, tags: SimVirtualTag[]): Record<string, string> {
  const bool = (suffix: string) => firstTag(tags, (tag) => tag.dataType === "BOOL" && tag.name.endsWith(suffix), "");
  const real = (suffix: string) => firstTag(tags, (tag) => tag.dataType === "REAL" && tag.name.endsWith(suffix), "");
  const dint = (suffix: string) => firstTag(tags, (tag) => tag.dataType === "DINT" && tag.name.endsWith(suffix), "");
  const anyBool = firstTag(tags, (tag) => tag.dataType === "BOOL", "InputRaw");
  const anyReal = firstTag(tags, (tag) => tag.dataType === "REAL", "Temperature_C");
  const permissives = tagNames(tags, (tag) => tag.dataType === "BOOL" && (tag.name.endsWith("_OK") || tag.name.endsWith("_Run")))
    .slice(0, 3)
    .join(", ");
  const trips = tagNames(tags, (tag) => tag.dataType === "BOOL" && (tag.name.endsWith("_Overload") || tag.name.endsWith("_Fault") || tag.name.endsWith("_CommFail")))
    .slice(0, 3)
    .join(", ");

  switch (kind) {
    case "debounce-input":
      return { input: anyBool, output: `${anyBool || "InputRaw"}_Debounced`, stableScans: "3" };
    case "motor-holding-interlocks":
      return {
        start: bool("_StartPB") || anyBool,
        stop: bool("_StopPB") || "StopPB",
        runCmd: bool("_RunCmd") || "RunCmd",
        permissives,
        trips,
      };
    case "motor-start-counter":
      return { run: bool("_Run") || anyBool, starts: dint("_Starts") || "Motor_Starts" };
    case "c-to-f":
      return { celsius: anyReal || "Temperature_C", fahrenheit: "Temperature_F" };
    case "f-to-c":
      return { fahrenheit: real("_PV") || "Temperature_F", celsius: "Temperature_C" };
    case "permissive-chain":
      return { permissives: permissives || anyBool, output: "Permissives_OK" };
    case "alarm-trigger":
      return { source: anyReal, mode: "high", limit: "80", alarm: "High_Alarm" };
  }
}

function findingClass(severity: string): string {
  if (severity === "error") return "is-error";
  if (severity === "warning") return "is-warning";
  return "is-info";
}

export function SimulationLab() {
  const lab = useSimLab();
  const tags = useMemo(() => (lab.project ? collectAllTags(lab.project) : []), [lab.project]);

  const [projectName, setProjectName] = useState("ESCO Virtual FAT Project");
  const [processType, setProcessType] = useState<SimProcessType>("pump-station");
  const [controllerCatalog, setControllerCatalog] = useState(CONTROLLER_MODELS[0]?.catalog ?? "");
  const [scanRateMs, setScanRateMs] = useState(CONTROLLER_MODELS[0]?.scanRateMs ?? 10);

  const [deviceKind, setDeviceKind] = useState<SimDeviceKind>("motor");
  const [deviceTag, setDeviceTag] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const [logicKind, setLogicKind] = useState<SimLogicTemplateKind>("debounce-input");
  const [logicParams, setLogicParams] = useState<Record<string, string>>(() => logicDefaults("debounce-input", []));
  const selectedLogic = LOGIC_TEMPLATES.find((template) => template.kind === logicKind) ?? LOGIC_TEMPLATES[0]!;

  const [screenName, setScreenName] = useState("Main Overview");
  const [widgetKind, setWidgetKind] = useState<SimHmiWidgetKind>("value");
  const [widgetLabel, setWidgetLabel] = useState("Process Value");
  const [widgetTag, setWidgetTag] = useState("");

  const [scenarioKind, setScenarioKind] = useState<SimScenarioTemplateKind>("start-motor");
  const [compatHelper, setCompatHelper] = useState<SimCompatHelperId>("hmiRuntime");

  const selectedController = CONTROLLER_MODELS.find((model) => model.catalog === controllerCatalog) ?? CONTROLLER_MODELS[0]!;
  const availableScenarios = lab.project ? availableScenarioTemplates(lab.project) : SCENARIO_TEMPLATES;
  const primaryScreen = lab.project?.hmiScreens[0];

  const createProject = () => {
    lab.create({
      name: projectName.trim() || "ESCO Virtual FAT Project",
      processType,
      controller: selectedController,
      scanRateMs,
      rackCount: 1,
      rackSlots: 8,
      seedDefaults: true,
    });
    setLogicParams(logicDefaults(logicKind, tags));
  };

  const selectLogicKind = (kind: SimLogicTemplateKind) => {
    setLogicKind(kind);
    setLogicParams(logicDefaults(kind, tags));
  };

  const addLogic = () => {
    lab.addLogic(logicKind, logicParams, selectedLogic.label);
  };

  const addScenario = () => {
    lab.addScenario(scenarioKind);
  };

  const addScreen = () => {
    lab.addScreen(screenName.trim() || "Main Overview");
  };

  const addWidget = () => {
    const screenId = primaryScreen?.id;
    if (!screenId) return;
    lab.addWidget(screenId, {
      kind: widgetKind,
      label: widgetLabel.trim() || widgetKind,
      tag: widgetKind === "alarm-banner" ? undefined : widgetTag || tags[0]?.name,
      command: widgetKind === "button" ? true : undefined,
      units: tags.find((tag) => tag.name === widgetTag)?.units,
    });
  };

  return (
    <div className="esco-simlab">
      <header className="esco-simlab__header">
        <div>
          <div className="esco-simlab__eyebrow">{SIM_LAB_OFFLINE_BADGE}</div>
          <h1>ESCO Simulation Lab</h1>
          <p>{lab.project ? `${lab.project.name} - ${processLabel(lab.project.processType)}` : "Create a virtual FAT/SAT project, then add devices, logic, HMI, scenarios, and report evidence."}</p>
        </div>
        <div className="esco-simlab__summary" aria-label="Simulation summary">
          <span>{lab.project?.devices.length ?? 0} devices</span>
          <span>{tags.length} tags</span>
          <span>{lab.project?.logicBlocks.length ?? 0} logic</span>
          <span>{lab.project?.scenarios.length ?? 0} scenarios</span>
        </div>
      </header>

      <nav className="esco-simlab__tabs" aria-label="Simulation Lab stages">
        {STAGES.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={`esco-simlab__tab${lab.stage === stage.id ? " is-active" : ""}`}
            onClick={() => lab.setStage(stage.id)}
          >
            {stage.label}
          </button>
        ))}
      </nav>

      {lab.notices.length > 0 ? (
        <aside className="esco-simlab__notices" aria-label="Simulation notices">
          {lab.notices.slice(0, 3).map((notice, index) => (
            <span key={`${notice}:${index}`}>{notice}</span>
          ))}
        </aside>
      ) : null}

      {lab.stage === "onsite" ? <OnsiteExperience api={lab} /> : null}

      {lab.stage === "project" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>Project Setup</h2>
            <label>
              Name
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <label>
              Process
              <select value={processType} onChange={(event) => setProcessType(event.target.value as SimProcessType)}>
                {PROCESS_TYPES.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Controller model
              <select
                value={controllerCatalog}
                onChange={(event) => {
                  const next = CONTROLLER_MODELS.find((model) => model.catalog === event.target.value) ?? CONTROLLER_MODELS[0]!;
                  setControllerCatalog(next.catalog);
                  setScanRateMs(next.scanRateMs);
                }}
              >
                {CONTROLLER_MODELS.map((model) => (
                  <option key={model.catalog} value={model.catalog}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scan rate ms
              <input type="number" min={1} max={1000} value={scanRateMs} onChange={(event) => setScanRateMs(Number(event.target.value) || 10)} />
            </label>
            <div className="esco-simlab__actions">
              <button type="button" className="esco-btn esco-btn--primary" onClick={createProject}>
                Create Project
              </button>
              <button type="button" className="esco-btn" onClick={lab.loadCandySorterDemo}>
                Load Candy Sorter Demo
              </button>
              {lab.project ? (
                <button type="button" className="esco-btn" onClick={lab.discard}>
                  Discard
                </button>
              ) : null}
            </div>
          </div>
          <div className="esco-simlab__panel">
            <h2>Seeded Defaults</h2>
            <p className="esco-simlab__muted">
              {PROCESS_TYPES.find((process) => process.id === processType)?.description}
            </p>
            <div className="esco-simlab__chips">
              {Object.entries(PROCESS_TYPES.find((process) => process.id === processType)?.defaults ?? {}).map(([key, count]) => (
                <span key={key}>{`${key}: ${count}`}</span>
              ))}
            </div>
            <h3>Offline boundary</h3>
            <p className="esco-simlab__muted">{SIM_LAB_OFFLINE_BOUNDARY}</p>
            <h3>Candy sorter mock</h3>
            <p className="esco-simlab__muted">
              Loads a virtual conveyor sorter with KitKat and Hershey lanes, diverters, counters, a 5-count case packer, and ready-to-run FAT scenarios.
            </p>
          </div>
        </section>
      ) : null}

      {lab.stage === "devices" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>Device Map</h2>
            <div className="esco-simlab__formrow">
              <select value={deviceKind} onChange={(event) => setDeviceKind(event.target.value as SimDeviceKind)}>
                {DEVICE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {deviceKindLabel(kind)}
                  </option>
                ))}
              </select>
              <input placeholder="Tag prefix" value={deviceTag} onChange={(event) => setDeviceTag(event.target.value)} />
              <input placeholder="Name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
              <button type="button" className="esco-btn esco-btn--primary" disabled={!lab.project} onClick={() => lab.addDevice(deviceKind, deviceTag, deviceName)}>
                Add Device
              </button>
            </div>
            <div className="esco-simlab__list">
              {lab.project?.devices.map((device) => (
                <div key={device.id} className="esco-simlab__row">
                  <div>
                    <strong>{device.tag}</strong>
                    <span>{device.name}</span>
                    <small>{deviceKindLabel(device.kind)} - {device.tags.length} tags - {device.faultStates.length} virtual faults</small>
                  </div>
                  <button type="button" className="esco-link" onClick={() => lab.removeDevice(device.id)}>
                    Remove
                  </button>
                </div>
              )) ?? <p className="esco-empty">Create a project to seed the device map.</p>}
            </div>
          </div>
          <div className="esco-simlab__panel">
            <h2>Virtual Tags</h2>
            <table className="esco-diagnostics__table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Role</th><th>Initial</th></tr>
              </thead>
              <tbody>
                {tags.slice(0, 18).map((tag) => (
                  <tr key={tag.id}>
                    <td>{tag.name}</td>
                    <td>{tag.dataType}</td>
                    <td>{tag.direction}</td>
                    <td>{valueLabel(tag.initial)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tags.length > 18 ? <p className="esco-simlab__muted">{tags.length - 18} more tags available in simulation.</p> : null}
          </div>
        </section>
      ) : null}

      {lab.stage === "logic" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>Logic Templates</h2>
            <label>
              Template
              <select value={logicKind} onChange={(event) => selectLogicKind(event.target.value as SimLogicTemplateKind)}>
                {LOGIC_TEMPLATES.map((template) => (
                  <option key={template.kind} value={template.kind}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="esco-simlab__muted">{selectedLogic.description}</p>
            <div className="esco-simlab__params">
              {selectedLogic.params.map((param) => (
                <label key={param.name}>
                  {param.label}
                  {param.type === "choice" ? (
                    <select value={logicParams[param.name] ?? param.default ?? ""} onChange={(event) => setLogicParams((prev) => ({ ...prev, [param.name]: event.target.value }))}>
                      {(param.choices ?? []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input
                      value={logicParams[param.name] ?? param.default ?? ""}
                      onChange={(event) => setLogicParams((prev) => ({ ...prev, [param.name]: event.target.value }))}
                      placeholder={param.help ?? param.type}
                    />
                  )}
                </label>
              ))}
            </div>
            <button type="button" className="esco-btn esco-btn--primary" disabled={!lab.project} onClick={addLogic}>
              Add Logic
            </button>
          </div>
          <div className="esco-simlab__panel">
            <h2>Generated Logic</h2>
            <div className="esco-simlab__list">
              {lab.project?.logicBlocks.map((block) => (
                <div key={block.id} className="esco-simlab__row esco-simlab__row--stack">
                  <div>
                    <strong>{block.name}</strong>
                    <span>{block.description}</span>
                    <small>{block.routine.rungs.length} rung(s), {block.requiredTags.length} required tag(s)</small>
                  </div>
                  <ol className="esco-simlab__rungs">
                    {block.metadata.rungs.map((rung) => (
                      <li key={rung.number}>{rung.text}</li>
                    ))}
                  </ol>
                  <button type="button" className="esco-link" onClick={() => lab.removeLogic(block.id)}>
                    Remove
                  </button>
                </div>
              )) ?? <p className="esco-empty">Create a project before adding logic.</p>}
            </div>
          </div>
        </section>
      ) : null}

      {lab.stage === "hmi" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>HMI Surfaces</h2>
            <div className="esco-simlab__formrow">
              <input value={screenName} onChange={(event) => setScreenName(event.target.value)} placeholder="Screen name" />
              <button type="button" className="esco-btn esco-btn--primary" disabled={!lab.project} onClick={addScreen}>
                Add Screen
              </button>
            </div>
            <div className="esco-simlab__formrow">
              <select value={widgetKind} onChange={(event) => setWidgetKind(event.target.value as SimHmiWidgetKind)}>
                {WIDGET_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
              <input value={widgetLabel} onChange={(event) => setWidgetLabel(event.target.value)} placeholder="Widget label" />
              <select value={widgetTag} onChange={(event) => setWidgetTag(event.target.value)}>
                <option value="">Auto tag</option>
                {tags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
              </select>
              <button type="button" className="esco-btn" disabled={!primaryScreen} onClick={addWidget}>
                Add Widget
              </button>
            </div>
          </div>
          <div className="esco-simlab__panel">
            <h2>Runtime Preview Map</h2>
            <div className="esco-simlab__list">
              {lab.project?.hmiScreens.map((screen) => (
                <div key={screen.id} className="esco-simlab__row esco-simlab__row--stack">
                  <strong>{screen.name}</strong>
                  <div className="esco-simlab__chips">
                    {screen.widgets.length === 0 ? <span>No widgets</span> : screen.widgets.map((widget) => (
                      <span key={widget.id}>{widget.label} - {widget.kind}{widget.tag ? ` - ${widget.tag}` : ""}</span>
                    ))}
                  </div>
                </div>
              )) ?? <p className="esco-empty">Create a project before adding HMI surfaces.</p>}
            </div>
          </div>
        </section>
      ) : null}

      {lab.stage === "simulation" ? (
        <section className="esco-simlab__grid esco-simlab__grid--three">
          <div className="esco-simlab__panel">
            <h2>Scenario Runner</h2>
            <div className="esco-simlab__formrow">
              <select value={scenarioKind} onChange={(event) => setScenarioKind(event.target.value as SimScenarioTemplateKind)}>
                {availableScenarios.map((scenario) => <option key={scenario.kind} value={scenario.kind}>{scenario.label}</option>)}
              </select>
              <button type="button" className="esco-btn" disabled={!lab.project} onClick={addScenario}>
                Add Scenario
              </button>
              <button type="button" className="esco-btn esco-btn--primary" disabled={!lab.project?.scenarios.length} onClick={lab.runAll}>
                Run All
              </button>
            </div>
            <div className="esco-simlab__list">
              {lab.project?.scenarios.map((scenario) => {
                const result = lab.results.find((candidate) => candidate.scenarioId === scenario.id);
                return (
                  <div key={scenario.id} className="esco-simlab__row">
                    <div>
                      <strong>{scenario.name}</strong>
                      <span>{scenario.description}</span>
                      <small>{result ? `${result.status.toUpperCase()} - ${result.summary.passed}/${result.summary.total}` : `${scenario.durationMs} ms`}</small>
                    </div>
                    <button type="button" className="esco-link" onClick={() => lab.runOne(scenario.id)}>
                      Run
                    </button>
                  </div>
                );
              }) ?? <p className="esco-empty">Create a project before adding scenarios.</p>}
            </div>
          </div>
          <div className="esco-simlab__panel">
            <h2>Live Controller</h2>
            <div className="esco-simlab__actions">
              <button type="button" className="esco-btn" disabled={!lab.project} onClick={lab.buildEngine}>Build</button>
              <button type="button" className="esco-btn" disabled={!lab.engineReady} onClick={lab.step}>Step</button>
              <button type="button" className="esco-btn" disabled={!lab.engineReady} onClick={() => lab.runScans(10)}>Run 10</button>
              <button type="button" className="esco-btn" disabled={!lab.engineReady} onClick={lab.toggleRun}>{lab.running ? "Stop" : "Run"}</button>
              <button type="button" className="esco-btn" disabled={!lab.engineReady} onClick={lab.engineReset}>Reset</button>
            </div>
            <div className="esco-simlab__meter">
              <span>Scan {lab.scan}</span>
              <span>{lab.timeMs} ms</span>
              <span>{lab.running ? "Running" : "Stopped"}</span>
            </div>
            <table className="esco-diagnostics__table">
              <thead><tr><th>Tag</th><th>Value</th><th>Action</th></tr></thead>
              <tbody>
                {lab.liveTags.slice(0, 12).map((tag) => (
                  <tr key={tag.name}>
                    <td>{tag.name}</td>
                    <td>{valueLabel(tag.value)}{tag.units ? ` ${tag.units}` : ""}</td>
                    <td>
                      {tag.dataType === "BOOL" ? (
                        <span className="esco-simlab__inline-actions">
                          <button type="button" className="esco-link" disabled={!lab.engineReady} onClick={() => lab.setBool(tag.name, !Boolean(tag.value))}>
                            Toggle
                          </button>
                          <button type="button" className="esco-link" disabled={!lab.engineReady} onClick={() => lab.setTag(tag.name, true)}>
                            Force 1
                          </button>
                          <button type="button" className="esco-link" disabled={!lab.engineReady} onClick={() => lab.setTag(tag.name, false)}>
                            Force 0
                          </button>
                          <button type="button" className="esco-link" disabled={!lab.engineReady} onClick={() => lab.clearForce(tag.name)}>
                            Clear
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="esco-simlab__panel">
            <h2>Faults and Events</h2>
            <div className="esco-simlab__faults">
              {lab.project?.devices.filter((device) => device.faultStates.length > 0).slice(0, 6).map((device) => (
                <div key={device.id}>
                  <strong>{device.tag}</strong>
                  <div className="esco-simlab__chips">
                    {device.faultStates.map((fault) => (
                      <button key={fault} type="button" className="esco-chipbtn" disabled={!lab.engineReady} onClick={() => lab.injectFault(device.id, fault as SimFaultKind)}>
                        {fault}
                      </button>
                    ))}
                    <button type="button" className="esco-chipbtn" disabled={!lab.engineReady} onClick={() => lab.clearFault(device.id)}>
                      clear
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="esco-simlab__events">
              {lab.alarms.length > 0 ? <button type="button" className="esco-btn" onClick={lab.ackAlarms}>Ack alarms</button> : null}
              {lab.events.slice(0, 9).map((event) => (
                <p key={event.seq}><strong>{event.category}</strong> {event.message}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {lab.stage === "reports" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>FAT/SAT Evidence</h2>
            <div className="esco-simlab__actions">
              <button type="button" className="esco-btn" disabled={!lab.project} onClick={lab.runAll}>Run Scenarios</button>
              <button type="button" className="esco-btn esco-btn--primary" disabled={!lab.project} onClick={lab.generateReport}>Generate Report</button>
            </div>
            {lab.report ? (
              <div className="esco-simlab__report">
                <strong>Status: {lab.report.status.toUpperCase()}</strong>
                <span>{lab.report.summary.scenariosPassed}/{lab.report.summary.scenarios} scenarios passed</span>
                <span>{lab.report.summary.checksPassed}/{lab.report.summary.checks} checks passed</span>
                <span>{lab.report.summary.devices} devices, {lab.report.summary.logicBlocks} logic blocks</span>
              </div>
            ) : <p className="esco-empty">Run scenarios and generate a report to capture evidence.</p>}
          </div>
          <div className="esco-simlab__panel">
            <h2>Compatibility Review</h2>
            <div className="esco-simlab__formrow">
              <select value={compatHelper} onChange={(event) => setCompatHelper(event.target.value as SimCompatHelperId)}>
                {COMPAT_HELPERS.map((helper) => <option key={helper.id} value={helper.id}>{helper.label}</option>)}
              </select>
              <button type="button" className="esco-btn" disabled={!lab.project} onClick={() => lab.buildCompat(compatHelper)}>Review</button>
            </div>
            {lab.compat ? (
              <div className="esco-simlab__report">
                <strong>{lab.compat.label}: {lab.compat.readiness.percentReady}% ready</strong>
                <span>{lab.compat.readiness.ready}/{lab.compat.readiness.total} mapped</span>
                <span>{lab.compat.unsupported.length} offline boundary note(s)</span>
                <div className="esco-simlab__chips">
                  {lab.compat.connectionLog.map((entry) => <span key={entry}>{entry}</span>)}
                </div>
              </div>
            ) : <p className="esco-empty">Build a compatibility review for neutral offline tag mapping.</p>}
          </div>
        </section>
      ) : null}

      {lab.stage === "help" ? (
        <section className="esco-simlab__grid esco-simlab__grid--two">
          <div className="esco-simlab__panel">
            <h2>Validation</h2>
            <div className="esco-simlab__list">
              {lab.findings.length === 0 ? <p className="esco-empty">No validation findings.</p> : lab.findings.map((finding) => (
                <div key={`${finding.ruleId}:${finding.message}`} className={`esco-simlab__finding ${findingClass(finding.severity)}`}>
                  <strong>{finding.severity.toUpperCase()}</strong>
                  <span>{finding.message}</span>
                  {finding.target ? <small>{finding.target}</small> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="esco-simlab__panel">
            <h2>Blocked Real Operations</h2>
            <p className="esco-simlab__muted">{SIM_LAB_OFFLINE_BOUNDARY}</p>
            <div className="esco-simlab__list">
              {SIM_BLOCKED_REAL_OPERATIONS.map((operation) => (
                <div key={operation.id} className="esco-simlab__row">
                  <div>
                    <strong>{operation.label}</strong>
                    <span>{operation.reason}</span>
                  </div>
                  <span className="esco-simlab__blocked">Blocked</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
