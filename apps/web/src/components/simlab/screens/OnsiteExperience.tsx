import { useEffect, useMemo, useState } from "react";
import { SIM_LAB_OFFLINE_BOUNDARY, type SimViewSource } from "@esco/sim-lab";
import type { SimLabApi } from "../useSimLab";
import { OfflineTag } from "./kit";
import type { OnsiteScreenId } from "./types";
import { ProcessOverviewScreen } from "./ProcessOverviewScreen";
import { IoCabinetScreen } from "./IoCabinetScreen";
import { DeviceDetailScreen } from "./DeviceDetailScreen";
import { PidScreen } from "./PidScreen";
import { LogicDebugScreen } from "./LogicDebugScreen";
import { AlarmConsoleScreen } from "./AlarmConsoleScreen";
import { HistorianScreen } from "./HistorianScreen";
import { ScenarioScreen } from "./ScenarioScreen";
import { FieldTechScreen } from "./FieldTechScreen";
import { ReportPreviewScreen } from "./ReportPreviewScreen";

const SCREENS: { id: OnsiteScreenId; label: string }[] = [
  { id: "overview", label: "Process Overview" },
  { id: "cabinet", label: "I/O Cabinet" },
  { id: "device", label: "Device Detail" },
  { id: "pid", label: "P&ID" },
  { id: "logic", label: "Logic Debug" },
  { id: "alarms", label: "Alarms / Events" },
  { id: "trends", label: "Trend / Historian" },
  { id: "fat", label: "FAT / SAT" },
  { id: "field", label: "Field Tech" },
  { id: "report", label: "Report" },
];

export function OnsiteExperience({ api }: { api: SimLabApi }) {
  const [screen, setScreen] = useState<OnsiteScreenId>("overview");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Build the interactive engine when entering, and rebuild when the model changes.
  const stamp = api.project?.updatedAtLabel;
  useEffect(() => {
    if (api.project) api.buildEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const src: SimViewSource = useMemo(
    () => ({
      project: api.project!,
      liveTags: api.liveTags,
      alarms: api.alarms,
      timeline: api.timeline,
      events: api.events,
      historian: api.historian,
      scan: api.scan,
      timeMs: api.timeMs,
    }),
    [api.project, api.liveTags, api.alarms, api.timeline, api.events, api.historian, api.scan, api.timeMs],
  );

  if (!api.project) {
    return (
      <div className="sim2" data-testid="simlab-onsite">
        <div className="sim2-empty">
          <p>Create a simulation project to open the onsite screens.</p>
          <button type="button" className="sim2-btn sim2-btn--primary" onClick={() => api.setStage("project")}>Go to Project setup</button>
        </div>
      </div>
    );
  }

  const devices = api.project.devices;
  const effectiveDevice = selectedDeviceId && devices.some((d) => d.id === selectedDeviceId) ? selectedDeviceId : devices[0]?.id ?? null;
  const onSelectDevice = (id: string) => setSelectedDeviceId(id);
  const goTo = (s: OnsiteScreenId) => setScreen(s);

  const screenProps = { api, src, selectedDeviceId: effectiveDevice, onSelectDevice, goTo };

  return (
    <div className="sim2" data-testid="simlab-onsite">
      <div className="sim2__bar">
        <span className="sim2__bar-title">ESCO Simulation Lab · Onsite</span>
        <span className="sim2__clock" data-testid="onsite-clock">scan {api.scan} · {api.timeMs} ms</span>
        <button type="button" className={`sim2-btn sim2-btn--sm ${api.running ? "sim2-btn--warn" : "sim2-btn--primary"}`} data-testid="onsite-run" onClick={api.toggleRun}>{api.running ? "Pause" : "Run"}</button>
        <button type="button" className="sim2-btn sim2-btn--sm" data-testid="onsite-step" onClick={api.step}>Step</button>
        <button type="button" className="sim2-btn sim2-btn--sm" onClick={() => api.runScans(10)}>Run 10</button>
        <button type="button" className="sim2-btn sim2-btn--sm" data-testid="onsite-reset" onClick={api.engineReset}>Reset</button>
        <span className="sim2-bar-spacer" />
        <OfflineTag>Offline / Virtual digital twin</OfflineTag>
      </div>

      <nav className="sim2__nav" role="tablist" aria-label="Onsite screens">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={screen === s.id}
            data-testid={`onsite-nav-${s.id}`}
            className={`sim2__navbtn${screen === s.id ? " is-active" : ""}`}
            onClick={() => setScreen(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="sim2__screen">
        {screen === "overview" && <ProcessOverviewScreen {...screenProps} />}
        {screen === "cabinet" && <IoCabinetScreen {...screenProps} />}
        {screen === "device" && <DeviceDetailScreen {...screenProps} />}
        {screen === "pid" && <PidScreen {...screenProps} />}
        {screen === "logic" && <LogicDebugScreen {...screenProps} />}
        {screen === "alarms" && <AlarmConsoleScreen {...screenProps} />}
        {screen === "trends" && <HistorianScreen {...screenProps} />}
        {screen === "fat" && <ScenarioScreen {...screenProps} />}
        {screen === "field" && <FieldTechScreen {...screenProps} />}
        {screen === "report" && <ReportPreviewScreen {...screenProps} />}
      </div>

      <div style={{ display: "none" }} aria-hidden="true">{SIM_LAB_OFFLINE_BOUNDARY}</div>
    </div>
  );
}
