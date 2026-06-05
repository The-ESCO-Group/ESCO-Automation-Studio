import { useState } from "react";
import { ioCabinetModel, type IoModuleVM } from "@esco/sim-lab";
import { Card, fmt, Led, OfflineTag } from "./kit";
import type { ScreenProps } from "./types";

export function IoCabinetScreen(props: ScreenProps) {
  const model = ioCabinetModel(props.src);
  const [selected, setSelected] = useState<string | null>(model.modules[0]?.id ?? null);
  const selectedModule = model.modules.find((m) => m.id === selected) ?? model.modules[0];

  return (
    <div data-testid="screen-cabinet">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Electrical / I/O Cabinet</h2>
        <span className="sim2-bar-spacer" />
        <OfflineTag>Offline I/O simulation</OfflineTag>
      </div>

      <div className="sim2-row" style={{ marginBottom: 12 }}>
        <Card title="Virtual Controller">
          <div className="sim2-row"><Led tone={model.controller.led} /> <strong>{model.controller.name}</strong></div>
          <div className="sim2-muted sim2-mono">{model.controller.catalog} · {model.controller.status}</div>
        </Card>
        <Card title="Power Supply">
          <div className="sim2-row"><Led tone={model.power.led} /> {model.power.status}</div>
        </Card>
        <Card title="Communication">
          <div className="sim2-row"><Led tone={model.comm.led} /> {model.comm.status}</div>
        </Card>
      </div>

      <Card title="I/O Rack (offline)" testId="cabinet-rack">
        <div className="sim2-cab">
          {model.modules.map((mod) => (
            <ModuleCard key={mod.id} mod={mod} selected={mod.id === selected} onClick={() => setSelected(mod.id)} />
          ))}
        </div>
        <div className="sim2-muted" style={{ marginTop: 8, fontSize: 11 }}>{model.offlineNotice}</div>
      </Card>

      {selectedModule && (
        <Card title={`Channel detail — ${selectedModule.name} (slot ${selectedModule.slot})`} testId="cabinet-channels">
          <table className="sim2-table">
            <thead><tr><th>Ch</th><th>Tag</th><th className="num">Raw</th><th className="num">Scaled</th><th>Units</th><th>Quality</th><th>Forced</th><th>Value</th><th className="num">Updated</th></tr></thead>
            <tbody>
              {selectedModule.channels.map((c) => (
                <tr key={c.channel}>
                  <td className="num">{c.channel}</td>
                  <td className="sim2-mono">{c.tag}</td>
                  <td className="num">{c.raw}</td>
                  <td className="num">{c.scaled}</td>
                  <td>{c.units ?? "—"}</td>
                  <td><span className={`sim2-pill ${c.quality === "good" ? "is-good" : c.quality === "forced" ? "is-warn" : "is-fault"}`}>{c.quality}</span></td>
                  <td>{c.forced ? "⏚" : ""}</td>
                  <td className="sim2-mono">{fmt(c.value)}</td>
                  <td className="num">{c.lastUpdateMs} ms</td>
                </tr>
              ))}
              {selectedModule.channels.length === 0 && <tr><td colSpan={9} className="sim2-muted">No channels populated on this module.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function ModuleCard({ mod, selected, onClick }: { mod: IoModuleVM; selected: boolean; onClick: () => void }) {
  return (
    <div className={`sim2-slot${selected ? " is-selected" : ""}`} onClick={onClick} role="button" tabIndex={0} data-testid={`cabinet-module-${mod.kind}-${mod.slot}`}>
      <div className="sim2-slot__head"><Led tone={mod.led} /> <span className="sim2-slot__name">{mod.kind}</span><span style={{ marginLeft: "auto" }}>S{mod.slot}</span></div>
      <div style={{ padding: "5px 7px 0", fontSize: 10.5 }} className="sim2-muted">{mod.name}</div>
      <div className="sim2-slot__leds">
        {mod.channels.map((c) => (
          <span key={c.channel} className={`sim2-chan-led${c.forced ? " is-forced" : c.active ? " is-on" : ""}`} title={`${c.tag}: ${fmt(c.value)}`} />
        ))}
        {Array.from({ length: Math.max(0, mod.channelCount - mod.channels.length) }).map((_, i) => <span key={`e${i}`} className="sim2-chan-led" />)}
      </div>
      <div className="sim2-slot__foot">{mod.activeCount}/{mod.channels.length} active{mod.fault ? " · FAULT" : ""}</div>
    </div>
  );
}
