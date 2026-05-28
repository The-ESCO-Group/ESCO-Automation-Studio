import type { PlcProject } from "@esco/core";
import type { ApplyResult, AssistantPlan } from "@esco/ai-assistant";
import type { ValidationFinding } from "@esco/validator";
import type { Selection } from "../selection";
import type { TagValues } from "../simulation";
import type { ActivityEntry } from "../activity";
import { PropertiesPanel } from "./PropertiesPanel";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { ModelSummaryPanel } from "./ModelSummaryPanel";
import { HistoryPanel } from "./HistoryPanel";
import { HelpPanel } from "./HelpPanel";

export type InspectorTab = "properties" | "ai" | "model" | "history" | "help";

const RAIL: { id: InspectorTab; glyph: string; label: string; title: string }[] = [
  { id: "properties", glyph: "⚙", label: "Props", title: "Properties — selected item details" },
  { id: "ai", glyph: "✦", label: "AI", title: "AI Assistant (offline)" },
  { id: "model", glyph: "▣", label: "Model", title: "Model summary" },
  { id: "history", glyph: "↺", label: "History", title: "Undo/redo and session activity" },
  { id: "help", glyph: "?", label: "Help", title: "Help and safety" },
];

interface Props {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  project: PlcProject;
  selection: Selection;
  values: TagValues;
  findings: ValidationFinding[];
  selectedRoutineId?: string;
  openRoutineName?: string;
  onApplyPlan: (plan: AssistantPlan) => ApplyResult;
  undoDepth: number;
  redoDepth: number;
  dirty: boolean;
  activity: ActivityEntry[];
}

/**
 * The right-side tabbed inspector/assistant. A narrow vertical rail switches
 * between Properties, the offline AI assistant, the model summary, session
 * history, and help — keeping the bottom dock free for engineering outputs.
 */
export function InspectorPanel({
  tab,
  onTabChange,
  project,
  selection,
  values,
  findings,
  selectedRoutineId,
  openRoutineName,
  onApplyPlan,
  undoDepth,
  redoDepth,
  dirty,
  activity,
}: Props) {
  return (
    <div className="esco-inspector">
      <nav className="esco-inspector__rail" aria-label="Inspector tabs">
        {RAIL.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.title}
            className={`esco-inspector__tab${tab === item.id ? " is-active" : ""}`}
            onClick={() => onTabChange(item.id)}
          >
            <span className="esco-inspector__glyph" aria-hidden="true">{item.glyph}</span>
            <span className="esco-inspector__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="esco-inspector__content">
        {tab === "properties" ? (
          <PropertiesPanel project={project} selection={selection} values={values} findings={findings} />
        ) : tab === "ai" ? (
          <AiAssistantPanel project={project} selectedRoutineId={selectedRoutineId} onApply={onApplyPlan} />
        ) : tab === "model" ? (
          <ModelSummaryPanel project={project} findings={findings} openRoutineName={openRoutineName} />
        ) : tab === "history" ? (
          <HistoryPanel undoDepth={undoDepth} redoDepth={redoDepth} dirty={dirty} activity={activity} />
        ) : (
          <HelpPanel />
        )}
      </div>
    </div>
  );
}
