import { useState } from "react";
import { FAULT_INFO, processOverviewModel, TAG } from "@esco/sim-lab";
import { ConveyorSymbol, DeviceSymbol, fmt, Led, Pill, Pipe, TankSymbol } from "./kit";
import { pulse, type ScreenProps } from "./types";

export function ProcessOverviewScreen(props: ScreenProps) {
  const { api, src } = props;
  const [manual, setManual] = useState(true);
  const model = processOverviewModel(src);
  const deviceById = new Map(src.project.devices.map((d) => [d.id, d]));

  const start = (tag: string) => pulse(api, `${tag}_${TAG.startPb}`, 3);
  const stop = (tag: string) => pulse(api, `${tag}_${TAG.stopPb}`, 3);
  const reset = (id: string) => {
    api.clearFault(id);
    api.runScans(3);
  };
  const moveValve = (tag: string, open: boolean) => {
    api.setBool(`${tag}_${TAG.openCmd}`, open);
    api.setBool(`${tag}_${TAG.closeCmd}`, !open);
    api.runScans(8);
  };

  return (
    <div data-testid="screen-overview">
      <div className="sim2-row" style={{ marginBottom: 12 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Process Overview</h2>
        <Pill tone="idle">{src.project.processType}</Pill>
        <span className="sim2-bar-spacer" />
        <Pill tone={model.metrics.running > 0 ? "good" : "idle"}>{model.metrics.running} running</Pill>
        <Pill tone={model.metrics.faulted > 0 ? "fault" : "idle"}>{model.metrics.faulted} faulted</Pill>
        <Pill tone={model.metrics.alarmsActive > 0 ? "warning" : "idle"}>{model.metrics.alarmsActive} alarms</Pill>
        <button type="button" className="sim2-btn" data-testid="overview-ack" onClick={api.ackAlarms}>Acknowledge alarms</button>
        <button type="button" className={`sim2-btn ${manual ? "sim2-btn--primary" : ""}`} onClick={() => { setManual((m) => !m); api.pushNotice(`Operator mode: ${!manual ? "Manual" : "Auto"}`); }}>
          {manual ? "Manual" : "Auto"}
        </button>
      </div>

      <div className="sim2-mimic">
        <div className="sim2-equipgrid">
          {model.equipment.map((eq, i) => {
            const device = deviceById.get(eq.deviceId)!;
            const isMotor = eq.kind === "motor" || eq.kind === "vfd";
            const isValve = eq.kind === "valve";
            return (
              <div key={eq.deviceId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {i > 0 && <Pipe flowing={eq.running} tone={eq.tone} width={30} />}
                <div
                  className={`sim2-equip ${eq.tone === "good" ? "is-good" : eq.tone === "warning" ? "is-warn" : eq.tone === "fault" ? "is-fault" : ""}`}
                  data-testid={`overview-equip-${eq.tag}`}
                  data-state={eq.state}
                  onClick={() => { props.onSelectDevice(eq.deviceId); }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="sim2-equip__tag"><Led tone={eq.tone} /> {eq.tag}</div>
                  {eq.kind === "level-transmitter" ? (
                    <TankSymbol percent={eq.levelPercent ?? 0} tone={eq.tone} />
                  ) : eq.kind === "motor" && src.project.processType === "conveyor" ? (
                    <ConveyorSymbol moving={eq.running} tone={eq.tone} />
                  ) : (
                    <DeviceSymbol visual={eq} />
                  )}
                  <div className="sim2-equip__val">
                    <Pill tone={eq.tone}>{eq.label}</Pill>
                    {typeof eq.value === "number" && <div>{fmt(eq.value)} {eq.units}</div>}
                  </div>
                  <div className="sim2-equip__ctrls" onClick={(e) => e.stopPropagation()}>
                    {isMotor && (
                      <>
                        <button type="button" className="sim2-btn sim2-btn--good sim2-btn--sm" disabled={!manual} data-testid={`overview-start-${eq.tag}`} onClick={() => start(eq.tag)}>Start</button>
                        <button type="button" className="sim2-btn sim2-btn--sm" disabled={!manual} onClick={() => stop(eq.tag)}>Stop</button>
                        <button type="button" className="sim2-btn sim2-btn--sm" disabled={!manual} onClick={() => reset(eq.deviceId)}>Reset</button>
                      </>
                    )}
                    {isValve && (
                      <>
                        <button type="button" className="sim2-btn sim2-btn--sm" disabled={!manual} onClick={() => moveValve(eq.tag, true)}>Open</button>
                        <button type="button" className="sim2-btn sim2-btn--sm" disabled={!manual} onClick={() => moveValve(eq.tag, false)}>Close</button>
                      </>
                    )}
                    {device.faultStates.map((f) => {
                      const active = api.activeFault(eq.deviceId) === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          className={`sim2-btn sim2-btn--sm ${active ? "sim2-btn--fault" : "sim2-btn--ghostfault"}`}
                          data-testid={`overview-fault-${eq.tag}-${f}`}
                          title={FAULT_INFO[f].description}
                          onClick={() => (active ? api.clearFault(eq.deviceId) : (api.injectFault(eq.deviceId, f), api.runScans(2)))}
                        >
                          {active ? "Clear" : FAULT_INFO[f].label}
                        </button>
                      );
                    })}
                  </div>
                  {eq.alarms.length > 0 && <div className="sim2-tone-fault sim2-mono" style={{ fontSize: 10, textAlign: "center" }}>⚠ {eq.alarms.join(", ")}</div>}
                </div>
              </div>
            );
          })}
          {model.equipment.length === 0 && <div className="sim2-empty">No equipment. Add devices in the Devices tab.</div>}
        </div>
      </div>
      <p className="sim2-muted" style={{ marginTop: 8 }}>Every control mutates the offline virtual simulation. Click any equipment to open its device detail.</p>
    </div>
  );
}
