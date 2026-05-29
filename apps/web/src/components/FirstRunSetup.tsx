import { useEffect, useState } from "react";
import {
  defaultModelForProvider,
  providerLabel,
  type AiProfile,
  type AiProvider,
} from "../ai-profile";

interface Props {
  open: boolean;
  profile: AiProfile | null;
  onClose: () => void;
  onSave: (profile: Partial<AiProfile>) => void;
}

export function FirstRunSetup({ open, profile, onClose, onSave }: Props) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "Controls Engineer");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [provider, setProvider] = useState<AiProvider>(profile?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(
    profile?.modelId ?? defaultModelForProvider(profile?.provider ?? "anthropic"),
  );
  const [apiKey, setApiKey] = useState(profile?.apiKey ?? "");

  useEffect(() => {
    if (!open) return;
    const nextProvider = profile?.provider ?? "anthropic";
    setDisplayName(profile?.displayName ?? "Controls Engineer");
    setEmail(profile?.email ?? "");
    setProvider(nextProvider);
    setModelId(profile?.modelId ?? defaultModelForProvider(nextProvider));
    setApiKey(profile?.apiKey ?? "");
  }, [open, profile]);

  if (!open) return null;

  const canSave = displayName.trim().length > 0 && modelId.trim().length > 0 && apiKey.trim().length > 0;
  const updateProvider = (nextProvider: AiProvider) => {
    setProvider(nextProvider);
    setModelId(defaultModelForProvider(nextProvider));
  };

  return (
    <div className="esco-setup" role="dialog" aria-modal="true" aria-labelledby="esco-setup-title">
      <div className="esco-setup__panel">
        <header className="esco-setup__header">
          <div>
            <span className="esco-setup__eyebrow">Workstation setup</span>
            <h2 id="esco-setup-title">Set up ESCO Automation Studio</h2>
            <p>
              Sign in on this Windows workstation and save the AI key once. The Copilot will use it
              automatically after this.
            </p>
          </div>
          <button type="button" className="esco-icon-btn" aria-label="Close setup" onClick={onClose}>
            x
          </button>
        </header>

        <div className="esco-setup__fields">
          <label className="esco-setup__field">
            <span>Name</span>
            <input
              value={displayName}
              placeholder="Controls Engineer"
              spellCheck={false}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="esco-setup__field">
            <span>AI provider</span>
            <select value={provider} onChange={(event) => updateProvider(event.target.value as AiProvider)}>
              <option value="anthropic">Anthropic / Claude</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="esco-setup__field">
            <span>Model</span>
            <input
              value={modelId}
              placeholder={defaultModelForProvider(provider)}
              spellCheck={false}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          <label className="esco-setup__field">
            <span>Work email</span>
            <input
              value={email}
              placeholder="engineer@company.com"
              spellCheck={false}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="esco-setup__field">
            <span>{providerLabel(provider)} API key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </div>

        <footer className="esco-setup__footer">
          <span>Saved locally for this workstation.</span>
          <div className="esco-setup__actions">
            <button type="button" className="esco-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="esco-btn esco-btn--primary"
              disabled={!canSave}
              onClick={() => onSave({ displayName, email, provider, modelId, apiKey })}
            >
              Save setup
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
