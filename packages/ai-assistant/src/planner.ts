import { explainRoutine, explainRung, explainValidation } from "./explain";
import {
  counterPlan,
  fixUndefinedPlan,
  motorStarterPlan,
  movPlan,
  timerPlan,
} from "./templates";
import type { AssistantInput, AssistantPlan, AssistantResult } from "./types";

export const HELP_TEXT = [
  "I'm an offline, rule-based assistant for ESCO Automation Studio. I never change the project directly — I propose actions you preview and apply.",
  "",
  "Try:",
  "  • explain rung",
  "  • explain routine",
  "  • explain validation errors",
  "  • generate motor starter",
  "  • fix undefined tags",
  "  • timer example",
  "  • counter example",
  "  • mov example",
].join("\n");

function fromPlan(plan: AssistantPlan): AssistantResult {
  return { ok: true, message: plan.explanation, plan };
}

/**
 * Local intent matcher. Explanation intents return a message; generation/fix
 * intents return a previewable plan. Anything else returns help text.
 */
export function runAssistant(input: AssistantInput): AssistantResult {
  const prompt = input.prompt.toLowerCase().trim();
  if (!prompt) return { ok: true, message: HELP_TEXT };

  if (prompt.includes("explain rung")) return { ok: true, message: explainRung(input) };
  if (prompt.includes("explain routine")) return { ok: true, message: explainRoutine(input) };
  if (prompt.includes("validation") || prompt.includes("explain error")) {
    return { ok: true, message: explainValidation(input) };
  }
  if (prompt.includes("motor")) return fromPlan(motorStarterPlan(input.project, input.selection));
  if (prompt.includes("fix undefined") || prompt.includes("undefined tag")) {
    return fromPlan(fixUndefinedPlan(input.project));
  }
  if (prompt.includes("timer")) return fromPlan(timerPlan(input.project, input.selection));
  if (prompt.includes("counter")) return fromPlan(counterPlan(input.project, input.selection));
  if (prompt.includes("mov")) return fromPlan(movPlan(input.project, input.selection));
  if (prompt.includes("explain")) return { ok: true, message: explainRoutine(input) };

  return { ok: true, message: HELP_TEXT };
}
