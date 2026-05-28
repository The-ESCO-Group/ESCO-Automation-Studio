import { useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  runAgent,
  type AgentTranscriptEntry,
  type ApplyResult,
  type AssistantPlan,
} from "@esco/ai-assistant";
import { createModelCaller } from "../ai-online";
import "./CopilotLiveAgent.css";

interface Props {
  project: PlcProject;
  selectedRoutineId?: string;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
  modelLabel: string;
  apiKey: string;
  onOpenSetup: () => void;
  empty?: boolean;
}

const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain selected rung", prompt: "Explain the selected rung in plain language." },
  { label: "Explain this routine", prompt: "Explain what the selected routine does." },
  { label: "Diagnose validation", prompt: "Look at the current validation findings and explain what's wrong and how to fix it." },
  { label: "Fix undefined tags", prompt: "Find undefined tags referenced in logic and propose creating them with sensible data types." },
  { label: "Add seal-in starter", prompt: "Propose a seal-in motor starter (Start/Stop/Run) in the selected routine, creating any missing tags first." },
];

export function CopilotLiveAgent({
  project,
  selectedRoutineId,
  onApplyPlan,
  modelLabel,
  apiKey,
  onOpenSetup,
  empty = false,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [transcript, setTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setError(null);
    setApplied(null);
    setPlan(null);
    setPrompt("");
    setLastPrompt(trimmed);
    setTranscript([]);

    let caller;
    try {
      caller = createModelCaller({ mode: "browser-key", apiKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Open Settings to finish AI setup.");
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
    setLastPrompt("");
    setTranscript([]);
    setPlan(null);
    setApplied(null);
    setError(null);
  };

  const hasActions = (plan?.actions.length ?? 0) > 0;
  const errorFindings = applied?.findings.filter((f) => f.severity === "error") ?? [];
  const configured = apiKey.trim().length > 0;

  return (
    <div className="esco-ai esco-copilot-live">
      <div className="esco-ai__scroll" aria-label="Live AI Copilot conversation" aria-live="polite">
        <div className="esco-ai__thread">
          {!lastPrompt && transcript.length === 0 && !running && !error ? (
            <div className="esco-ai__bubble-row esco-ai__bubble-row--assistant">
              <span className="esco-ai__avatar" aria-hidden="true">
                AI
              </span>
              <article className="esco-ai__bubble esco-ai__bubble--assistant">
                <div className="esco-ai__bubble-meta">AI Copilot</div>
                <pre className="esco-ai__bubble-text">
                  {configured
                    ? "Ask me to explain logic, diagnose validation findings, or propose reviewed ladder actions."
                    : "AI setup is not finished on this workstation. Add your API key once in Settings, then Copilot will remember it."}
                </pre>
                {!configured ? (
                  <button type="button" className="esco-btn esco-btn--primary esco-ai__setup" onClick={onOpenSetup}>
                    Set up AI
                  </button>
                ) : null}
              </article>
            </div>
          ) : null}

          {lastPrompt ? (
            <div className="esco-ai__bubble-row esco-ai__bubble-row--user">
              <article className="esco-ai__bubble esco-ai__bubble--user">
                <div className="esco-ai__bubble-meta">You</div>
                <pre className="esco-ai__bubble-text">{lastPrompt}</pre>
              </article>
            </div>
          ) : null}

          {transcript.map((entry, i) => (
            <div
              key={i}
              className={`esco-ai__bubble-row esco-ai__bubble-row--assistant esco-copilot-live__turn esco-copilot-live__turn--${entry.role}`}
            >
              <span className="esco-ai__avatar" aria-hidden="true">
                {entry.role === "tool" ? "T" : "AI"}
              </span>
              <article
                className={`esco-ai__bubble esco-ai__bubble--assistant${
                  entry.role === "tool" ? " esco-ai__bubble--tool" : ""
                }${entry.role === "error" ? " esco-ai__bubble--error" : ""}`}
              >
                <div className="esco-ai__bubble-meta">
                  {entry.role === "tool" ? "Project tool" : "AI Copilot"}
                </div>
                {entry.role === "tool" ? (
                  <code className="esco-copilot-live__tool-text">{entry.text}</code>
                ) : (
                  <pre className="esco-ai__bubble-text esco-ai__message">{entry.text}</pre>
                )}
              </article>
            </div>
          ))}

          {running ? (
            <div className="esco-ai__bubble-row esco-ai__bubble-row--assistant">
              <span className="esco-ai__avatar" aria-hidden="true">
                AI
              </span>
              <article className="esco-ai__bubble esco-ai__bubble--assistant">
                <div className="esco-ai__bubble-meta">AI Copilot</div>
                <div className="esco-ai__typing" role="status">
                  Working...
                </div>
              </article>
            </div>
          ) : null}
        </div>

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

      <div className="esco-ai__quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            className="esco-btn esco-btn--quick"
            disabled={running}
            onClick={() => {
              setPrompt(action.prompt);
              if (configured) void run(action.prompt);
              else onOpenSetup();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="esco-ai__prompt">
        <textarea
          className="esco-ai__input esco-ai__input--composer"
          value={prompt}
          placeholder={configured ? "Ask Copilot about this project..." : "Set up AI to start chatting..."}
          spellCheck={false}
          rows={2}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run(prompt);
            }
          }}
        />
        <button type="button" className="esco-btn esco-btn--primary" disabled={running} onClick={() => void run(prompt)}>
          {running ? "..." : "Send"}
        </button>
        <button type="button" className="esco-btn" onClick={handleClear}>
          Clear
        </button>
      </div>

      <div className="esco-ai__footer">
        <span>Model: {modelLabel}</span>
        <span>{empty ? "No project" : "Reviewed actions only"}</span>
      </div>
    </div>
  );
}
