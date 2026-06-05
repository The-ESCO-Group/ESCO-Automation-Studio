import { deviceDetailModel, deviceVisualState, buildTagMap } from "@esco/sim-lab";
import { Card, fmt, KeyValue, Led, Pill, toneClass } from "./kit";
import { DeviceSymbol } from "./kit";
import type { ScreenProps } from "./types";

export function DeviceDetailScreen(props: ScreenProps) {
  const { api, src } = props;
  const devices = src.project.devices;
  const deviceId = props.selectedDeviceId ?? devices[0]?.id ?? null;
  const detail = deviceId ? deviceDetailModel(src, deviceId) : null;

  if (!detail) return <div className="sim2-empty">No device selected. Add devices and pick one from the Process Overview.</div>;

  const d = src.project.devices.find((x) => x.id === detail.device.id)!;
  const visual = deviceVisualState(d, buildTagMap(src.liveTags));

  return (
    <div data-testid="screen-device">
      <div className="sim2-row" style={{ marginBottom: 12 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Device Detail</h2>
        <select
          className="sim2-btn"
          value={detail.device.id}
          onChange={(e) => props.onSelectDevice(e.target.value)}
          data-testid="device-select"
        >
          {devices.map((dev) => <option key={dev.id} value={dev.id}>{dev.tag} — {dev.name}</option>)}
        </select>
        <span className="sim2-bar-spacer" />
        <Pill tone={visual.tone}><Led tone={visual.tone} /> {visual.label}</Pill>
      </div>

      <div className="sim2-grid sim2-grid--3">
        <Card title={`${detail.device.tag} · ${detail.device.kindLabel}`} testId="device-headline">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className={`sim2-equip ${toneClass(visual.tone)}`} style={{ width: 90, alignItems: "center" }}>
              <DeviceSymbol visual={visual} />
            </div>
            <KeyValue rows={[
              ["State", <Pill tone={visual.tone}>{visual.label}</Pill>],
              ["Runtime", `${detail.runtimeHours} h`],
              ["Starts", String(detail.startCount)],
              ["Signal", <Pill tone={detail.signalQuality === "good" ? "good" : detail.signalQuality === "forced" ? "warning" : "fault"}>{detail.signalQuality}</Pill>],
              ["Last fault", detail.lastFault ?? "none"],
            ]} />
          </div>
        </Card>

        <Card title="Command / Feedback">
          <KeyValue rows={[
            ...detail.command.map((c) => [`▶ ${c.label}`, fmt(c.value)] as [string, string]),
            ...detail.feedback.map((c) => [`◀ ${c.label}`, fmt(c.value)] as [string, string]),
          ]} />
        </Card>

        <Card title="Permissives / Interlocks">
          {detail.permissives.length === 0 && detail.interlocks.length === 0 && <div className="sim2-muted">None configured.</div>}
          {detail.permissives.map((p) => (
            <div key={p.tag} className="sim2-row" style={{ justifyContent: "space-between" }}><span>P · {p.name}</span><Pill tone={p.satisfied ? "good" : "fault"}>{p.satisfied ? "OK" : "Not met"}</Pill></div>
          ))}
          {detail.interlocks.map((p) => (
            <div key={p.tag} className="sim2-row" style={{ justifyContent: "space-between" }}><span>I · {p.name}</span><Pill tone={p.satisfied ? "fault" : "good"}>{p.satisfied ? "Tripped" : "Clear"}</Pill></div>
          ))}
        </Card>

        {detail.vfd && (
          <Card title="Drive Data (ESCO generic)" testId="device-vfd">
            <KeyValue rows={[
              ["Speed command", `${detail.vfd.speedCommand} %`],
              ["Speed feedback", `${detail.vfd.speedFeedback} %`],
              ["Current", `${detail.vfd.current} A`],
              ["Torque", `${detail.vfd.torque} %`],
              ["Fault code", detail.vfd.faultCode],
              ["Ready / Running / Faulted", `${detail.vfd.ready ? "Y" : "N"} / ${detail.vfd.running ? "Y" : "N"} / ${detail.vfd.faulted ? "Y" : "N"}`],
              ["Local / Remote", detail.vfd.localRemote],
              ["Accel / Decel", detail.vfd.accelDecel],
            ]} />
          </Card>
        )}

        <Card title="Faults">
          {detail.faults.map((f) => (
            <div key={f.id} className="sim2-row" style={{ justifyContent: "space-between" }}>
              <span>{f.label}</span>
              <button type="button" className={`sim2-btn sim2-btn--sm ${f.active ? "sim2-btn--fault" : "sim2-btn--ghostfault"}`} data-testid={`device-fault-${f.id}`} onClick={() => (f.active ? api.clearFault(detail.device.id) : (api.injectFault(detail.device.id, f.id), api.runScans(2)))}>
                {f.active ? "Clear" : "Inject"}
              </button>
            </div>
          ))}
          {detail.faults.length === 0 && <div className="sim2-muted">No fault models.</div>}
        </Card>

        <Card title="Alarms">
          {detail.alarmState.length === 0 && <div className="sim2-muted">No alarms.</div>}
          {detail.alarmState.map((a) => (
            <div key={a.name} className="sim2-row" style={{ justifyContent: "space-between" }}><span className="sim2-mono">{a.name}</span><Pill tone={a.active ? "fault" : "idle"}>{a.state}</Pill></div>
          ))}
        </Card>

        {detail.scaling && (
          <Card title="Scaling">
            <KeyValue rows={[
              ["Raw", `${detail.scaling.rawMin} – ${detail.scaling.rawMax}`],
              ["Engineering", `${detail.scaling.euMin} – ${detail.scaling.euMax} ${detail.scaling.units ?? ""}`],
            ]} />
          </Card>
        )}

        <Card title="Maintenance notes">
          <p style={{ margin: 0 }}>{detail.maintenanceNotes}</p>
        </Card>

        <Card title="Related tags" testId="device-tags">
          <table className="sim2-table">
            <thead><tr><th>Tag</th><th>Type</th><th>Value</th></tr></thead>
            <tbody>
              {detail.relatedTags.map((t) => (
                <tr key={t.name}><td className="sim2-mono">{t.name}</td><td>{t.dataType}</td><td className="sim2-mono">{fmt(t.value)}{t.forced ? " ⏚" : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Scenario evidence">
          {detail.scenarioEvidence.length === 0 && <div className="sim2-muted">Run a scenario or inject a fault to capture evidence.</div>}
          {detail.scenarioEvidence.map((e, i) => (
            <div key={i} className="sim2-mono" style={{ fontSize: 11 }}><span className="sim2-muted">{e.timeMs}ms</span> {e.message}</div>
          ))}
        </Card>
      </div>
    </div>
  );
}
