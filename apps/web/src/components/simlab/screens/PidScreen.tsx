import { useState } from "react";
import { pidViewModel } from "@esco/sim-lab";
import { DeviceSymbol, fmt, Led, Pipe } from "./kit";
import type { ScreenProps } from "./types";

const FILTERS = [
  { id: "tags", label: "Tags" },
  { id: "alarms", label: "Alarms" },
  { id: "interlocks", label: "Interlocks" },
  { id: "live", label: "Live values" },
  { id: "failed", label: "Failed signals" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export function PidScreen(props: ScreenProps) {
  const model = pidViewModel(props.src);
  const [on, setOn] = useState<Record<FilterId, boolean>>({ tags: true, alarms: true, interlocks: false, live: true, failed: true });
  const toggle = (id: FilterId) => setOn((s) => ({ ...s, [id]: !s[id] }));

  return (
    <div data-testid="screen-pid">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>P&amp;ID / Engineering View</h2>
        <span className="sim2-muted">ESCO-owned diagram</span>
        <span className="sim2-bar-spacer" />
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`sim2-btn sim2-btn--sm ${on[f.id] ? "sim2-btn--primary" : ""}`} data-testid={`pid-filter-${f.id}`} onClick={() => toggle(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="sim2-mimic" data-testid="pid-diagram">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start" }}>
          {model.symbols.map((s, i) => {
            const muted = on.failed && !s.failed ? 0.45 : 1;
            return (
              <div key={s.deviceId} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <Pipe flowing={s.visual.running} tone={s.visual.tone} width={26} />}
                <button
                  type="button"
                  className="sim2-equip"
                  style={{ width: 132, opacity: muted, cursor: "pointer", background: "var(--sim-panel)" }}
                  data-testid={`pid-symbol-${s.tag}`}
                  onClick={() => { props.onSelectDevice(s.deviceId); props.goTo("device"); }}
                >
                  {s.instrument && (
                    <div style={{ textAlign: "center" }}>
                      <span className="sim2-pill is-idle" style={{ borderRadius: "50%", width: 30, height: 30, display: "inline-flex", justifyContent: "center" }}>{s.tag.slice(0, 2)}</span>
                    </div>
                  )}
                  <DeviceSymbol visual={s.visual} />
                  {on.tags && <div className="sim2-mono" style={{ fontWeight: 700, textAlign: "center" }}><Led tone={s.visual.tone} /> {s.bubbleText}</div>}
                  {on.live && typeof s.visual.value === "number" && <div className="sim2-muted sim2-mono" style={{ textAlign: "center" }}>{fmt(s.visual.value)} {s.visual.units}</div>}
                  {on.alarms && s.alarmSetpoints.length > 0 && (
                    <div className="sim2-muted" style={{ fontSize: 10, textAlign: "center" }}>{s.alarmSetpoints.map((sp) => `${sp.label} ${sp.value}${sp.units ? sp.units : ""}`).join(" · ")}</div>
                  )}
                  {on.interlocks && s.interlocks.length > 0 && (
                    <div className="sim2-tone-warn" style={{ fontSize: 10, textAlign: "center" }}>⛓ {s.interlocks.join(", ")}</div>
                  )}
                  {on.failed && s.failed && <div className="sim2-tone-fault" style={{ fontSize: 10, textAlign: "center" }}>FAILED SIGNAL</div>}
                </button>
              </div>
            );
          })}
          {model.symbols.length === 0 && <div className="sim2-empty">No equipment to diagram.</div>}
        </div>
      </div>
      <p className="sim2-muted" style={{ marginTop: 8 }}>Click any symbol to open the matching simulated device.</p>
    </div>
  );
}
