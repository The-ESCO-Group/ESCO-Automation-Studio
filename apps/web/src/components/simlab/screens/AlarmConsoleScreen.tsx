import { useMemo, useState } from "react";
import { alarmConsoleModel, severityTone } from "@esco/sim-lab";
import { Card, Led, Pill } from "./kit";
import type { ScreenProps } from "./types";

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AlarmConsoleScreen(props: ScreenProps) {
  const { api } = props;
  const model = alarmConsoleModel(props.src);
  const [severity, setSeverity] = useState("all");
  const [area, setArea] = useState("all");
  const [view, setView] = useState<"active" | "all" | "returned">("all");
  const [ackedOnly, setAckedOnly] = useState<"all" | "acked" | "unacked">("all");

  const rows = useMemo(() => {
    let r = view === "active" ? model.active : view === "returned" ? model.returnedUnacked : model.rows;
    if (severity !== "all") r = r.filter((x) => x.severity === severity);
    if (area !== "all") r = r.filter((x) => x.area === area);
    if (ackedOnly === "acked") r = r.filter((x) => x.acknowledged);
    if (ackedOnly === "unacked") r = r.filter((x) => !x.acknowledged);
    return r;
  }, [model, view, severity, area, ackedOnly]);

  const exportLog = () => {
    const header = "seq,scan,timeMs,category,message";
    const lines = model.events.map((e) => `${e.seq},${e.scan},${e.timeMs},${e.category},"${e.message.replace(/"/g, '""')}"`);
    download("esco-sim-eventlog.csv", [header, ...lines].join("\r\n"), "text/csv");
  };

  return (
    <div data-testid="screen-alarms">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Alarm / Event Console</h2>
        <Pill tone={model.counts.active > 0 ? "fault" : "idle"}>{model.counts.active} active</Pill>
        <Pill tone={model.counts.unacked > 0 ? "warning" : "idle"}>{model.counts.unacked} unacked</Pill>
        <Pill tone={model.counts.returned > 0 ? "warning" : "idle"}>{model.counts.returned} returned</Pill>
        <span className="sim2-bar-spacer" />
        <button type="button" className="sim2-btn" data-testid="alarm-ack-all" onClick={api.ackAlarms}>Ack all</button>
        <button type="button" className="sim2-btn" onClick={exportLog} data-testid="alarm-export">Export event log</button>
      </div>

      <div className="sim2-row" style={{ marginBottom: 8 }}>
        <select className="sim2-btn sim2-btn--sm" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="returned">Returned unacked</option>
        </select>
        <select className="sim2-btn sim2-btn--sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">All severities</option>
          {model.severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="sim2-btn sim2-btn--sm" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">All areas</option>
          {model.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="sim2-btn sim2-btn--sm" value={ackedOnly} onChange={(e) => setAckedOnly(e.target.value as typeof ackedOnly)}>
          <option value="all">Ack + Unack</option>
          <option value="acked">Acknowledged</option>
          <option value="unacked">Unacknowledged</option>
        </select>
      </div>

      <div className="sim2-grid sim2-grid--2">
        <Card title="Alarms" testId="alarm-table">
          <table className="sim2-table">
            <thead><tr><th></th><th>Alarm</th><th>Area</th><th>Sev</th><th>State</th><th>Ack</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.alarmId}>
                  <td><Led tone={a.active ? severityTone(a.severity) : "idle"} /></td>
                  <td className="sim2-mono">{a.name}</td>
                  <td>{a.area}</td>
                  <td><Pill tone={severityTone(a.severity)}>{a.severity}</Pill></td>
                  <td>{a.state}</td>
                  <td>{a.acknowledged ? "✓" : ""}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="sim2-muted">No alarms match the filter.</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card title="Event log" testId="alarm-events">
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            {model.events.slice(-120).reverse().map((e) => (
              <div key={e.seq} style={{ fontSize: 11, padding: "2px 0", borderBottom: "1px solid var(--sim-grid)" }}>
                <span className="sim2-muted sim2-mono">#{e.scan} {e.timeMs}ms</span> <span className={`sim2-pill is-${e.category === "alarm" || e.category === "fault" ? "fault" : e.category === "operator" ? "good" : "idle"}`}>{e.category}</span> {e.message}
              </div>
            ))}
            {model.events.length === 0 && <div className="sim2-muted">No events yet. Run the simulation or inject a fault.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
