import {
  explainHmiBindings,
  explainHmiValidation,
  explainRoutine,
  explainRung,
  explainValidation,
} from "./explain";
import {
  counterPlan,
  debounceInputPlan,
  fixUndefinedPlan,
  hmiNavigationButtonPlan,
  hmiPopupPlan,
  hmiScreenPlan,
  motorInterlockPlan,
  motorStartCounterPlan,
  motorStarterPlan,
  movPlan,
  programScaffoldPlan,
  studio5000HandoffPlan,
  studio5000HandoffReadinessPlan,
  timerPlan,
  unitConversionPlan,
} from "./templates";
import type { AssistantInput, AssistantPlan, AssistantResult } from "./types";

export const HELP_TEXT = [
  "I'm an offline, rule-based assistant for ESCO Automation Studio. I never change the project directly — I propose actions you preview and apply.",
  "",
  "Try:",
  "  • explain rung",
  "  • explain routine",
  "  • explain validation errors",
  "  • explain HMI bindings",
  "  • create HMI screen",
  "  • add navigation button",
  "  • create program scaffold",
  "  • Studio 5000 handoff",
  "  • Studio 5000 handoff readiness",
  "  • generate motor starter",
  "  • motor starter with interlocks",
  "  • debounce input",
  "  • count motor starts with ONS",
  "  • C/F unit conversion",
  "  • fix undefined tags",
  "  • timer example",
  "  • counter example",
  "  • mov example",
].join("\n");

function fromPlan(plan: AssistantPlan): AssistantResult {
  return { ok: true, message: plan.explanation, plan };
}

function quotedName(input: string): string | undefined {
  return input.match(/"([^"]+)"/)?.[1]?.trim() || input.match(/'([^']+)'/)?.[1]?.trim();
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
  if (prompt.includes("hmi") && (prompt.includes("binding") || prompt.includes("view designer"))) {
    return { ok: true, message: explainHmiBindings(input) };
  }
  if (prompt.includes("hmi") && (prompt.includes("validation") || prompt.includes("finding"))) {
    return { ok: true, message: explainHmiValidation(input) };
  }
  if (prompt.includes("validation") || prompt.includes("explain error")) {
    return { ok: true, message: explainValidation(input) };
  }
  if (prompt.includes("hmi") && prompt.includes("screen")) return fromPlan(hmiScreenPlan(input.project));
  if (prompt.includes("hmi") && prompt.includes("popup")) return fromPlan(hmiPopupPlan(input.project));
  if (prompt.includes("navigation button") || (prompt.includes("hmi") && prompt.includes("navigate"))) {
    return fromPlan(hmiNavigationButtonPlan(input.project));
  }
  if (
    prompt.includes("handoff readiness") ||
    prompt.includes("handoff preflight") ||
    prompt.includes("studio 5000 readiness") ||
    prompt.includes("studio5000 readiness") ||
    ((prompt.includes("studio 5000") || prompt.includes("studio5000")) && (prompt.includes("ready") || prompt.includes("preflight")))
  ) {
    return fromPlan(studio5000HandoffReadinessPlan(input.project));
  }
  if (prompt.includes("studio 5000") || prompt.includes("studio5000") || prompt.includes("rockwell handoff") || prompt.includes("l5x handoff")) {
    return fromPlan(studio5000HandoffPlan());
  }
  if (prompt.includes("program scaffold") || prompt.includes("create program") || prompt.includes("new program")) {
    return fromPlan(programScaffoldPlan(input.project, quotedName(input.prompt) ?? "AI_Program"));
  }
  if (prompt.includes("debounce")) return fromPlan(debounceInputPlan(input.project, input.selection));
  if (
    prompt.includes("unit conversion") ||
    prompt.includes("fahrenheit") ||
    prompt.includes("celsius") ||
    prompt.includes("°f") ||
    prompt.includes("°c") ||
    (prompt.includes("convert") && (prompt.includes("temp") || prompt.includes("temperature")))
  ) {
    return fromPlan(unitConversionPlan(input.project, input.selection));
  }
  if (
    prompt.includes("ons") ||
    prompt.includes("one shot") ||
    prompt.includes("one-shot") ||
    (prompt.includes("count") && prompt.includes("start"))
  ) {
    return fromPlan(motorStartCounterPlan(input.project, input.selection));
  }
  if (prompt.includes("motor") && (prompt.includes("interlock") || prompt.includes("holding") || prompt.includes("hold"))) {
    return fromPlan(motorInterlockPlan(input.project, input.selection));
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
