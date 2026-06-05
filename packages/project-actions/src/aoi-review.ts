import type { AddOnInstruction, AoiParameter, Routine, RoutineLanguage } from "@esco/core";

export type AoiReviewBoundary =
  | "source-protected-logic-unavailable"
  | "non-ladder-routines-preserved-read-only"
  | "single-scan-routine-executes"
  | "scan-phase-routines-not-executed"
  | "no-controller-signature-enforcement"
  | "no-controller-scheduling-or-fault-semantics";

export type AoiRoutineReviewBehavior =
  | "offline-rll-executable"
  | "ladder-preserved-not-selected"
  | "non-ladder-preserved-read-only"
  | "source-protected-metadata-only";

export interface AoiRoutineReview {
  name: string;
  language: RoutineLanguage | "unknown";
  behavior: AoiRoutineReviewBehavior;
  reason: string;
}

export interface AoiExecutionReview {
  aoiName: string;
  editable: boolean;
  offlineExecutable: boolean;
  selectedRoutineName?: string;
  selectedRoutinePolicy?: "logic-routine" | "first-ladder-fallback";
  status: string;
  boundaries: AoiReviewBoundary[];
  routines: AoiRoutineReview[];
}

const SCAN_PHASE_NAMES = new Set(["prescan", "postscan", "enableinfalseroutine"]);

function isLadderRoutine(routine: Routine | undefined): boolean {
  return Array.isArray((routine?.ladder as { rungs?: unknown } | undefined)?.rungs);
}

function routineByName(aoi: AddOnInstruction, name: string): Routine | undefined {
  return aoi.routines?.find((routine) => routine.name === name);
}

function selectAoiReviewRoutine(aoi: AddOnInstruction): { routine: Routine; policy: "logic-routine" | "first-ladder-fallback" } | undefined {
  const logic = aoi.routines?.find((routine) => routine.name.toLowerCase() === "logic" && isLadderRoutine(routine));
  if (logic) return { routine: logic, policy: "logic-routine" };
  const firstLadder = aoi.routines?.find((routine) => isLadderRoutine(routine));
  return firstLadder ? { routine: firstLadder, policy: "first-ladder-fallback" } : undefined;
}

export function aoiReviewBoundaryLabel(boundary: AoiReviewBoundary): string {
  switch (boundary) {
    case "source-protected-logic-unavailable":
      return "source-protected logic unavailable";
    case "non-ladder-routines-preserved-read-only":
      return "non-ladder routines preserved read-only";
    case "single-scan-routine-executes":
      return "single AOI scan routine executes";
    case "scan-phase-routines-not-executed":
      return "Prescan/Postscan/EnableInFalse not executed";
    case "no-controller-signature-enforcement":
      return "signature metadata display only";
    case "no-controller-scheduling-or-fault-semantics":
      return "no controller scheduling/fault semantics";
  }
}

export function aoiRoutineReviewBehaviorLabel(behavior: AoiRoutineReviewBehavior): string {
  switch (behavior) {
    case "offline-rll-executable":
      return "ladder logic runs in Offline Simulation";
    case "ladder-preserved-not-selected":
      return "ladder logic preserved, not selected as AOI scan body";
    case "non-ladder-preserved-read-only":
      return "logic preserved read-only";
    case "source-protected-metadata-only":
      return "source-protected metadata only";
  }
}

export function describeAoiExecutionReview(aoi: AddOnInstruction): AoiExecutionReview {
  const selected = aoi.protected ? undefined : selectAoiReviewRoutine(aoi);
  const boundaries = new Set<AoiReviewBoundary>(["no-controller-scheduling-or-fault-semantics"]);

  if (aoi.protected) boundaries.add("source-protected-logic-unavailable");
  if (aoi.signature) boundaries.add("no-controller-signature-enforcement");
  if ((aoi.routines ?? []).some((routine) => routine.language !== "ladder")) {
    boundaries.add("non-ladder-routines-preserved-read-only");
  }
  if (selected) boundaries.add("single-scan-routine-executes");
  if ((aoi.routineNames ?? []).some((name) => SCAN_PHASE_NAMES.has(name.toLowerCase()))) {
    boundaries.add("scan-phase-routines-not-executed");
  }

  const routines: AoiRoutineReview[] = (aoi.routineNames ?? []).map((name) => {
    const routine = routineByName(aoi, name);
    const language = routine?.language ?? "unknown";
    if (aoi.protected) {
      return {
        name,
        language,
        behavior: "source-protected-metadata-only",
        reason: "Source-protected AOI logic is unavailable for offline execution.",
      };
    }
    if (selected?.routine.name === name) {
      return {
        name,
        language,
        behavior: "offline-rll-executable",
        reason: selected.policy === "logic-routine"
          ? "The AOI scan body is the ladder routine named Logic."
          : "No Logic routine was imported, so the first imported ladder routine is the offline fallback.",
      };
    }
    if (isLadderRoutine(routine)) {
      return {
        name,
        language,
        behavior: "ladder-preserved-not-selected",
        reason: "Imported ladder routine is preserved, but the offline engine runs only one AOI scan body.",
      };
    }
    return {
      name,
      language,
      behavior: "non-ladder-preserved-read-only",
      reason: "Structured Text, Function Block, and SFC AOI bodies are preserved for review and export, not executed offline.",
    };
  });

  // (interface projection lives in describeAoiInterfaceReview, below)
  const status = aoi.protected
    ? "Source-protected; logic is unavailable and never reverse-engineered offline."
    : selected
      ? `${selected.routine.name} runs as the AOI scan body in Offline Simulation.`
      : "No imported ladder scan body is available; AOI calls are preserved as model-only pass-through.";

  return {
    aoiName: aoi.name,
    editable: !aoi.protected,
    offlineExecutable: Boolean(selected),
    ...(selected ? { selectedRoutineName: selected.routine.name, selectedRoutinePolicy: selected.policy } : {}),
    status,
    boundaries: [...boundaries],
    routines,
  };
}

// --- AOI call-interface (parameter signature) review ----------------------
//
// describeAoiExecutionReview above projects the AOI *body* (which routine, if
// any, runs offline). This projects the AOI *interface*: the public call
// signature an engineer sees when placing the instruction. The interface is
// read entirely from imported parameter metadata, so — unlike the body — it
// survives source protection: a protected AOI hides its logic but still exposes
// its parameters. That is the hardening point. The projection is display-only
// and never edits or executes anything.

export type AoiParameterDirection = "input" | "output" | "inout" | "unknown";

/**
 * How a parameter binds to the caller's argument. InOut parameters always pass
 * by reference (the AOI body reads and writes the caller's tag in place), and
 * since Logix only permits arrays as InOut, any array parameter is by reference
 * too. Input/Output scalars pass by value (copied in/out at the call boundary).
 */
export type AoiParameterPassing = "by-value" | "by-reference";

export type AoiInterfaceBoundary =
  | "interface-metadata-display-only"
  | "inout-parameters-alias-caller-memory"
  | "source-protected-logic-unavailable";

export interface AoiInterfaceParameterReview {
  name: string;
  dataType: string;
  direction: AoiParameterDirection;
  passing: AoiParameterPassing;
  required: boolean;
  /** Explicitly shown on the instruction face when the AOI is placed in ladder. */
  visible: boolean;
  array: boolean;
  /** True for the implicit EnableIn / EnableOut pins present on every AOI call. */
  implicit: boolean;
  dimensions?: number[];
  defaultValue?: string;
  description?: string;
}

export interface AoiInterfaceReview {
  aoiName: string;
  protectedSource: boolean;
  /** Parameters in declared (instruction-face) order, implicit pins included. */
  parameters: AoiInterfaceParameterReview[];
  inputCount: number;
  outputCount: number;
  inOutCount: number;
  /** Parameters that alias caller memory (InOut or array). */
  byReferenceCount: number;
  /** User-facing parameters excluding the implicit EnableIn/EnableOut pins. */
  visibleParameterCount: number;
  requiredParameterCount: number;
  localTagCount: number;
  hasEnableIn: boolean;
  hasEnableOut: boolean;
  boundaries: AoiInterfaceBoundary[];
  notes: string[];
}

export function aoiInterfaceBoundaryLabel(boundary: AoiInterfaceBoundary): string {
  switch (boundary) {
    case "interface-metadata-display-only":
      return "interface metadata display only";
    case "inout-parameters-alias-caller-memory":
      return "InOut parameters alias caller memory";
    case "source-protected-logic-unavailable":
      return "source-protected logic unavailable";
  }
}

function parameterDirection(usage: string | undefined): AoiParameterDirection {
  switch ((usage ?? "").trim().toLowerCase()) {
    case "input":
      return "input";
    case "output":
      return "output";
    case "inout":
      return "inout";
    default:
      return "unknown";
  }
}

function isImplicitPin(parameter: AoiParameter, direction: AoiParameterDirection): boolean {
  const name = parameter.name.trim().toLowerCase();
  return (name === "enablein" && direction !== "output") || (name === "enableout" && direction !== "input");
}

function reviewParameter(parameter: AoiParameter): AoiInterfaceParameterReview {
  const direction = parameterDirection(parameter.usage);
  const array = Boolean((parameter.dimensions && parameter.dimensions.length > 0) || parameter.dimension);
  // InOut is always by reference; Logix only allows arrays as InOut, so an array
  // is by reference even if the imported usage is missing or mislabelled.
  const passing: AoiParameterPassing = direction === "inout" || array ? "by-reference" : "by-value";
  return {
    name: parameter.name,
    dataType: parameter.dataType,
    direction,
    passing,
    required: Boolean(parameter.required),
    visible: parameter.visible === true,
    array,
    implicit: isImplicitPin(parameter, direction),
    ...(parameter.dimensions && parameter.dimensions.length > 0 ? { dimensions: [...parameter.dimensions] } : {}),
    ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
    ...(parameter.description !== undefined ? { description: parameter.description } : {}),
  };
}

/**
 * Project the AOI's public call interface for review. Read-only metadata only:
 * available for every AOI, including source-protected ones, and never executes
 * or edits anything.
 */
export function describeAoiInterfaceReview(aoi: AddOnInstruction): AoiInterfaceReview {
  const parameters = aoi.parameters.map(reviewParameter);
  const userParameters = parameters.filter((parameter) => !parameter.implicit);

  const boundaries = new Set<AoiInterfaceBoundary>(["interface-metadata-display-only"]);
  if (parameters.some((parameter) => parameter.passing === "by-reference")) {
    boundaries.add("inout-parameters-alias-caller-memory");
  }
  if (aoi.protected) boundaries.add("source-protected-logic-unavailable");

  const notes = [
    "Parameter interface is read from imported metadata and survives source protection; the AOI logic body is never required to project it.",
    "Implicit EnableIn (Input BOOL) and EnableOut (Output BOOL) pins are part of every AOI call.",
    "Directions and by-reference classification are review metadata, not simulator side effects.",
  ];
  if (aoi.protected) {
    notes.push("Source-protected: the call interface is shown, but the logic body is never inspected or reverse-engineered.");
  }

  return {
    aoiName: aoi.name,
    protectedSource: Boolean(aoi.protected),
    parameters,
    inputCount: userParameters.filter((parameter) => parameter.direction === "input").length,
    outputCount: userParameters.filter((parameter) => parameter.direction === "output").length,
    inOutCount: userParameters.filter((parameter) => parameter.direction === "inout").length,
    byReferenceCount: parameters.filter((parameter) => parameter.passing === "by-reference").length,
    visibleParameterCount: userParameters.filter((parameter) => parameter.visible).length,
    requiredParameterCount: userParameters.filter((parameter) => parameter.required).length,
    localTagCount: aoi.localTags.length,
    hasEnableIn: parameters.some((parameter) => parameter.implicit && parameter.name.trim().toLowerCase() === "enablein"),
    hasEnableOut: parameters.some((parameter) => parameter.implicit && parameter.name.trim().toLowerCase() === "enableout"),
    boundaries: [...boundaries],
    notes,
  };
}
