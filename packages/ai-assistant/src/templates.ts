import type { PlcProject } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import { createId } from "@esco/shared";
import { tagExists } from "@esco/project-actions";
import { resolveRoutineId, undefinedTags } from "./context";
import type { AssistantPlan, AssistantSelection, ProposedProjectAction } from "./types";

function createTagAction(name: string, dataType: string): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createTag",
    label: `Create tag ${name} (${dataType})`,
    description: `Create a ${dataType} tag named ${name}.`,
    input: { name, dataType },
  };
}

function addRungAction(routineId: string, text: string, comment: string): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "addRungFromText",
    label: `Add rung: ${text}`,
    description: comment,
    input: { routineId, text, comment },
  };
}

function createHmiScreenAction(name: string, screenId = createId("hmiscreen")): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createHmiScreen",
    label: `Create HMI screen ${name}`,
    description: `Create a View Designer screen named ${name}.`,
    input: { name, screenId },
  };
}

function createHmiPopupAction(name: string, popupId = createId("hmipopup")): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createHmiPopup",
    label: `Create HMI popup ${name}`,
    description: `Create a View Designer popup named ${name}.`,
    input: { name, popupId },
  };
}

function addHmiElementAction(
  surfaceId: string,
  typeId: string,
  name: string,
  elementId = createId("hmiel"),
): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "addHmiElement",
    label: `Add HMI ${typeId} ${name}`,
    description: `Add registered HMI element ${typeId} to the screen.`,
    input: { surfaceKind: "screen", surfaceId, typeId, name, elementId },
  };
}

function addHmiNavigationEventAction(
  surfaceId: string,
  elementId: string,
  targetScreenId: string,
): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "addHmiEventCommand",
    label: "Add HMI navigation event",
    description: "On button press, navigate to the target HMI screen.",
    input: {
      surfaceKind: "screen",
      surfaceId,
      elementId,
      eventType: "press",
      command: {
        id: createId("hmicmd"),
        type: "navigate",
        safety: "runtime-preview",
        args: { screenId: targetScreenId },
      },
    },
  };
}

/** Only propose tag creation for tags that don't already exist (create-or-reuse). */
function missingTagActions(
  project: PlcProject,
  tags: [name: string, type: string][],
): ProposedProjectAction[] {
  return tags
    .filter(([name]) => !tagExists(project, name))
    .map(([name, type]) => createTagAction(name, type));
}

function plan(
  title: string,
  explanation: string,
  actions: ProposedProjectAction[],
  warnings: string[] = [],
): AssistantPlan {
  return { id: createId("plan"), title, explanation, actions, warnings };
}

function routineWarnings(routineId: string | undefined): string[] {
  return routineId ? [] : ["No routine is open; open MainRoutine before applying."];
}

export function motorStarterPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [["StartPB", "BOOL"], ["StopPB", "BOOL"], ["MotorRun", "BOOL"]]),
    addRungAction(
      routineId,
      "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun)",
      "Seal-in motor starter",
    ),
  ];
  return plan(
    "Motor starter",
    "Creates StartPB/StopPB/MotorRun (if missing) and a seal-in rung: (StartPB OR MotorRun) AND NOT StopPB → MotorRun.",
    actions,
    routineWarnings(routineId),
  );
}

export function timerPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [["StartPB", "BOOL"], ["Timer1", "TIMER"], ["TimerDone", "BOOL"]]),
    addRungAction(routineId, "XIC(StartPB)TON(Timer1,1000)", "Run Timer1 while StartPB is on"),
    addRungAction(routineId, "XIC(Timer1.DN)OTE(TimerDone)", "TimerDone follows Timer1.DN"),
  ];
  return plan(
    "Timer example",
    "Creates a 1000 ms on-delay timer driven by StartPB and mirrors Timer1.DN onto TimerDone.",
    actions,
    routineWarnings(routineId),
  );
}

export function counterPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [["CountPB", "BOOL"], ["Counter1", "COUNTER"], ["CountDone", "BOOL"]]),
    addRungAction(routineId, "XIC(CountPB)CTU(Counter1,5)", "Count up on each CountPB press"),
    addRungAction(routineId, "XIC(Counter1.DN)OTE(CountDone)", "CountDone follows Counter1.DN"),
  ];
  return plan(
    "Counter example",
    "Creates a count-up counter (preset 5) driven by CountPB and mirrors Counter1.DN onto CountDone.",
    actions,
    routineWarnings(routineId),
  );
}

export function movPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [["StartPB", "BOOL"], ["SomeDint", "DINT"]]),
    addRungAction(routineId, "XIC(StartPB)MOV(123,SomeDint)", "Move 123 into SomeDint while StartPB is on"),
  ];
  return plan(
    "MOV example",
    "Creates StartPB/SomeDint (if missing) and moves the constant 123 into SomeDint while StartPB is on.",
    actions,
    routineWarnings(routineId),
  );
}

export function fixUndefinedPlan(project: PlcProject): AssistantPlan {
  const missing = undefinedTags(project);
  const actions = missing.map(({ name, type }) => createTagAction(name, type));
  return plan(
    "Fix undefined tags",
    missing.length
      ? `Create ${missing.length} missing tag(s): ${missing.map((t) => `${t.name} (${t.type})`).join(", ")}.`
      : "No undefined tags were found.",
    actions,
  );
}

export function hmiScreenPlan(project: PlcProject, name = "Overview"): AssistantPlan {
  const hmi = getHmiProject(project);
  const exists = hmi?.screens.some((screen) => screen.name.toLowerCase() === name.toLowerCase());
  const actions = exists ? [] : [createHmiScreenAction(name)];
  return plan(
    "Create HMI screen",
    exists
      ? `HMI screen "${name}" already exists; no screen creation is needed.`
      : `Create a reviewed View Designer screen named "${name}".`,
    actions,
  );
}

export function hmiPopupPlan(project: PlcProject, name = "Details"): AssistantPlan {
  const hmi = getHmiProject(project);
  const exists = hmi?.popups.some((popup) => popup.name.toLowerCase() === name.toLowerCase());
  const actions = exists ? [] : [createHmiPopupAction(name)];
  return plan(
    "Create HMI popup",
    exists
      ? `HMI popup "${name}" already exists; no popup creation is needed.`
      : `Create a reviewed View Designer popup named "${name}".`,
    actions,
  );
}

export function hmiNavigationButtonPlan(project: PlcProject): AssistantPlan {
  const hmi = getHmiProject(project);
  const existingSource = hmi?.screens[0];
  const existingTarget = hmi?.screens.find((screen) => screen.id !== existingSource?.id);
  const sourceScreenId = existingSource?.id ?? createId("hmiscreen");
  const targetScreenId = existingTarget?.id ?? createId("hmiscreen");
  const buttonId = createId("hmiel");
  const actions: ProposedProjectAction[] = [];

  if (!existingSource) actions.push(createHmiScreenAction("Overview", sourceScreenId));
  if (!existingTarget) actions.push(createHmiScreenAction("Details", targetScreenId));
  actions.push(addHmiElementAction(sourceScreenId, "common.button", "Navigate to Details", buttonId));
  actions.push(addHmiNavigationEventAction(sourceScreenId, buttonId, targetScreenId));

  return plan(
    "Add HMI navigation button",
    existingSource && existingTarget
      ? `Add a registered button to "${existingSource.name}" that navigates to "${existingTarget.name}" on press.`
      : "Create any missing source/target HMI screens, add a registered button, and wire a reviewed navigation event.",
    actions,
  );
}
