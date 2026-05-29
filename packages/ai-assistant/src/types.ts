import type { PlcProject } from "@esco/core";
import type { ValidationFinding } from "@esco/validator";

export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** A single proposed change, previewed before apply and mapped to a project-action. */
export interface ProposedProjectAction {
  id: string;
  /** The project-action this maps to (e.g. "createTag", "addRungFromText"). */
  kind: string;
  label: string;
  description: string;
  input: unknown;
}

export interface AssistantPlan {
  id: string;
  title: string;
  explanation: string;
  actions: ProposedProjectAction[];
  warnings: string[];
}

export interface AssistantResult {
  ok: boolean;
  message: string;
  plan?: AssistantPlan;
  error?: string;
}

export interface AssistantSelection {
  routineId?: string;
  rungId?: string;
}

export interface AssistantInput {
  prompt: string;
  project: PlcProject;
  selection?: AssistantSelection;
}

/** Result of applying a plan through the controlled project-action layer. */
export interface ApplyResult {
  ok: boolean;
  project: PlcProject;
  applied: string[];
  findings: ValidationFinding[];
  warnings: string[];
  error?: string;
}
