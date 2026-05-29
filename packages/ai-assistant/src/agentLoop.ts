// The live agent's tool-use loop. Provider-agnostic: it takes an injectable
// ModelCaller (the browser supplies one backed by fetch; tests supply a mock),
// so this whole loop is unit-testable WITHOUT any network. Read tools run live
// against an internal working copy; write tools are recorded as a previewable
// plan and applied to the working copy ONLY (the real project is never touched
// here — the UI applies the returned plan through project-actions on user Apply).

import type { PlcProject } from "@esco/core";
import { createId } from "@esco/shared";
import { AGENT_MAX_ITERATIONS, AGENT_MAX_TOKENS, AGENT_MODEL_ID } from "./agentConfig";
import { buildAgentContext } from "./agentContext";
import {
  ALL_AGENT_TOOLS,
  executeReadTool,
  isReadTool,
  isWriteTool,
  writeToolToAction,
  type AgentToolDef,
} from "./agentTools";
import { applyAction } from "./apply";
import type { AssistantPlan, AssistantSelection, ProposedProjectAction } from "./types";

export interface AgentContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result fields (Anthropic Messages API shape)
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | AgentContentBlock[];
}

export interface ModelRequest {
  model: string;
  max_tokens: number;
  system: string;
  tools: AgentToolDef[];
  messages: AgentMessage[];
}

export interface ModelReply {
  content: AgentContentBlock[];
  stop_reason: string;
}

/** Injectable transport. The browser implements this with fetch (key or proxy); tests mock it. */
export type ModelCaller = (request: ModelRequest) => Promise<ModelReply>;

export interface AgentTranscriptEntry {
  role: "assistant" | "tool" | "error";
  text: string;
}

export interface AgentRunResult {
  ok: boolean;
  /** Previewable plan of proposed project-actions (empty if explanation-only). */
  plan: AssistantPlan;
  transcript: AgentTranscriptEntry[];
  error?: string;
}

export interface RunAgentInput {
  caller: ModelCaller;
  project: PlcProject;
  prompt: string;
  modelId?: string;
  selection?: AssistantSelection;
  maxIterations?: number;
  onProgress?: (entry: AgentTranscriptEntry) => void;
}

export const AGENT_SYSTEM_PROMPT = [
  "You are the live in-IDE assistant for ESCO Automation Studio, an OFFLINE Studio 5000-style ladder-logic editor and simulator. You are NOT a replacement for Studio 5000.",
  "",
  "You help engineers understand and edit ladder logic. You work ONLY through the provided tools.",
  "- READ tools (get_project_overview, list_routines, get_routine, list_tags, get_validation_findings, get_cross_references, get_instruction_metadata) run live and never change anything. Use them to inspect before proposing edits.",
  "- WRITE tools (create_tag, add_rung_from_text, etc.) DO NOT change the user's project immediately. Each one you call is QUEUED as a proposed action for the user to review and Apply. Treat them as building a proposed plan; the user approves it.",
  "",
  "Hard limits — you cannot and must not claim to: talk to a PLC/controller, go online to hardware, read/write .ACD files, or touch the file system. Those tools do not exist.",
  "",
  "Method: inspect with read tools to get real ids (routineId, rungId, nodeId); create any tags a new rung needs BEFORE adding the rung; prefer the smallest correct change; you may call get_validation_findings after proposing edits to check your plan. When finished, give a short plain-text summary of what you propose. Be concise.",
].join("\n");

function blocksToToolResult(id: string, content: string, isError: boolean): AgentContentBlock {
  return { type: "tool_result", tool_use_id: id, content, is_error: isError };
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const maxIterations = input.maxIterations ?? AGENT_MAX_ITERATIONS;
  const transcript: AgentTranscriptEntry[] = [];
  const planActions: ProposedProjectAction[] = [];
  const planWarnings: string[] = [];
  let working: PlcProject = input.project;
  let lastAssistantText = "";

  const push = (entry: AgentTranscriptEntry) => {
    transcript.push(entry);
    input.onProgress?.(entry);
  };

  const makePlan = (): AssistantPlan => ({
    id: createId("plan"),
    title: planActions.length ? "Proposed changes" : "No changes proposed",
    explanation: lastAssistantText || "Done.",
    actions: planActions,
    warnings: planWarnings,
  });

  const context = buildAgentContext(input.project, input.selection);
  const messages: AgentMessage[] = [
    { role: "user", content: `${context.text}\n\nUser request: ${input.prompt}` },
  ];

  try {
    for (let i = 0; i < maxIterations; i++) {
      const reply = await input.caller({
        model: input.modelId?.trim() || AGENT_MODEL_ID,
        max_tokens: AGENT_MAX_TOKENS,
        system: AGENT_SYSTEM_PROMPT,
        tools: ALL_AGENT_TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: reply.content });

      for (const block of reply.content) {
        if (block.type === "text" && block.text) {
          lastAssistantText = block.text;
          push({ role: "assistant", text: block.text });
        }
      }

      if (reply.stop_reason !== "tool_use") {
        return { ok: true, plan: makePlan(), transcript };
      }

      const toolResults: AgentContentBlock[] = [];
      for (const block of reply.content) {
        if (block.type !== "tool_use" || !block.name || !block.id) continue;
        const name = block.name;
        const args = block.input ?? {};
        let result: string;
        let isError = false;

        if (isWriteTool(name)) {
          const action = writeToolToAction(name, args);
          const outcome = applyAction(working, action);
          if (outcome.ok) {
            working = outcome.project;
            planActions.push(action);
            if (outcome.warnings?.length) planWarnings.push(...outcome.warnings);
            result = `Queued for approval: ${action.label}.${outcome.warnings?.length ? ` (${outcome.warnings.join("; ")})` : ""}`;
            push({ role: "tool", text: result });
          } else {
            isError = true;
            result = `Action rejected by the project-action layer: ${outcome.error}`;
            push({ role: "tool", text: `${action.label} → rejected: ${outcome.error}` });
          }
        } else if (isReadTool(name)) {
          result = executeReadTool(working, name, args, input.selection);
          push({ role: "tool", text: `${name} → ${result.split("\n")[0]}` });
        } else {
          isError = true;
          result = `Blocked: "${name}" is not in the allowed tool set.`;
          push({ role: "error", text: result });
        }

        toolResults.push(blocksToToolResult(block.id, result, isError));
      }
      messages.push({ role: "user", content: toolResults });
    }
    return { ok: false, plan: makePlan(), transcript, error: `Stopped after ${maxIterations} steps without finishing.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed.";
    push({ role: "error", text: message });
    return { ok: false, plan: makePlan(), transcript, error: message };
  }
}
