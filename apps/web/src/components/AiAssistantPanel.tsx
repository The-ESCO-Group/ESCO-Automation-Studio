import { useMemo, useState } from "react";
import type { PlcProject } from "@esco/core";
import {
  getDefaultProvider,
  type ApplyResult,
  type AssistantPlan,
  type AssistantResult,
} from "@esco/ai-assistant";

interface Props {
  project: PlcProject;
  selectedRoutineId?: string;
  onApply: (plan: AssistantPlan) => ApplyResult;
  empty?: boolean;
  modelName?: string;
}

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  tone?: "error";
};

const INTRO_MESSAGE =
  "Hi, I can help explain logic, diagnose validation findings, suggest fixes, and generate reviewed ladder actions.";

const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain this routine", prompt: "explain routine" },
  { label: "Why is this validation failing?", prompt: "explain validation errors" },
  { label: "Suggest a fix", prompt: "fix undefined tags" },
  { label: "Add safe starter logic", prompt: "generate motor starter" },
];

const EMPTY_QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain this routine", prompt: "explain routine" },
  { label: "Why is this validation failing?", prompt: "explain validation errors" },
  { label: "Suggest a fix", prompt: "fix undefined tags" },
  { label: "Add safe starter logic", prompt: "generate motor starter" },
];

const createMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createIntro = (): ChatMessage => ({
  id: "intro",
  role: "assistant",
  text: `${INTRO_MESSAGE}\n\nI only propose reviewed actions. Project changes still go through project-actions.`,
});

export function AiAssistantPanel({
  project,
  selectedRoutineId,
  onApply,
  empty = false,
  modelName = "Opus 4.7",
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createIntro()]);
  const [latestAssistantId, setLatestAssistantId] = useState("intro");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);

  const provider = useMemo(() => getDefaultProvider(), []);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || working) return;

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      text: trimmed,
    };

    setPrompt("");
    setApplied(null);
    setCopied(false);
    setWorking(true);
    setMessages((current) => [...current, userMessage]);

    try {
      const res = await provider.run({
        prompt: trimmed,
        project,
        selection: selectedRoutineId ? { routineId: selectedRoutineId } : undefined,
      });
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        text: res.message,
        tone: res.ok ? undefined : "error",
      };
      setResult(res);
      setLatestAssistantId(assistantMessage.id);
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant failed.";
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        text: message,
        tone: "error",
      };
      setResult({
        ok: false,
        message,
        error: "provider-error",
      });
      setLatestAssistantId(assistantMessage.id);
      setMessages((current) => [...current, assistantMessage]);
    } finally {
      setWorking(false);
    }
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
    setMessages([createIntro()]);
    setLatestAssistantId("intro");
    setResult(null);
    setApplied(null);
    setCopied(false);
    setWorking(false);
  };

  const plan = result?.plan;
  const quickActions = empty ? EMPTY_QUICK_ACTIONS : QUICK_ACTIONS;
  const errorFindings = applied?.findings.filter((finding) => finding.severity === "error") ?? [];

  return (
    <div className="esco-ai esco-ai--chat">
      <div className="esco-ai__scroll" aria-label="AI Copilot conversation" aria-live="polite">
        <div className="esco-ai__thread">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`esco-ai__bubble-row esco-ai__bubble-row--${message.role}`}
            >
              {message.role === "assistant" ? (
                <span className="esco-ai__avatar" aria-hidden="true">
                  AI
                </span>
              ) : null}
              <article
                className={`esco-ai__bubble esco-ai__bubble--${message.role}${
                  message.tone === "error" ? " esco-ai__bubble--error" : ""
                }`}
              >
                <div className="esco-ai__bubble-meta">
                  {message.role === "assistant" ? "AI Copilot" : "You"}
                </div>
                <pre
                  className={
                    message.id === latestAssistantId
                      ? "esco-ai__bubble-text esco-ai__message"
                      : "esco-ai__bubble-text"
                  }
                >
                  {message.text}
                </pre>
              </article>
            </div>
          ))}

          {working ? (
            <div className="esco-ai__bubble-row esco-ai__bubble-row--assistant">
              <span className="esco-ai__avatar" aria-hidden="true">
                AI
              </span>
              <article className="esco-ai__bubble esco-ai__bubble--assistant">
                <div className="esco-ai__bubble-meta">AI Copilot</div>
                <div className="esco-ai__typing" role="status">
                  Thinking...
                </div>
              </article>
            </div>
          ) : null}
        </div>

        {result ? (
          <div className="esco-ai__latest-tools">
            <button type="button" className="esco-btn esco-btn--quick" onClick={handleCopy}>
              {copied ? "Copied" : "Copy explanation"}
            </button>
          </div>
        ) : null}

        {plan ? (
          <div className="esco-ai__plan">
            <div className="esco-ai__plan-title">
              {plan.title} - proposed actions ({plan.actions.length})
            </div>
            {plan.actions.length === 0 ? (
              <p className="esco-empty">Nothing to apply.</p>
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
                  <li key={index}>{warning}</li>
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
                <div>Applied successfully - {applied.applied.length} action(s).</div>
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

      <div className="esco-ai__quick" aria-label="Quick prompts">
        {quickActions.map((action) => (
          <button
            key={action.prompt}
            type="button"
            className="esco-btn esco-btn--quick"
            disabled={working}
            onClick={() => void ask(action.prompt)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className={`esco-ai__prompt${empty ? " esco-ai__prompt--compact" : ""}`}>
        <textarea
          className="esco-ai__input esco-ai__input--composer"
          value={prompt}
          placeholder="Ask a question or describe your issue..."
          spellCheck={false}
          rows={2}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(prompt);
            }
          }}
        />
        <div className="esco-ai__prompt-actions">
          <button
            type="button"
            className="esco-btn esco-btn--primary esco-ai__send"
            disabled={working}
            onClick={() => void ask(prompt)}
          >
            {working ? "..." : "Send"}
          </button>
          {!empty ? (
            <button type="button" className="esco-btn esco-ai__clear" onClick={handleClear}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="esco-ai__footer">
        <span>Model: {modelName}</span>
        <span>Context: {selectedRoutineId ? "Selected routine" : "No routine open"}</span>
      </div>
    </div>
  );
}
