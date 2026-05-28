import type { PlcProject } from "@esco/core";
import { type ApplyResult, type AssistantPlan } from "@esco/ai-assistant";
import type { ValidationFinding } from "@esco/validator";
import type { ActivityEntry } from "../activity";
import type { Selection } from "../selection";
import type { TagValues } from "../simulation";
import { CopilotLiveAgent } from "./CopilotLiveAgent";
import { HistoryPanel } from "./HistoryPanel";
import { PropertiesPanel } from "./PropertiesPanel";

export type CopilotTab = "chat" | "history";

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
  apiKey,
  onOpenSetup,
  onApplyPlan,
  undoDepth,
  redoDepth,
  dirty,
  activity,
}: Props) {
  return (
    <section className="esco-copilot">
      <header className="esco-copilot__header">
        <div>
          <h2 className="esco-copilot__title">AI Copilot</h2>
          <span className="esco-copilot__subtitle">Reviewed ladder actions only</span>
        </div>
        <span className="esco-copilot__badge">ONLINE</span>
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
          className={`esco-copilot__tab${tab === "history" ? " is-active" : ""}`}
          onClick={() => onTabChange("history")}
        >
          History
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
              apiKey={apiKey ?? ""}
              onOpenSetup={onOpenSetup}
              empty={empty}
            />
          </div>
        ) : (
          <div className="esco-copilot__history">
            <PropertiesPanel project={project} selection={selection} values={values} findings={findings} />
            <HistoryPanel undoDepth={undoDepth} redoDepth={redoDepth} dirty={dirty} activity={activity} />
          </div>
        )}
      </div>
    </section>
  );
}
