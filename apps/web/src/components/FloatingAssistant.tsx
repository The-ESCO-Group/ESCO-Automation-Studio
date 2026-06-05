import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PlcProject } from "@esco/core";
import {
  getDefaultProvider,
  runAgent,
  type AgentTranscriptEntry,
  type ApplyResult,
  type AssistantPlan,
  type AssistantProvider,
} from "@esco/ai-assistant";
import { createModelCaller } from "../ai-online";
import type { AiProvider } from "../ai-profile";
import "./FloatingAssistant.css";

export interface FloatingAssistantProps {
  project: PlcProject | null;
  selectedRoutineId?: string;
  selectedRungId?: string;
  /** Display label for the active model. */
  modelLabel?: string;
  /** Live-model configuration (from the AI profile). When all present, the live agent is used. */
  aiProvider?: AiProvider;
  modelId?: string;
  apiKey?: string;
  /** Offline fallback provider (defaults to the rule-based provider). */
  provider?: AssistantProvider;
  /** Apply a proposed plan as one undoable edit through the controlled action layer. */
  onApplyPlan?: (plan: AssistantPlan) => ApplyResult;
  /** Open the AI setup dialog to configure a live model. */
  onOpenSetup?: () => void;
}

type Role = "user" | "assistant" | "tool" | "error";
interface ChatEntry {
  id: number;
  role: Role;
  content: string;
  plan?: AssistantPlan;
  applied?: { ok: boolean; text: string };
}

const OPEN_KEY = "esco.fai.v1.open";
const POS_KEY = "esco.fai.v1.pos";
const AUTO_KEY = "esco.fai.v1.autoapply";
const POPOVER_W = 372;

const QUICK_PROMPTS = [
  "Explain the selected rung",
  "Diagnose the current validation findings and propose fixes",
  "Propose a motor seal-in (start/stop) rung with an E-stop interlock",
  "Create any undefined tags referenced in logic",
];

function read(key: string, fallback = false): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return fallback;
  }
}
function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
  } catch {
    return null;
  }
}

export function FloatingAssistant({
  project,
  selectedRoutineId,
  selectedRungId,
  modelLabel,
  aiProvider,
  modelId,
  apiKey,
  provider,
  onApplyPlan,
  onOpenSetup,
}: FloatingAssistantProps) {
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY));
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoApply, setAutoApply] = useState<boolean>(() => read(AUTO_KEY));
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const seq = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const offlineProvider = useMemo(() => provider ?? getDefaultProvider(), [provider]);
  const live = !!aiProvider && !!apiKey?.trim() && !!modelId?.trim();

  useEffect(() => write(OPEN_KEY, open), [open]);
  useEffect(() => write(AUTO_KEY, autoApply), [autoApply]);
  useEffect(() => {
    try {
      if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  // Global toggle: Ctrl/Cmd+I.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [entries, busy]);

  const push = useCallback((entry: Omit<ChatEntry, "id">): number => {
    seq.current += 1;
    const id = seq.current;
    setEntries((prev) => [...prev, { ...entry, id }].slice(-120));
    return id;
  }, []);
  const patch = useCallback((id: number, partial: Partial<ChatEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...partial } : e)));
  }, []);

  const applyPlan = useCallback(
    (entryId: number, plan: AssistantPlan): boolean => {
      if (!onApplyPlan) return false;
      const result = onApplyPlan(plan);
      const errors = result.findings.filter((f) => f.severity === "error").length;
      patch(entryId, {
        applied: {
          ok: result.ok,
          text: result.ok
            ? `✓ Applied ${result.applied.length} action(s) — undoable (Ctrl+Z).${errors ? ` ${errors} validation error(s) after apply.` : " Validation clean."}`
            : `Apply failed: ${result.error ?? "unknown error"}`,
        },
      });
      return result.ok;
    },
    [onApplyPlan, patch],
  );

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || busy) return;
      if (!project) {
        push({ role: "assistant", content: "Open or create a project first, then I can help with it." });
        return;
      }
      push({ role: "user", content: trimmed });
      setInput("");
      setBusy(true);
      try {
        if (live) {
          const caller = createModelCaller({ mode: "browser-key", provider: aiProvider, modelId, apiKey });
          const result = await runAgent({
            caller,
            project,
            prompt: trimmed,
            modelId,
            selection: selectedRoutineId ? { routineId: selectedRoutineId } : undefined,
            onProgress: (entry: AgentTranscriptEntry) => {
              const role: Role = entry.role === "tool" ? "tool" : entry.role === "error" ? "error" : "assistant";
              push({ role, content: entry.text });
            },
          });
          if (!result.ok && result.error) push({ role: "error", content: result.error });
          if (result.plan && result.plan.actions.length > 0) {
            const planText = `${result.plan.title} — ${result.plan.actions.length} proposed action(s).`;
            const id = push({ role: "assistant", content: planText, plan: result.plan });
            if (autoApply && onApplyPlan) applyPlan(id, result.plan);
          }
        } else {
          const result = await offlineProvider.run({
            prompt: trimmed,
            project,
            selection: selectedRoutineId ? { routineId: selectedRoutineId, rungId: selectedRungId } : undefined,
          });
          const id = push({
            role: "assistant",
            content: result.ok ? result.message : result.error ?? result.message ?? "I couldn't process that.",
            plan: result.plan,
          });
          if (autoApply && onApplyPlan && result.plan && result.plan.actions.length > 0) applyPlan(id, result.plan);
        }
      } catch (error) {
        push({ role: "error", content: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    },
    [live, aiProvider, modelId, apiKey, offlineProvider, project, selectedRoutineId, selectedRungId, busy, autoApply, onApplyPlan, applyPlan, push],
  );

  // Drag (ignore presses on header buttons so their clicks aren't swallowed by capture).
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button, label")) return;
    const rect = (e.currentTarget.closest(".esco-fai__panel") as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const x = Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - POPOVER_W - 8);
    const y = Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - 80);
    setPos({ x, y });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const panelStyle: CSSProperties = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : { right: 20, bottom: 88 };

  const node = (
    <>
      <button
        type="button"
        className={`esco-fai__fab${open ? " is-open" : ""}${live ? " is-live" : ""}`}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        aria-expanded={open}
        title="ESCO AI assistant (Ctrl/Cmd+I)"
        data-testid="floating-ai-fab"
        onClick={() => setOpen((o) => !o)}
      >
        <AiGlyph open={open} />
        {live && <span className="esco-fai__livedot" aria-hidden="true" />}
      </button>

      {open && (
        <section className="esco-fai__panel" style={panelStyle} role="dialog" aria-label="ESCO AI assistant" data-testid="floating-ai-panel">
          <header className="esco-fai__head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            <span className="esco-fai__title"><AiGlyph small /> ESCO AI</span>
            <span className={`esco-fai__badge${live ? " is-live" : ""}`} title={live ? "Connected to the configured live model" : "Offline rule-based assistant"} data-testid="floating-ai-mode">
              {live ? "● Live" : "Offline"}
            </span>
            <span className="esco-fai__spacer" />
            <button type="button" className="esco-fai__iconbtn" aria-label="Minimize" title="Minimize" onClick={() => setOpen(false)}>—</button>
          </header>

          <div className="esco-fai__body" ref={bodyRef} data-testid="floating-ai-body">
            {entries.length === 0 && (
              <div className="esco-fai__welcome">
                <p>{live
                  ? "I can inspect this project and make live edits — tags, rungs, logic, and HMI — applied as one undoable change."
                  : "Ask about your project, logic, tags, alarms, or the Simulation Lab. Configure a live model to let me make edits."}</p>
                <div className="esco-fai__chips">
                  {QUICK_PROMPTS.map((q) => (
                    <button key={q} type="button" className="esco-fai__chip" onClick={() => void send(q)}>{q}</button>
                  ))}
                </div>
                {!live && onOpenSetup && (
                  <button type="button" className="esco-fai__setup" onClick={onOpenSetup}>Set up live model →</button>
                )}
              </div>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className={`esco-fai__msg is-${entry.role}`}>
                <div className="esco-fai__bubble">{entry.content}</div>
                {entry.plan && entry.plan.actions.length > 0 && (
                  <div className="esco-fai__plan">
                    <div className="esco-fai__plan-title">{entry.plan.title}</div>
                    <ul className="esco-fai__plan-list">
                      {entry.plan.actions.slice(0, 8).map((a) => <li key={a.id}><b>{a.kind}</b> — {a.label}</li>)}
                    </ul>
                    {entry.plan.warnings.length > 0 && (
                      <ul className="esco-fai__warn">{entry.plan.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
                    )}
                    {entry.applied ? (
                      <div className={`esco-fai__applied${entry.applied.ok ? "" : " is-err"}`}>{entry.applied.text}</div>
                    ) : onApplyPlan ? (
                      <button type="button" className="esco-fai__apply" data-testid="floating-ai-apply" onClick={() => applyPlan(entry.id, entry.plan!)}>Apply change</button>
                    ) : (
                      <div className="esco-fai__hint">Preview only.</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="esco-fai__msg is-assistant"><div className="esco-fai__bubble esco-fai__typing"><span /><span /><span /></div></div>}
          </div>

          <form className="esco-fai__input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              placeholder={live ? "Ask me to inspect or edit this project…" : "Ask the ESCO assistant…"}
              data-testid="floating-ai-input"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button type="submit" className="esco-fai__send" disabled={busy || !input.trim()} aria-label="Send" data-testid="floating-ai-send">▶</button>
          </form>

          <footer className="esco-fai__foot">
            {live ? (
              <label className="esco-fai__auto" title="Apply proposed edits automatically (still undoable with Ctrl+Z)">
                <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} data-testid="floating-ai-autoapply" />
                Auto-apply edits
              </label>
            ) : (
              <span>Offline · previews only</span>
            )}
            <span className="esco-fai__spacer" />
            <span className="esco-fai__modeltxt" title="Active model">{modelLabel ?? (live ? "Live model" : "Offline")}</span>
            {onOpenSetup && <button type="button" className="esco-fai__link" onClick={onOpenSetup}>AI setup</button>}
          </footer>
        </section>
      )}
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

function AiGlyph({ small, open }: { small?: boolean; open?: boolean }) {
  const s = small ? 14 : 22;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="4" y="6" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" />
      <line x1="12" y1="3" x2="12" y2="6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="2.4" r="1.2" fill="currentColor" />
      {!open && <path d="M8 20l2-2M16 20l-2-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
