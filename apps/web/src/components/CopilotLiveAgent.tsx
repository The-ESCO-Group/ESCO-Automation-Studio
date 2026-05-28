import { useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  runAgent,
  type AgentTranscriptEntry,
  type ApplyResult,
  type AssistantPlan,
  type AgentProviderMode,
} from "@esco/ai-assistant";
import { createModelCaller } from "../ai-online";
import "./CopilotLiveAgent.css";

interface Props {
  project: PlcProject;
  selectedRoutineId?: string;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
  modelLabel: string;
}

const TRANSPORT_KEY = "esco.ai.transport";
const APIKEY_KEY = "esco.anthropic.key";

const readSession = (key: string, fallback: string): string => {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeSession = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage unavailable — keep in memory only */
  }
};

const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain selected rung", prompt: "Explain the selected rung in plain language." },
  { label: "Explain this routine", prompt: "Explain what the selected routine does." },
  { label: "Diagnose validation", prompt: "Look at the current validation findings and explain what's wrong and how to fix it." },
  { label: "Fix undefined tags", prompt: "Find undefined tags referenced in logic and propose creating them with sensible data types." },
  { label: "Add seal-in starter", prompt: "Propose a seal-in motor starter (Start/Stop/Run) in the selected routine, creating any missing tags first." },
];

export function CopilotLiveAgent({ project, selectedRoutineId, onApplyPlan, modelLabel }: Props) {
  const [transport, setTransportState] = useState<AgentProviderMode>(() =>
    readSession(TRANSPORT_KEY, "browser-key") === "proxy" ? "proxy" : "browser-key",
  );
  const [apiKey, setApiKeyState] = useState<string>(() => readSession(APIKEY_KEY, ""));
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [transcript, setTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setTransport = (next: AgentProviderMode) => {
    setTransportState(next);
    writeSession(TRANSPORT_KEY, next);
  };
  const setApiKey = (next: string) => {
    setApiKeyState(next);
    writeSession(APIKEY_KEY, next);
  };

  const run = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setError(null);
    setApplied(null);
    setPlan(null);
    setTranscript([]);

    let caller;
    try {
      caller = createModelCaller({ mode: transport, apiKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the assistant.");
      return;
    }

    setRunning(true);
    const result = await runAgent({
      caller,
      project,
      prompt: trimmed,
      selection: selectedRoutineId ? { routineId: selectedRoutineId } : undefined,
      onProgress: (entry) => setTranscript((prev) => [...prev, entry]),
    });
    setRunning(false);
    setPlan(result.plan);
    if (!result.ok && result.error) setError(result.error);
  };

  const handleApply = () => {
    if (plan) setApplied(onApplyPlan(plan));
  };
  const handleClear = () => {
    setPrompt("");
    setTranscript([]);
    setPlan(null);
    setApplied(null);
    setError(null);
  };

  const hasActions = (plan?.actions.length ?? 0) > 0;
  const errorFindings = applied?.findings.filter((f) => f.severity === "error") ?? [];
  const keyStatus = transport === "proxy"
    ? "Using server proxy (key stays on the server)."
    : apiKey.trim()
      ? "Key stored for this browser session only."
      : "No key entered.";

  return (
    <div className="esco-ai esco-copilot-live">
      <p className="esco-ai__notice esco-ai__notice--online">
        Online mode sends your selected prompt and project context to the configured AI provider
        ({modelLabel}). It edits the project only by proposing actions you review and Apply — through
        the controlled project-action layer. No PLC, .ACD, or file access.
      </p>

      <div className="esco-copilot-live__config">
        <label className="esco-copilot-live__row">
          Transport:
          <select
            className="esco-tags__select"
            value={transport}
            onChange={(e) => setTransport(e.target.value === "proxy" ? "proxy" : "browser-key")}
          >
            <option value="browser-key">Browser key (developer/local testing only)</option>
            <option value="proxy">Server proxy (production — env key)</option>
          </select>
        </label>
        {transport === "browser-key" ? (
          <input
            className="esco-ai__input"
            type="password"
            value={apiKey}
            placeholder="Anthropic API key (sk-ant-…) — session-only, never written to disk"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
          />
        ) : null}
        <div className="esco-copilot-live__keystatus">{keyStatus}</div>
      </div>

      <div className="esco-ai__scroll">
        {transcript.length === 0 && !running && !error ? (
          <p className="esco-ai__empty">
            Ask the live agent to explain logic, diagnose validation, or propose ladder edits. It
            inspects the project, then proposes a plan you review and Apply.
          </p>
        ) : (
          <div className="esco-ai__response">
            <ul className="esco-copilot-live__transcript">
              {transcript.map((entry, i) => (
                <li key={i} className={`esco-copilot-live__turn esco-copilot-live__turn--${entry.role}`}>
                  {entry.role === "tool" ? <code>{entry.text}</code> : <pre className="esco-ai__message">{entry.text}</pre>}
                </li>
              ))}
            </ul>
            {running ? <div className="esco-ai__working" role="status">Working…</div> : null}

            {plan && hasActions ? (
              <div className="esco-ai__plan">
                <div className="esco-ai__plan-title">
                  {plan.title} — review &amp; apply ({plan.actions.length})
                </div>
                <ul className="esco-ai__actions">
                  {plan.actions.map((action) => (
                    <li key={action.id} className="esco-ai__action">
                      <div className="esco-ai__action-head">
                        <span className="esco-ai__action-kind">{action.kind}</span>
                        <span className="esco-ai__action-label">{action.label}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {plan.warnings.length > 0 ? (
                  <ul className="esco-ai__warnings">
                    {plan.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                ) : null}
                {!applied ? (
                  <button type="button" className="esco-btn esco-btn--primary" onClick={handleApply}>
                    Apply proposed actions
                  </button>
                ) : null}
              </div>
            ) : null}

            {applied ? (
              <div className={`esco-ai__applied${applied.ok ? "" : " esco-ai__applied--error"}`} role="status">
                {applied.ok ? (
                  <>
                    <div>✓ Applied {applied.applied.length} action(s) through project-actions (undoable with Ctrl+Z).</div>
                    <div>
                      Validation after apply:{" "}
                      {applied.findings.length === 0
                        ? "clean."
                        : `${applied.findings.length} finding(s)${errorFindings.length ? `, ${errorFindings.length} error(s)` : ""}.`}
                    </div>
                  </>
                ) : (
                  <div>Apply failed: {applied.error}</div>
                )}
              </div>
            ) : null}

            {error ? (
              <div className="esco-ai__applied esco-ai__applied--error" role="status">{error}</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="esco-ai__quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            className="esco-btn esco-btn--quick"
            disabled={running}
            onClick={() => {
              setPrompt(action.prompt);
              void run(action.prompt);
            }}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="esco-ai__prompt">
        <input
          className="esco-ai__input"
          value={prompt}
          placeholder="Ask the live agent to explain or change the logic…"
          spellCheck={false}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run(prompt);
          }}
        />
        <button type="button" className="esco-btn esco-btn--primary" disabled={running} onClick={() => void run(prompt)}>
          {running ? "Working…" : "Send"}
        </button>
        <button type="button" className="esco-btn" onClick={handleClear}>
          Clear
        </button>
      </div>

      <div className="esco-ai__footer">
        <span>Model: {modelLabel}</span>
        <span>{transport === "proxy" ? "Proxy mode" : "Browser-key mode"}</span>
      </div>
    </div>
  );
}
