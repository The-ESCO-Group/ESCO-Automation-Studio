import { useEffect, useMemo, useState } from "react";
import { historianModel, type TrendMarkerVM, type TrendSeriesVM } from "@esco/sim-lab";
import { Card } from "./kit";
import type { ScreenProps } from "./types";

const PALETTE = ["#635bff", "#12b76a", "#f79009", "#0ea5e9", "#ef4444", "#8b5cf6", "#14b8a6", "#e11d48"];
const MARKER_COLOR: Record<TrendMarkerVM["kind"], string> = {
  scenario: "#12b76a",
  alarm: "#f04438",
  operator: "#635bff",
  fault: "#b42318",
};

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function valueAt(series: TrendSeriesVM, ms: number): number {
  let v = series.points[0]?.value ?? 0;
  for (const p of series.points) {
    if (p.timeMs <= ms) v = p.value ?? v;
    else break;
  }
  return v;
}

export function HistorianScreen(props: ScreenProps) {
  const { api } = props;
  const model = historianModel(props.src);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayMs, setReplayMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const span = Math.max(1, model.timeSpanMs);
  const visible = model.series.filter((s) => !hidden.has(s.tag));
  const playhead = mode === "replay" ? Math.min(replayMs, span) : span;

  useEffect(() => {
    if (mode !== "replay" || !playing) return;
    const id = window.setInterval(() => {
      setReplayMs((ms) => {
        const next = ms + 50 * speed;
        if (next >= span) { setPlaying(false); return span; }
        return next;
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [mode, playing, speed, span]);

  const W = 1000;
  const H = 200;
  const x = (t: number) => (t / span) * W;

  const seriesPath = (s: TrendSeriesVM): string => {
    const range = s.max - s.min || 1;
    return s.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.timeMs).toFixed(1)} ${(H - 4 - (((p.value ?? s.min) - s.min) / range) * (H - 8)).toFixed(1)}`)
      .join(" ");
  };

  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    model.series.forEach((s, i) => m.set(s.tag, PALETTE[i % PALETTE.length]!));
    return m;
  }, [model.series]);

  const exportCsv = () => {
    const cols = visible.map((s) => s.tag);
    const times = [...new Set(visible.flatMap((s) => s.points.map((p) => p.timeMs)))].sort((a, b) => a - b);
    const header = ["timeMs", ...cols].join(",");
    const rows = times.map((t) => [t, ...visible.map((s) => valueAt(s, t).toFixed(3))].join(","));
    download("esco-sim-trends.csv", [header, ...rows].join("\r\n"), "text/csv");
  };

  return (
    <div data-testid="screen-trends">
      <div className="sim2-row" style={{ marginBottom: 10 }}>
        <h2 className="sim2-h" style={{ margin: 0 }}>Trend / Historian</h2>
        <span className="sim2-bar-spacer" />
        <button type="button" className={`sim2-btn sim2-btn--sm ${mode === "live" ? "sim2-btn--primary" : ""}`} onClick={() => setMode("live")} data-testid="trend-live">Live</button>
        <button type="button" className={`sim2-btn sim2-btn--sm ${mode === "replay" ? "sim2-btn--primary" : ""}`} onClick={() => { setMode("replay"); setReplayMs(0); }} data-testid="trend-replay">Replay</button>
        {mode === "live" ? (
          <>
            <button type="button" className={`sim2-btn sim2-btn--sm ${api.running ? "sim2-btn--warn" : ""}`} onClick={api.toggleRun}>{api.running ? "Pause" : "Run"}</button>
            <button type="button" className="sim2-btn sim2-btn--sm" onClick={api.step}>Step</button>
          </>
        ) : (
          <>
            <button type="button" className="sim2-btn sim2-btn--sm" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="sim2-btn sim2-btn--sm" onClick={() => { setReplayMs(0); setPlaying(false); }}>Rewind</button>
            <select className="sim2-btn sim2-btn--sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option>
            </select>
          </>
        )}
        <button type="button" className="sim2-btn sim2-btn--sm" onClick={exportCsv} data-testid="trend-export">Export CSV</button>
      </div>

      <Card title={`Trends — ${mode === "replay" ? `replay @ ${playhead.toFixed(0)}ms` : `live @ ${span}ms`}`} testId="trend-chart">
        <div className="sim2-trend">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} y1={H * g} x2={W} y2={H * g} stroke="var(--sim-grid)" strokeWidth="1" />)}
            {model.markers.map((m, i) => (
              <line key={i} className="sim2-marker-line" x1={x(m.timeMs)} y1={0} x2={x(m.timeMs)} y2={H} stroke={MARKER_COLOR[m.kind]}>
                <title>{m.kind}: {m.label}</title>
              </line>
            ))}
            {visible.map((s) => <path key={s.tag} d={seriesPath(s)} fill="none" stroke={colorOf.get(s.tag)} strokeWidth="1.8" />)}
            <line x1={x(playhead)} y1={0} x2={x(playhead)} y2={H} stroke="var(--sim-ink)" strokeWidth="1" />
          </svg>
        </div>
        {mode === "replay" && (
          <input type="range" min={0} max={span} value={Math.min(replayMs, span)} onChange={(e) => setReplayMs(Number(e.target.value))} style={{ width: "100%", marginTop: 6 }} data-testid="trend-scrubber" />
        )}
      </Card>

      <Card title="Pens" testId="trend-legend">
        <table className="sim2-table">
          <thead><tr><th></th><th>Tag</th><th className="num">Current</th><th className="num">Min</th><th className="num">Max</th><th>Show</th></tr></thead>
          <tbody>
            {model.series.map((s) => (
              <tr key={s.tag}>
                <td><span style={{ display: "inline-block", width: 12, height: 3, background: colorOf.get(s.tag) }} /></td>
                <td className="sim2-mono">{s.tag} {s.units ? `(${s.units})` : ""}</td>
                <td className="num">{(mode === "replay" ? valueAt(s, playhead) : s.current).toFixed(2)}</td>
                <td className="num">{s.min.toFixed(2)}</td>
                <td className="num">{s.max.toFixed(2)}</td>
                <td><input type="checkbox" checked={!hidden.has(s.tag)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(s.tag) ? n.delete(s.tag) : n.add(s.tag); return n; })} /></td>
              </tr>
            ))}
            {model.series.length === 0 && <tr><td colSpan={6} className="sim2-muted">Run the simulation to record trends.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
