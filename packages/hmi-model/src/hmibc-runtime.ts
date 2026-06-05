import type {
  HmiButtonControlPreviewInput,
  HmiButtonControlPreviewSignal,
  HmiButtonControlPreviewState,
  HmiButtonControlRuntimePreview,
  HmiGraphicElement,
} from "./types";

function stringProperty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanProperty(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function activeString(value: string): boolean {
  return ["1", "active", "on", "pressed", "run", "running", "true"].includes(value.trim().toLowerCase());
}

function signal(tagPath: string | undefined, values: HmiButtonControlPreviewInput["values"]): HmiButtonControlPreviewSignal {
  if (!tagPath) {
    return { value: null, quality: "unconfigured", active: false };
  }
  if (!Object.prototype.hasOwnProperty.call(values, tagPath)) {
    return { tagPath, value: null, quality: "missing", active: false };
  }

  const value = values[tagPath];
  if (value === null || value === undefined) {
    return { tagPath, value: null, quality: value === null ? "bad" : "missing", active: false };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { tagPath, value: null, quality: "bad", active: false };
  }

  const active = typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : activeString(value);
  return { tagPath, value, quality: "good", active };
}

function hasSignalQualityIssue(...signals: HmiButtonControlPreviewSignal[]): boolean {
  return signals.some((candidate) => candidate.quality !== "good" && candidate.quality !== "unconfigured");
}

function previewState(input: {
  hasControllerTag: boolean;
  pressed: boolean;
  visualFeedbackEnabled: boolean;
  commandActive: boolean;
  feedback: HmiButtonControlPreviewSignal;
  signalQualityIssue: boolean;
}): HmiButtonControlPreviewState {
  if (!input.hasControllerTag) return "unconfigured";
  if (input.signalQualityIssue) return "bad-quality";
  if (input.visualFeedbackEnabled && input.feedback.quality === "good" && input.commandActive !== input.feedback.active) {
    return "mismatch";
  }
  if (input.feedback.active) return "feedback-active";
  if (input.commandActive || input.pressed) return "commanded";
  return "idle";
}

function stateMessage(label: string, state: HmiButtonControlPreviewState): string {
  switch (state) {
    case "unconfigured":
      return `HMI Button Control "${label}" requires a controller tag path.`;
    case "bad-quality":
      return `HMI Button Control "${label}" has missing or bad runtime tag quality.`;
    case "mismatch":
      return `HMI Button Control "${label}" command and feedback do not match.`;
    case "feedback-active":
      return `HMI Button Control "${label}" feedback is active.`;
    case "commanded":
      return `HMI Button Control "${label}" command is active in offline preview.`;
    case "idle":
      return `HMI Button Control "${label}" is idle.`;
  }
}

export function previewHmiButtonControlRuntime(
  element: HmiGraphicElement,
  input: HmiButtonControlPreviewInput,
): HmiButtonControlRuntimePreview {
  const label = stringProperty(element.properties.label) ?? element.name;
  const controllerTagPath = stringProperty(element.properties.controllerTagPath);
  const feedbackTagPath = stringProperty(element.properties.feedbackTagPath);
  const statusTagPath = stringProperty(element.properties.statusTagPath);
  const visualFeedbackEnabled = booleanProperty(element.properties.visualFeedbackEnabled, true);
  const pressed = input.pressed === true;
  const command = signal(controllerTagPath, input.values);
  const feedback = signal(feedbackTagPath, input.values);
  const status = signal(statusTagPath, input.values);
  const commandActive = pressed || command.active;
  const state = previewState({
    hasControllerTag: controllerTagPath !== undefined,
    pressed,
    visualFeedbackEnabled,
    commandActive,
    feedback,
    signalQualityIssue: hasSignalQualityIssue(command, feedback, status),
  });

  return {
    elementId: element.id,
    label,
    timestampMs: input.timestampMs,
    pressed,
    visualFeedbackEnabled,
    state,
    active: commandActive || feedback.active,
    message: stateMessage(label, state),
    command: { ...command, active: commandActive },
    feedback,
    status,
  };
}
