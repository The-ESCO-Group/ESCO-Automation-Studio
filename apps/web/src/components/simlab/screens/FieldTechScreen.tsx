import { useState } from "react";
import { fieldCheckoutModel, buildTagMap } from "@esco/sim-lab";
import { Card, fmt, OfflineTag, Pill } from "./kit";
import type { ScreenProps } from "./types";

interface Evidence { timeMs: number; text: string }

export function FieldTechScreen(props: ScreenProps) {
  const { api, src } = props;
  const devices = src.project.devices;
  const deviceId = props.selectedDeviceId ?? devices[0]?.id ?? null;
  const model = deviceId ? fieldCheckoutModel(src, deviceId) : null;
  const [done, setDone] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);

  if (!model) return <div className="sim2-empty">No device selected for field checkout.</div>;
  const device = devices.find((d) => d.id === model.device.id)!;
  const tags = buildTagMap(src.liveTags);

  const log = (text: string) => setEvidence((e) => [{ timeMs: api.timeMs, text }, ...e].slice(0, 30));
  const mark = (id: string) => setDone((s) => new Set(s).add(id));

  const drive = (eu: number, label: string) => {
    if (!model.pvTag) return;
    api.setTag(model.pvTag, eu, true);
    api.runScans(2);
    log(`Forced ${model.pvTag} → ${eu} ${model.units ?? ""} (${label})`);
    mark(label);
  };
  const release = () => {
    if (model.pvTag) { api.clearForce(model.pvTag); api.runScans(2); log(`Released ${model.pvTag} to simulated process`); }
  };
  const toggleDiscrete = (tag: string) => {
    const cur = tags.get(tag)?.value === true;
    api.setBool(tag, !cur);
    api.runScans(1);
    log(`Toggled ${tag} → ${!cur ? "ON" : "OFF"}`);
    mark(`disc-${tag}`);
  };
  const forceFault = () => {
    const f = device.faultStates[0];
    if (!f) return;
    api.injectFault(device.id, f);
    api.runScans(2);
    log(`Injected virtual fault: ${f}`);
    mark("fault");
  };

  const checklist = [
    ...model.loopPoints.map((p) => ({ id: p.label, label: `Loop check ${p.label} (${p.eu} ${model.units ?? ""})` })),
    ...model.discreteTags.map((t) => ({ id: `disc-${t}`, label: `Discrete checkout ${t}` })),
    { id: "fault", label: "Virtual fault response verified" },
  ];

  return (
    <div className="sim2-field" data-testid="screen-field">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Field Technician Checkout</h2>
        <span className="sim2-bar-spacer" />
        <OfflineTag>Virtual loop check — offline</OfflineTag>
      </div>

      <Card title="Device" actions={
        <select className="sim2-btn sim2-btn--sm" value={model.device.id} onChange={(e) => props.onSelectDevice(e.target.value)} data-testid="field-device">
          {devices.map((d) => <option key={d.id} value={d.id}>{d.tag} — {d.name}</option>)}
        </select>
      }>
        <div className="sim2-row">
          <strong className="sim2-mono">{model.device.tag}</strong>
          <Pill tone="idle">{model.device.kind}</Pill>
          <span className="sim2-muted">Current: <span className="sim2-mono">{fmt(model.currentValue)} {model.units ?? ""}</span></span>
        </div>
      </Card>

      {model.analog ? (
        <Card title="Loop check (simulate transmitter mA)" testId="field-loop">
          <div className="sim2-loop">
            {model.loopPoints.map((p) => (
              <button key={p.label} type="button" className="sim2-btn sim2-btn--primary" data-testid={`field-loop-${p.percent}`} onClick={() => drive(p.eu, p.label)}>
                {p.label} → {p.eu} {model.units ?? ""}
              </button>
            ))}
            <button type="button" className="sim2-btn" onClick={release}>Release to process</button>
          </div>
          <div className="sim2-muted" style={{ marginTop: 6, fontSize: 11 }}>4 mA = {model.scaling?.euMin} {model.units}, 20 mA = {model.scaling?.euMax} {model.units}.</div>
        </Card>
      ) : (
        <Card title="Command / feedback checkout" testId="field-loop">
          <div className="sim2-row">
            {model.commandTag && <button type="button" className="sim2-btn sim2-btn--primary" onClick={() => toggleDiscrete(model.commandTag!)}>Toggle command {model.commandTag.split("_").pop()}</button>}
            {model.discreteTags.map((t) => (
              <button key={t} type="button" className="sim2-btn" onClick={() => toggleDiscrete(t)} data-testid={`field-disc-${t}`}>Toggle {t.split("_").pop()}</button>
            ))}
          </div>
        </Card>
      )}

      <Card title="Virtual fault">
        <button type="button" className="sim2-btn sim2-btn--ghostfault" disabled={device.faultStates.length === 0} onClick={forceFault} data-testid="field-fault">Force virtual fault ({device.faultStates[0] ?? "none"})</button>
        <button type="button" className="sim2-btn sim2-btn--sm" style={{ marginLeft: 6 }} onClick={() => { api.clearFault(device.id); api.runScans(2); log("Cleared virtual fault"); }}>Clear</button>
      </Card>

      <Card title="Checkout checklist">
        {checklist.map((c) => (
          <div key={c.id} className="sim2-row" style={{ justifyContent: "space-between" }}>
            <span>{done.has(c.id) ? "☑" : "☐"} {c.label}</span>
            <Pill tone={done.has(c.id) ? "good" : "idle"}>{done.has(c.id) ? "PASS" : "pending"}</Pill>
          </div>
        ))}
      </Card>

      <Card title="Notes & evidence">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Field notes…" rows={2} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: 6, font: "inherit" }} />
        <div style={{ maxHeight: 160, overflow: "auto", marginTop: 6 }}>
          {evidence.map((e, i) => <div key={i} className="sim2-mono" style={{ fontSize: 11 }}><span className="sim2-muted">{e.timeMs}ms</span> {e.text}</div>)}
          {evidence.length === 0 && <div className="sim2-muted">Timestamped evidence appears here as you perform checkout actions.</div>}
        </div>
      </Card>
    </div>
  );
}
