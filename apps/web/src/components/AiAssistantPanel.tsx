import { useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  runAssistant,
  type ApplyResult,
  type AssistantPlan,
  type AssistantResult,
} from "@esco/ai-assistant";

interface Props {
  project: PlcProject;
  selectedRoutineId?: string;
  onApply: (plan: AssistantPlan) => ApplyResult;
}

const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain rung", prompt: "explain rung" },
  { label: "Explain routine", prompt: "explain routine" },
  { label: "Generate motor starter", prompt: "generate motor starter" },
  { label: "Fix undefined tags", prompt: "fix undefined tags" },
  { label: "Timer example", prompt: "timer example" },
  { label: "Counter example", prompt: "counter example" },
  { label: "MOV example", prompt: "mov example" },
];

export function AiAssistantPanel({ project, selectedRoutineId, onApply }: Props) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [copied, setCopied] = useState(false);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setApplied(null);
    setCopied(false);
    setResult(
      runAssistant({
        prompt: trimmed,
        project,
        selection: selectedRoutineId ? { routineId: selectedRoutineId } : undefined,
      }),
    );
  };

  const handleApply = () => {
    if (result?.plan) setApplied(onApply(result.plan));
  };

  const handleCopy = () => {
    if (!result) return;
    void navigator.clipboard?.writeText(result.message).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const handleClear = () => {
    setPrompt("");
    setResult(null);
    setApplied(null);
    setCopied(false);
  };

  const plan = result?.plan;
  const errorFindings = applied?.findings.filter((f) => f.severity === "error") ?? [];

  return (
    <div className="esco-ai">
      <p className="esco-ai__notice">
        Offline / local assistant. Suggestions must be reviewed before Apply. No PLC communication —
        changes go only through the controlled project-action layer.
      </p>

      <div className="esco-ai__prompt">
        <input
          className="esco-ai__input"
          value={prompt}
          placeholder="Ask the assistant… (e.g. explain routine)"
          spellCheck={false}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask(prompt);
          }}
        />
        <button type="button" className="esco-btn esco-btn--primary" onClick={() => ask(prompt)}>
          Send
        </button>
        <button type="button" className="esco-btn" onClick={handleClear}>
          Clear
        </button>
      </div>

      <div className="esco-ai__quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.prompt}
            type="button"
            className="esco-btn esco-btn--quick"
            onClick={() => {
              setPrompt(action.prompt);
              ask(action.prompt);
            }}
          >
            {action.label}
          </button>
        ))}
      </div>

      {result ? (
        <div className="esco-ai__response">
          <div className="esco-ai__response-head">
            <span>Assistant</span>
            <button type="button" className="esco-btn esco-btn--quick" onClick={handleCopy}>
              {copied ? "Copied ✓" : "Copy explanation"}
            </button>
          </div>
          <pre className="esco-ai__message">{result.message}</pre>

          {plan ? (
            <div className="esco-ai__plan">
              <div className="esco-ai__plan-title">
                {plan.title} — proposed actions ({plan.actions.length})
              </div>
              {plan.actions.length === 0 ? (
                <p className="esco-empty">Nothing to do.</p>
              ) : (
                <ul className="esco-ai__actions">
                  {plan.actions.map((action) => (
                    <li key={action.id} className="esco-ai__action">
                      <div className="esco-ai__action-head">
                        <span className="esco-ai__action-kind">{action.kind}</span>
                        <span className="esco-ai__action-label">{action.label}</span>
                      </div>
                      {action.description ? (
                        <span className="esco-ai__action-desc">{action.description}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {plan.warnings.length > 0 ? (
                <ul className="esco-ai__warnings">
                  {plan.warnings.map((warning, index) => (
                    <li key={index}>⚠ {warning}</li>
                  ))}
                </ul>
              ) : null}
              {plan.actions.length > 0 ? (
                <button type="button" className="esco-btn esco-btn--primary" onClick={handleApply}>
                  Apply actions
                </button>
              ) : null}
            </div>
          ) : null}

          {applied ? (
            <div
              className={`esco-ai__applied${applied.ok ? "" : " esco-ai__applied--error"}`}
              role="status"
            >
              {applied.ok ? (
                <>
                  <div>✓ Applied successfully — {applied.applied.length} action(s).</div>
                  <div>
                    Validation after apply:{" "}
                    {applied.findings.length === 0
                      ? "clean."
                      : `${applied.findings.length} finding(s)${
                          errorFindings.length ? `, ${errorFindings.length} error(s)` : ""
                        }.`}
                  </div>
                </>
              ) : (
                <div>Apply failed: {applied.error}</div>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="esco-ai__empty">
          Ask a question or pick a quick action. I propose changes; you preview and Apply them.
        </p>
      )}
    </div>
  );
}
