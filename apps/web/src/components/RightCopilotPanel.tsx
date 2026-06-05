import type { PlcProject } from "@esco/core";
import { type ApplyResult, type AssistantPlan } from "@esco/ai-assistant";
import type { ValidationFinding } from "@esco/validator";
import type { ActivityEntry } from "../activity";
import type { AiProvider } from "../ai-profile";
import type { Selection } from "../selection";
import type { TagValues } from "../simulation";
import { CopilotLiveAgent } from "./CopilotLiveAgent";
import { HelpPanel } from "./HelpPanel";
import { HistoryPanel } from "./HistoryPanel";
import { ModelSummaryPanel } from "./ModelSummaryPanel";
import { PropertiesPanel } from "./PropertiesPanel";

export type CopilotTab = "chat" | "model" | "history" | "help";

interface Props {
  tab: CopilotTab;
  onTabChange: (tab: CopilotTab) => void;
  empty?: boolean;
  modelName: string;
  project: PlcProject;
  selection: Selection;
  values: TagValues;
  findings: ValidationFinding[];
  selectedRoutineId?: string;
  openRoutineName?: string;
  aiProvider?: AiProvider;
  modelId?: string;
  apiKey?: string;
  onOpenSetup: () => void;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
  undoDepth: number;
  redoDepth: number;
  dirty: boolean;
  activity: ActivityEntry[];
}

/** Right-side offline copilot panel with chat and local history/context. */
export function RightCopilotPanel({
  tab,
  onTabChange,
  empty = false,
  modelName,
  project,
  selection,
  values,
  findings,
  selectedRoutineId,
  openRoutineName,
  aiProvider,
  modelId,
  apiKey,
  onOpenSetup,
  onApplyPlan,
  undoDepth,
  redoDepth,
  dirty,
  activity,
}: Props) {
  const configured = !!aiProvider && !!modelId?.trim() && !!apiKey?.trim();
  const badgeLabel = configured ? "ONLINE" : "SETUP REQUIRED";

  return (
    <section className="esco-copilot">
      <header className="esco-copilot__header">
        <div>
          <h2 className="esco-copilot__title">AI Copilot</h2>
          <span className="esco-copilot__subtitle">
            {configured ? "Reviewed ladder/HMI actions only" : "Choose provider and model in setup"}
          </span>
        </div>
        <span className={`esco-copilot__badge${configured ? "" : " is-setup"}`}>{badgeLabel}</span>
      </header>

      <nav className="esco-copilot__tabs" aria-label="AI Copilot tabs">
        <button
          type="button"
          className={`esco-copilot__tab${tab === "chat" ? " is-active" : ""}`}
          onClick={() => onTabChange("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={`esco-copilot__tab${tab === "model" ? " is-active" : ""}`}
          onClick={() => onTabChange("model")}
        >
          Model
        </button>
        <button
          type="button"
          className={`esco-copilot__tab${tab === "history" ? " is-active" : ""}`}
          onClick={() => onTabChange("history")}
        >
          History
        </button>
        <button
          type="button"
          className={`esco-copilot__tab${tab === "help" ? " is-active" : ""}`}
          onClick={() => onTabChange("help")}
        >
          Help
        </button>
      </nav>

      <div className="esco-copilot__body">
        {tab === "chat" ? (
          <div className="esco-copilot__chat">
            <CopilotLiveAgent
              project={project}
              selectedRoutineId={selectedRoutineId}
              onApplyPlan={onApplyPlan}
              modelLabel={modelName}
              aiProvider={aiProvider}
              modelId={modelId}
              apiKey={apiKey ?? ""}
              onOpenSetup={onOpenSetup}
              empty={empty}
            />
          </div>
        ) : tab === "model" ? (
          <ModelSummaryPanel project={project} findings={findings} openRoutineName={openRoutineName} />
        ) : tab === "history" ? (
          <div className="esco-copilot__history">
            <PropertiesPanel project={project} selection={selection} values={values} findings={findings} />
            <HistoryPanel undoDepth={undoDepth} redoDepth={redoDepth} dirty={dirty} activity={activity} />
          </div>
        ) : (
          <HelpPanel />
        )}
      </div>
    </section>
  );
}
