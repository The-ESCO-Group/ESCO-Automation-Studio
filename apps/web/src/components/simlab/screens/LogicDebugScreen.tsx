import { logicDebugModel } from "@esco/sim-lab";
import { Card, fmt } from "./kit";
import type { ScreenProps } from "./types";

export function LogicDebugScreen(props: ScreenProps) {
  const { api } = props;
  const blocks = logicDebugModel(props.src);

  return (
    <div data-testid="screen-logic">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Logic Debug</h2>
        <span className="sim2-muted">ESCO-native ladder/block status</span>
        <span className="sim2-bar-spacer" />
        <span className="sim2__clock">scan {api.scan} · {api.timeMs}ms</span>
        <button type="button" className="sim2-btn" data-testid="logic-step" onClick={api.step}>Step scan</button>
        <button type="button" className="sim2-btn" onClick={() => api.runScans(5)}>Run 5</button>
        <button type="button" className={`sim2-btn ${api.running ? "sim2-btn--warn" : "sim2-btn--primary"}`} onClick={api.toggleRun}>{api.running ? "Pause" : "Run"}</button>
        <button type="button" className="sim2-btn" onClick={api.engineReset}>Reset</button>
      </div>

      <div className="sim2-grid sim2-grid--2">
        {blocks.map((b) => (
          <Card key={b.id} title={`${b.name} · ${b.templateKind}`} testId={`logic-block-${b.templateKind}`}>
            {b.rungs.map((r) => (
              <div key={r.number} className={`sim2-rung${r.energized ? " is-energized" : ""}`} data-testid={`logic-rung-${b.templateKind}-${r.number}`}>
                <div className="sim2-rung__rail" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sim2-rung__nodes">
                    {r.nodes.map((n, i) => (
                      <span key={i} className={`sim2-node is-${n.role}${n.active ? " is-true" : ""}`}>
                        <span style={{ fontWeight: 700 }}>{n.instruction}</span>
                        {n.operands.map((o, j) => <span key={j} className="sim2-node__op">{o.tag}={fmt(o.value)}</span>)}
                      </span>
                    ))}
                  </div>
                  <div className="sim2-muted" style={{ fontSize: 10.5, marginTop: 2 }}>{r.text}</div>
                </div>
                <span className={`sim2-pill ${r.energized ? "is-good" : "is-idle"}`} style={{ alignSelf: "center" }}>{r.energized ? "TRUE" : "FALSE"}</span>
              </div>
            ))}
          </Card>
        ))}
        {blocks.length === 0 && <div className="sim2-empty">No logic blocks. Add logic in the Logic tab.</div>}
      </div>
    </div>
  );
}
