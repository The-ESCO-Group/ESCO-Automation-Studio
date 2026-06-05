import type { ReactNode } from "react";
import type { DeviceVisual, SimVisualTone } from "@esco/sim-lab";
import type { PlcValue } from "@esco/simulator";

export function toneClass(tone: SimVisualTone): string {
  return `is-${tone === "good" ? "good" : tone === "warning" ? "warn" : tone === "fault" ? "fault" : tone === "disabled" ? "disabled" : "idle"}`;
}

export function fmt(value: PlcValue | number | boolean | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  return String(value);
}

export function Led({ tone }: { tone: SimVisualTone }) {
  return <span className={`sim2-led ${toneClass(tone)}`} aria-hidden="true" />;
}

export function Pill({ tone, children }: { tone: SimVisualTone; children: ReactNode }) {
  return <span className={`sim2-pill ${toneClass(tone)}`}>{children}</span>;
}

export function Card({
  title,
  actions,
  children,
  testId,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="sim2-card" data-testid={testId}>
      <header className="sim2-card__head">
        <span>{title}</span>
        <span className="sim2-spacer" />
        {actions}
      </header>
      <div className="sim2-card__body">{children}</div>
    </section>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="sim2-kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A radial-ish gauge (ESCO-original arc) for analog values. */
export function Gauge({ value, min, max, units, tone = "good" }: { value: number; min: number; max: number; units?: string; tone?: SimVisualTone }) {
  const span = max - min || 1;
  const ratio = Math.max(0, Math.min(1, (value - min) / span));
  const start = -120;
  const end = 120;
  const angle = start + (end - start) * ratio;
  const r = 34;
  const cx = 44;
  const cy = 44;
  const toXY = (deg: number) => [cx + r * Math.cos((deg - 90) * (Math.PI / 180)), cy + r * Math.sin((deg - 90) * (Math.PI / 180))];
  const [sx, sy] = toXY(start);
  const [ex, ey] = toXY(end);
  const [vx, vy] = toXY(angle);
  const color = tone === "fault" ? "var(--sim-fault)" : tone === "warning" ? "var(--sim-warn)" : "var(--sim-good)";
  const arc = (x1: number, y1: number, x2: number, y2: number, large: number) => `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  return (
    <div className="sim2-gauge">
      <svg width="88" height="76" viewBox="0 0 88 76" role="img" aria-label={`${value} ${units ?? ""}`}>
        <path d={arc(sx, sy, ex, ey, 1)} fill="none" stroke="var(--sim-grid)" strokeWidth="7" strokeLinecap="round" />
        <path d={arc(sx, sy, vx, vy, ratio > 0.5 ? 1 : 0)} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
        <text x="44" y="50" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--sim-ink)">{Number.isInteger(value) ? value : value.toFixed(1)}</text>
        <text x="44" y="64" textAnchor="middle" fontSize="9" fill="var(--sim-idle)">{units ?? ""}</text>
      </svg>
    </div>
  );
}

export function Sparkline({ values, tone = "good", width = 120, height = 26 }: { values: number[]; tone?: SimVisualTone; width?: number; height?: number }) {
  const slice = values.slice(-80);
  if (slice.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const span = max - min || 1;
  const pts = slice.map((v, i) => `${(i / (slice.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  const color = tone === "fault" ? "var(--sim-fault)" : tone === "warning" ? "var(--sim-warn)" : "var(--accent)";
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ESCO-original equipment symbols (geometric, not vendor artwork)
// ---------------------------------------------------------------------------

function strokeFor(tone: SimVisualTone): string {
  return tone === "fault" ? "var(--sim-fault)" : tone === "warning" ? "var(--sim-warn)" : tone === "good" ? "var(--sim-good)" : "var(--sim-idle)";
}

export function DeviceSymbol({ visual }: { visual: DeviceVisual }) {
  const stroke = strokeFor(visual.tone);
  switch (visual.kind) {
    case "motor":
    case "vfd": {
      const spinning = visual.running;
      const fast = typeof visual.value === "number" && visual.value > 40;
      return (
        <svg className="sim2-equip__svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={visual.label}>
          <circle cx="32" cy="32" r="24" fill="none" stroke={stroke} strokeWidth="2.5" />
          <g className={`sim2-rotor${spinning ? (fast ? " is-spin-fast" : " is-spin") : ""}`} stroke={stroke} strokeWidth="2.5">
            <line x1="32" y1="14" x2="32" y2="50" />
            <line x1="14" y1="32" x2="50" y2="32" />
            <line x1="20" y1="20" x2="44" y2="44" />
          </g>
          <text x="32" y="60" textAnchor="middle" fontSize="9" fill="var(--sim-idle)">{visual.kind === "vfd" ? "VFD" : "M"}</text>
        </svg>
      );
    }
    case "valve": {
      const pos = typeof visual.value === "number" ? visual.value : 0;
      const open = pos / 100;
      return (
        <svg className="sim2-equip__svg" width="64" height="56" viewBox="0 0 64 56" role="img" aria-label={visual.label}>
          <polygon points="8,12 32,28 8,44" fill="none" stroke={stroke} strokeWidth="2.5" />
          <polygon points="56,12 32,28 56,44" fill="none" stroke={stroke} strokeWidth="2.5" />
          <rect x="30" y={28 - 16 * open} width="4" height={16 * open} fill={stroke} opacity="0.7" />
          <line x1="32" y1="28" x2="32" y2="6" stroke={stroke} strokeWidth="2" />
          <rect x="22" y="2" width="20" height="5" fill={stroke} />
        </svg>
      );
    }
    case "flow-meter":
    case "level-transmitter":
    case "temperature-sensor": {
      const letter = visual.kind === "flow-meter" ? "FT" : visual.kind === "level-transmitter" ? "LT" : "TT";
      return (
        <svg className="sim2-equip__svg" width="62" height="56" viewBox="0 0 62 56" role="img" aria-label={visual.label}>
          <circle cx="31" cy="26" r="20" fill="var(--sim-panel)" stroke={stroke} strokeWidth="2.5" />
          <line x1="11" y1="26" x2="51" y2="26" stroke={stroke} strokeWidth="1" />
          <text x="31" y="23" textAnchor="middle" fontSize="11" fontWeight="700" fill={stroke}>{letter}</text>
          <text x="31" y="38" textAnchor="middle" fontSize="9" fill="var(--sim-idle)">{visual.kind === "flow-meter" && visual.running ? "→" : "•"}</text>
        </svg>
      );
    }
    case "safety-input": {
      return (
        <svg className="sim2-equip__svg" width="58" height="58" viewBox="0 0 58 58" role="img" aria-label={visual.label}>
          <polygon points="20,6 38,6 52,20 52,38 38,52 20,52 6,38 6,20" fill={visual.faulted ? "#fef3f2" : "var(--sim-panel)"} stroke={stroke} strokeWidth="2.5" />
          <circle cx="29" cy="29" r="9" fill={stroke} />
          <text x="29" y="33" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">ES</text>
        </svg>
      );
    }
  }
}

/** A tank symbol with an animated level fill (driven by percent). */
export function TankSymbol({ percent, tone = "good" }: { percent: number; tone?: SimVisualTone }) {
  const p = Math.max(0, Math.min(100, percent));
  const top = 8;
  const h = 56;
  const fillH = (h * p) / 100;
  const stroke = strokeFor(tone);
  return (
    <svg width="64" height="76" viewBox="0 0 64 76" role="img" aria-label={`Level ${p.toFixed(0)}%`}>
      <rect x="10" y={top} width="44" height={h} rx="6" fill="var(--sim-panel)" stroke={stroke} strokeWidth="2.5" />
      <rect className="sim2-tank__fill" x="12" y={top + (h - fillH)} width="40" height={fillH} rx="3" fill={stroke} opacity="0.35" />
      <text x="32" y="74" textAnchor="middle" fontSize="10" fill="var(--sim-idle)">{p.toFixed(0)}%</text>
    </svg>
  );
}

/** Animated pipe segment; dashes flow when `flowing`. */
export function Pipe({ flowing, tone = "good", width = 60 }: { flowing: boolean; tone?: SimVisualTone; width?: number }) {
  const stroke = strokeFor(tone);
  return (
    <svg width={width} height="16" viewBox={`0 0 ${width} 16`} aria-hidden="true">
      <line x1="0" y1="8" x2={width} y2="8" stroke="var(--sim-grid)" strokeWidth="8" />
      <line className={`sim2-flow${flowing ? " is-flow" : ""}`} x1="0" y1="8" x2={width} y2="8" stroke={stroke} strokeWidth="4" />
    </svg>
  );
}

/** Animated conveyor belt. */
export function ConveyorSymbol({ moving, tone = "good" }: { moving: boolean; tone?: SimVisualTone }) {
  const stroke = strokeFor(tone);
  return (
    <svg className="sim2-equip__svg" width="120" height="44" viewBox="0 0 120 44" role="img" aria-label={moving ? "Conveyor running" : "Conveyor stopped"}>
      <circle cx="16" cy="22" r="12" fill="none" stroke={stroke} strokeWidth="2.5" />
      <circle cx="104" cy="22" r="12" fill="none" stroke={stroke} strokeWidth="2.5" />
      <line className={`sim2-belt${moving ? " is-move" : ""}`} x1="16" y1="10" x2="104" y2="10" stroke={stroke} strokeWidth="3" />
      <line className={`sim2-belt${moving ? " is-move" : ""}`} x1="16" y1="34" x2="104" y2="34" stroke={stroke} strokeWidth="3" />
    </svg>
  );
}

export function OfflineTag({ children }: { children?: ReactNode }) {
  return <span className="sim2-pill is-warn" title="Offline virtual simulation only">⛭ {children ?? "Offline / Virtual"}</span>;
}
