import type { PlcProject } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import { createId } from "@esco/shared";
import { tagExists } from "@esco/project-actions";
import { resolveRoutineId, undefinedTags } from "./context";
import { buildStudio5000HandoffReadiness, formatStudio5000HandoffReadiness } from "./handoff";
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
    description: `Create an HMI screen named ${name}.`,
    input: { name, screenId },
  };
}

function createHmiPopupAction(name: string, popupId = createId("hmipopup")): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createHmiPopup",
    label: `Create HMI popup ${name}`,
    description: `Create an HMI popup named ${name}.`,
    input: { name, popupId },
  };
}

function createProgramAction(controllerId: string, name: string, programId = createId("prog")): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createProgram",
    label: `Create program ${name}`,
    description: `Create a Logix program named ${name}.`,
    input: { controllerId, name, programId },
  };
}

function createRoutineAction(
  programId: string,
  name: string,
  language: "ladder" | "structured-text" | "function-block" | "sfc" = "ladder",
  routineId = createId("rtn"),
): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "createRoutine",
    label: `Create routine ${name}`,
    description: `Create a ${language} routine named ${name}.`,
    input: { programId, name, language, routineId },
  };
}

function setProgramMainRoutineAction(programId: string, programName: string, routineId: string): ProposedProjectAction {
  return {
    id: createId("act"),
    kind: "setProgramProperties",
    label: `Set ${programName} main routine`,
    description: "Set the newly created routine as the program main routine.",
    input: { programId, name: programName, mainRoutineId: routineId },
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

export function motorInterlockPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [
      ["StartPB", "BOOL"],
      ["StopPB", "BOOL"],
      ["EStopOK", "BOOL"],
      ["OverloadOK", "BOOL"],
      ["PermissiveOK", "BOOL"],
      ["MotorRun", "BOOL"],
    ]),
    addRungAction(
      routineId,
      "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)XIC(EStopOK)XIC(OverloadOK)XIC(PermissiveOK)OTE(MotorRun)",
      "Seal-in motor starter with stop, E-stop, overload, and permissive interlocks",
    ),
  ];
  return plan(
    "Motor starter with interlocks",
    "Creates a seal-in motor starter that holds MotorRun only while StopPB is clear and EStopOK, OverloadOK, and PermissiveOK are true.",
    actions,
    routineWarnings(routineId),
  );
}

export function debounceInputPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [
      ["RawInput", "BOOL"],
      ["DebounceTimer", "TIMER"],
      ["DebouncedInput", "BOOL"],
    ]),
    addRungAction(routineId, "XIC(RawInput)TON(DebounceTimer,500)", "Debounce RawInput for 500 ms"),
    addRungAction(
      routineId,
      "XIC(DebounceTimer.DN)OTE(DebouncedInput)",
      "DebouncedInput follows the timer done bit",
    ),
  ];
  return plan(
    "Debounce input",
    "Creates a 500 ms on-delay debounce: RawInput must remain true before DebouncedInput turns on.",
    actions,
    routineWarnings(routineId),
  );
}

export function motorStartCounterPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [
      ["MotorRun", "BOOL"],
      ["MotorStartONS", "BOOL"],
      ["MotorStartCounter", "COUNTER"],
      ["StartsDone", "BOOL"],
    ]),
    addRungAction(
      routineId,
      "XIC(MotorRun)ONS(MotorStartONS)CTU(MotorStartCounter,100)",
      "Count one motor start on each rising edge of MotorRun",
    ),
    addRungAction(
      routineId,
      "XIC(MotorStartCounter.DN)OTE(StartsDone)",
      "StartsDone follows MotorStartCounter.DN",
    ),
  ];
  return plan(
    "Motor start counter",
    "Creates an ONS-backed start counter so MotorStartCounter increments once per MotorRun rising edge, not once per scan.",
    actions,
    routineWarnings(routineId),
  );
}

export function unitConversionPlan(project: PlcProject, selection?: AssistantSelection): AssistantPlan {
  const routineId = resolveRoutineId(project, selection) ?? "";
  const actions = [
    ...missingTagActions(project, [
      ["ConvertToF", "BOOL"],
      ["ConvertToC", "BOOL"],
      ["TempC", "REAL"],
      ["TempF", "REAL"],
    ]),
    addRungAction(
      routineId,
      "XIC(ConvertToF)CPT(TempF,TempC*1.8+32)",
      "Convert Celsius to Fahrenheit",
    ),
    addRungAction(
      routineId,
      "XIC(ConvertToC)CPT(TempC,(TempF-32)*0.5555555556)",
      "Convert Fahrenheit to Celsius",
    ),
  ];
  return plan(
    "Temperature unit conversion",
    "Creates CPT-based Celsius/Fahrenheit conversion rungs: TempF = TempC * 1.8 + 32 and TempC = (TempF - 32) * 5 / 9.",
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
      : `Create a reviewed HMI screen named "${name}".`,
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
      : `Create a reviewed HMI popup named "${name}".`,
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

export function programScaffoldPlan(
  project: PlcProject,
  programName = "AI_Program",
  routineName = "Main",
): AssistantPlan {
  const controller = project.controllers[0];
  if (!controller) {
    return plan(
      "Create program scaffold",
      "No controller exists yet. Create or import a project first, then ask me to create the program scaffold.",
      [],
      ["No controller found."],
    );
  }
  const programId = createId("prog");
  const routineId = createId("rtn");
  return plan(
    "Create program scaffold",
    `Create offline program ${programName} with ladder routine ${routineName}. Export the reviewed project as L5X and use Studio 5000 for physical controller transfer.`,
    [
      createProgramAction(controller.id, programName, programId),
      createRoutineAction(programId, routineName, "ladder", routineId),
      setProgramMainRoutineAction(programId, programName, routineId),
    ],
    ["Offline ESCO edit only. Studio 5000 or approved Rockwell tooling must perform controller upload/download."],
  );
}

export function studio5000HandoffPlan(): AssistantPlan {
  return plan(
    "Studio 5000 handoff",
    [
      "ESCO can be the AI workspace for offline project edits, review, simulation, and L5X export.",
      "For Rockwell controllers, use Studio 5000/approved Rockwell tooling to open the exported L5X/ACD and perform physical upload/download.",
      "No ESCO AI action talks to a physical PLC or writes proprietary binary project files.",
    ].join("\n"),
    [],
  );
}

export function studio5000HandoffReadinessPlan(project: PlcProject): AssistantPlan {
  const report = buildStudio5000HandoffReadiness(project);
  return plan(
    "Studio 5000 handoff readiness",
    formatStudio5000HandoffReadiness(report),
    [],
    report.warnings.length ? [...report.warnings, report.boundary] : [report.boundary],
  );
}
