/**
 * Demo packaging-line project for the Simulation Lab.
 *
 * This is an ESCO-native mock project. It uses generic virtual devices and
 * plain virtual tags; it does not include brand assets, vendor files, or any
 * physical-controller transport.
 */

import type { PlcValue } from "@esco/simulator";
import { TAG } from "./catalog";
import { createDevice } from "./devices";
import { nextSimId } from "./ids";
import { createLogicBlock } from "./logic-templates";
import { createSimProject } from "./project";
import type {
  SimDataType,
  SimDevice,
  SimHmiWidget,
  SimProject,
  SimScenario,
  SimTagDirection,
  SimTimedAction,
  SimVirtualTag,
} from "./types";

export const CANDY_SORTER_DEMO_NAME = "Candy Bar Sorter - 5 Count Case Packer";

export const CANDY_SORTER_DEMO_TAGS = {
  autoMode: "CS_AutoMode",
  autoReady: "CS_AutoReady",
  jamActive: "CS_JamActive",
  jamAlarm: "CS_JamAlarm",
  currentProductCode: "CS_CurrentProductCode",
  totalBars: "CS_TotalBars",
  rejectCount: "CS_RejectCount",
  boxSize: "CS_BoxSize",
  kitKatPresent: "PE101_KitKatPresent",
  hersheyPresent: "PE101_HersheyPresent",
  unknownPresent: "PE101_UnknownPresent",
  kitKatBoxCount: "KK_BoxCount",
  kitKatBoxesPacked: "KK_BoxesPacked",
  kitKatBoxFull: "KK_BoxFull",
  kitKatSealerCommand: "KK_SealerCommand",
  hersheyBoxCount: "HS_BoxCount",
  hersheyBoxesPacked: "HS_BoxesPacked",
  hersheyBoxFull: "HS_BoxFull",
  hersheySealerCommand: "HS_SealerCommand",
  caseClamp: "PK301_CaseClamp",
  caseSealed: "PK301_CaseSealed",
} as const;

type TagSpec = {
  name: string;
  dataType: SimDataType;
  direction: SimTagDirection;
  initial: PlcValue;
  description: string;
  units?: string;
};

type ScenarioDraft = {
  name: string;
  description: string;
  durationMs: number;
  actions: Omit<SimTimedAction, "id">[];
  expectedTags: Omit<SimScenario["expectedTags"][number], "id">[];
  expectedEvents?: Omit<SimScenario["expectedEvents"][number], "id">[];
};

const NOW = () => new Date().toISOString();

function addVirtualTags(project: SimProject, device: SimDevice, specs: TagSpec[]): void {
  for (const spec of specs) {
    const tag: SimVirtualTag = {
      id: nextSimId(project, "tag"),
      name: spec.name,
      deviceId: device.id,
      dataType: spec.dataType,
      direction: spec.direction,
      initial: spec.initial,
      description: spec.description,
    };
    if (spec.units) tag.units = spec.units;
    device.tags.push(tag);
  }
}

function action(atMs: number, tag: string, value: PlcValue, note: string): Omit<SimTimedAction, "id"> {
  return { atMs, kind: "set-tag", tag, value, note };
}

function wait(atMs: number, note: string): Omit<SimTimedAction, "id"> {
  return { atMs, kind: "wait", note };
}

function tagExpectation(
  tag: string,
  value: PlcValue,
  description: string,
): Omit<SimScenario["expectedTags"][number], "id"> {
  return { tag, comparison: "==", value, description };
}

function buildScenario(project: SimProject, draft: ScenarioDraft): SimScenario {
  const scenario: SimScenario = {
    id: nextSimId(project, "scn"),
    name: draft.name,
    description: draft.description,
    initialConditions: [
      { tag: CANDY_SORTER_DEMO_TAGS.autoMode, value: true },
      { tag: CANDY_SORTER_DEMO_TAGS.jamActive, value: false },
      { tag: `${"ESTOP"}_${TAG.ok}`, value: true },
      { tag: `${"CASE101"}_${TAG.ok}`, value: true },
      { tag: `${"PE101"}_${TAG.ok}`, value: true },
      { tag: `${"CV101"}_${TAG.stopPb}`, value: false },
      { tag: `${"CV101"}_${TAG.overload}`, value: false },
      { tag: CANDY_SORTER_DEMO_TAGS.kitKatBoxCount, value: 0 },
      { tag: CANDY_SORTER_DEMO_TAGS.hersheyBoxCount, value: 0 },
      { tag: CANDY_SORTER_DEMO_TAGS.kitKatBoxesPacked, value: 0 },
      { tag: CANDY_SORTER_DEMO_TAGS.hersheyBoxesPacked, value: 0 },
      { tag: CANDY_SORTER_DEMO_TAGS.totalBars, value: 0 },
    ],
    actions: draft.actions.map((item) => ({ ...item, id: nextSimId(project, "act") })),
    expectedTags: draft.expectedTags.map((item) => ({ ...item, id: nextSimId(project, "exp") })),
    expectedAlarms: [],
    expectedEvents: (draft.expectedEvents ?? []).map((item) => ({ ...item, id: nextSimId(project, "exp") })),
    durationMs: draft.durationMs,
    scanRateMs: project.controller.scanRateMs,
  };
  return scenario;
}

function productPulse(
  startMs: number,
  product: "kitkat" | "hershey",
  count: number,
  total: number,
): Omit<SimTimedAction, "id">[] {
  const tags = CANDY_SORTER_DEMO_TAGS;
  const presentTag = product === "kitkat" ? tags.kitKatPresent : tags.hersheyPresent;
  const laneCount = product === "kitkat" ? tags.kitKatBoxCount : tags.hersheyBoxCount;
  const productName = product === "kitkat" ? "KitKat" : "Hershey";
  const diverter = product === "kitkat" ? "DV201" : "DV202";
  const productCode = product === "kitkat" ? 11 : 22;
  return [
    action(startMs, tags.currentProductCode, productCode, `${productName} barcode classified`),
    action(startMs + 10, presentTag, true, `${productName} bar detected at infeed photoeye`),
    action(startMs + 20, `${diverter}_${TAG.runCmd}`, true, `${productName} diverter gate routes the bar`),
    action(startMs + 30, laneCount, count, `${productName} lane count advanced to ${count}`),
    action(startMs + 30, tags.totalBars, total, `Total sorted bars advanced to ${total}`),
    action(startMs + 60, presentTag, false, `${productName} photoeye cleared`),
    action(startMs + 70, `${diverter}_${TAG.runCmd}`, false, `${productName} diverter returned home`),
  ];
}

function createScenarios(project: SimProject): SimScenario[] {
  const tags = CANDY_SORTER_DEMO_TAGS;
  return [
    buildScenario(project, {
      name: "Sort KitKats into a 5-count box",
      description: "Five KitKat bars are detected, diverted to the KitKat lane, and sealed as one 5-count box.",
      durationMs: 850,
      actions: [
        { atMs: 0, kind: "operator-login", note: "Operator starts virtual FAT run" },
        action(40, `${"CV101"}_${TAG.startPb}`, true, "Start infeed conveyor"),
        action(90, `${"CV101"}_${TAG.startPb}`, false, "Release conveyor start"),
        ...productPulse(130, "kitkat", 1, 1),
        ...productPulse(240, "kitkat", 2, 2),
        ...productPulse(350, "kitkat", 3, 3),
        ...productPulse(460, "kitkat", 4, 4),
        ...productPulse(570, "kitkat", 5, 5),
        action(670, tags.kitKatBoxFull, true, "KitKat box reached 5 count"),
        action(690, tags.kitKatSealerCommand, true, "KitKat box sealer fired"),
        action(700, `${"PK301"}_${TAG.runCmd}`, true, "Case packer cycles"),
        action(730, tags.caseClamp, true, "Case clamp closed"),
        action(760, tags.caseSealed, true, "KitKat box sealed at 5 count"),
        action(790, tags.kitKatBoxesPacked, 1, "KitKat packed-box counter advanced"),
      ],
      expectedTags: [
        tagExpectation(`${"CV101"}_${TAG.run}`, true, "Conveyor is running for the sort."),
        tagExpectation(tags.kitKatBoxCount, 5, "KitKat lane accumulated exactly five bars."),
        tagExpectation(tags.kitKatBoxFull, true, "KitKat lane set the box-full bit."),
        tagExpectation(tags.kitKatBoxesPacked, 1, "One KitKat 5-count box is complete."),
        tagExpectation(tags.caseSealed, true, "Case sealer completed."),
      ],
      expectedEvents: [{ contains: "KitKat box sealed", description: "Evidence records the KitKat case seal step." }],
    }),
    buildScenario(project, {
      name: "Sort Hershey bars into a 5-count box",
      description: "Five Hershey bars are detected, diverted to the Hershey lane, and sealed as one 5-count box.",
      durationMs: 850,
      actions: [
        { atMs: 0, kind: "operator-login", note: "Operator starts virtual FAT run" },
        action(40, `${"CV101"}_${TAG.startPb}`, true, "Start infeed conveyor"),
        action(90, `${"CV101"}_${TAG.startPb}`, false, "Release conveyor start"),
        ...productPulse(130, "hershey", 1, 1),
        ...productPulse(240, "hershey", 2, 2),
        ...productPulse(350, "hershey", 3, 3),
        ...productPulse(460, "hershey", 4, 4),
        ...productPulse(570, "hershey", 5, 5),
        action(670, tags.hersheyBoxFull, true, "Hershey box reached 5 count"),
        action(690, tags.hersheySealerCommand, true, "Hershey box sealer fired"),
        action(700, `${"PK301"}_${TAG.runCmd}`, true, "Case packer cycles"),
        action(730, tags.caseClamp, true, "Case clamp closed"),
        action(760, tags.caseSealed, true, "Hershey box sealed at 5 count"),
        action(790, tags.hersheyBoxesPacked, 1, "Hershey packed-box counter advanced"),
      ],
      expectedTags: [
        tagExpectation(`${"CV101"}_${TAG.run}`, true, "Conveyor is running for the sort."),
        tagExpectation(tags.hersheyBoxCount, 5, "Hershey lane accumulated exactly five bars."),
        tagExpectation(tags.hersheyBoxFull, true, "Hershey lane set the box-full bit."),
        tagExpectation(tags.hersheyBoxesPacked, 1, "One Hershey 5-count box is complete."),
        tagExpectation(tags.caseSealed, true, "Case sealer completed."),
      ],
      expectedEvents: [{ contains: "Hershey box sealed", description: "Evidence records the Hershey case seal step." }],
    }),
    buildScenario(project, {
      name: "Mixed stream routes both lanes",
      description: "A mixed ten-bar stream is classified and routed into one KitKat box and one Hershey box.",
      durationMs: 1250,
      actions: [
        { atMs: 0, kind: "operator-login", note: "Operator starts mixed product FAT run" },
        action(40, `${"CV101"}_${TAG.startPb}`, true, "Start infeed conveyor"),
        action(90, `${"CV101"}_${TAG.startPb}`, false, "Release conveyor start"),
        ...productPulse(130, "kitkat", 1, 1),
        ...productPulse(230, "hershey", 1, 2),
        ...productPulse(330, "kitkat", 2, 3),
        ...productPulse(430, "hershey", 2, 4),
        ...productPulse(530, "kitkat", 3, 5),
        ...productPulse(630, "hershey", 3, 6),
        ...productPulse(730, "kitkat", 4, 7),
        ...productPulse(830, "hershey", 4, 8),
        ...productPulse(930, "kitkat", 5, 9),
        action(1010, tags.kitKatBoxFull, true, "KitKat box full from mixed stream"),
        action(1030, tags.kitKatBoxesPacked, 1, "KitKat mixed-stream box complete"),
        ...productPulse(1050, "hershey", 5, 10),
        action(1130, tags.hersheyBoxFull, true, "Hershey box full from mixed stream"),
        action(1150, tags.hersheyBoxesPacked, 1, "Hershey mixed-stream box complete"),
      ],
      expectedTags: [
        tagExpectation(tags.totalBars, 10, "All ten bars were classified."),
        tagExpectation(tags.kitKatBoxCount, 5, "KitKat lane received five bars."),
        tagExpectation(tags.hersheyBoxCount, 5, "Hershey lane received five bars."),
        tagExpectation(tags.kitKatBoxesPacked, 1, "One KitKat box was packed."),
        tagExpectation(tags.hersheyBoxesPacked, 1, "One Hershey box was packed."),
      ],
      expectedEvents: [
        { contains: "KitKat mixed-stream box complete", description: "KitKat completion is logged." },
        { contains: "Hershey mixed-stream box complete", description: "Hershey completion is logged." },
      ],
    }),
    buildScenario(project, {
      name: "Jam stops conveyor before case close",
      description: "A belt jam trips the run permissive before a partial box can be sealed.",
      durationMs: 620,
      actions: [
        { atMs: 0, kind: "operator-login", note: "Operator starts jam response FAT run" },
        action(40, `${"CV101"}_${TAG.startPb}`, true, "Start infeed conveyor"),
        action(90, `${"CV101"}_${TAG.startPb}`, false, "Release conveyor start"),
        ...productPulse(130, "kitkat", 1, 1),
        ...productPulse(230, "kitkat", 2, 2),
        ...productPulse(330, "kitkat", 3, 3),
        action(430, tags.jamActive, true, "Jam detected before the box reached 5 count"),
        action(460, tags.kitKatSealerCommand, false, "Sealer inhibited while jam is active"),
        wait(500, "Verify conveyor stopped and partial box remains open"),
      ],
      expectedTags: [
        tagExpectation(`${"CV101"}_${TAG.run}`, false, "Conveyor stopped after the jam bit tripped."),
        tagExpectation(tags.jamAlarm, true, "Jam alarm bit is active."),
        tagExpectation(tags.kitKatBoxCount, 3, "Partial KitKat count is retained."),
        tagExpectation(tags.kitKatBoxesPacked, 0, "No box was packed during the jam."),
        tagExpectation(tags.caseSealed, false, "The case sealer stayed off."),
      ],
      expectedEvents: [{ contains: "Jam detected", description: "Jam evidence is recorded." }],
    }),
  ];
}

function hmiWidget(project: SimProject, widget: Omit<SimHmiWidget, "id">): SimHmiWidget {
  return { ...widget, id: nextSimId(project, "widget") };
}

export function createCandySorterDemoProject(now: () => string = NOW): SimProject {
  const project = createSimProject({
    name: CANDY_SORTER_DEMO_NAME,
    processType: "packaging-line",
    scanRateMs: 10,
    rackCount: 1,
    rackSlots: 16,
    seedDefaults: false,
    now,
  });
  const rackId = project.racks[0]?.id;

  const conveyor = createDevice(project, { kind: "motor", tag: "CV101", name: "Infeed Conveyor Belt", rackId });
  const kitKatDiverter = createDevice(project, { kind: "motor", tag: "DV201", name: "KitKat Lane Diverter Gate", rackId });
  const hersheyDiverter = createDevice(project, { kind: "motor", tag: "DV202", name: "Hershey Lane Diverter Gate", rackId });
  const packer = createDevice(project, { kind: "motor", tag: "PK301", name: "5-Count Case Packer", rackId });
  const classifier = createDevice(project, { kind: "safety-input", tag: "PE101", name: "Barcode and Product Photoeye", rackId });
  const caseSensor = createDevice(project, { kind: "safety-input", tag: "CASE101", name: "Empty Case Present Sensor", rackId });
  const estop = createDevice(project, { kind: "safety-input", tag: "ESTOP", name: "Packaging Line E-Stop", rackId });
  const sequencer = createDevice(project, { kind: "safety-input", tag: "SEQ501", name: "Candy Sort Sequencer", rackId });

  addVirtualTags(project, classifier, [
    { name: CANDY_SORTER_DEMO_TAGS.kitKatPresent, dataType: "BOOL", direction: "input", initial: false, description: "KitKat product detect bit from virtual classifier." },
    { name: CANDY_SORTER_DEMO_TAGS.hersheyPresent, dataType: "BOOL", direction: "input", initial: false, description: "Hershey product detect bit from virtual classifier." },
    { name: CANDY_SORTER_DEMO_TAGS.unknownPresent, dataType: "BOOL", direction: "input", initial: false, description: "Unknown product detect bit for rejects." },
  ]);

  addVirtualTags(project, packer, [
    { name: CANDY_SORTER_DEMO_TAGS.caseClamp, dataType: "BOOL", direction: "output", initial: false, description: "Case clamp command/feedback for the virtual packer." },
    { name: CANDY_SORTER_DEMO_TAGS.caseSealed, dataType: "BOOL", direction: "output", initial: false, description: "Case sealed status for a completed 5-count box." },
  ]);

  addVirtualTags(project, sequencer, [
    { name: CANDY_SORTER_DEMO_TAGS.autoMode, dataType: "BOOL", direction: "internal", initial: true, description: "Auto mode request for the sorter sequence." },
    { name: CANDY_SORTER_DEMO_TAGS.autoReady, dataType: "BOOL", direction: "internal", initial: false, description: "All permissives healthy for auto sorting." },
    { name: CANDY_SORTER_DEMO_TAGS.jamActive, dataType: "BOOL", direction: "internal", initial: false, description: "Virtual belt jam condition." },
    { name: CANDY_SORTER_DEMO_TAGS.jamAlarm, dataType: "BOOL", direction: "output", initial: false, description: "Jam alarm bit generated by the alarm-trigger logic block." },
    { name: CANDY_SORTER_DEMO_TAGS.currentProductCode, dataType: "DINT", direction: "internal", initial: 0, description: "11=KitKat, 22=Hershey, 99=reject in the demo sequence." },
    { name: CANDY_SORTER_DEMO_TAGS.totalBars, dataType: "DINT", direction: "internal", initial: 0, description: "Total classified bars in the active virtual run." },
    { name: CANDY_SORTER_DEMO_TAGS.rejectCount, dataType: "DINT", direction: "internal", initial: 0, description: "Rejected or unknown bars." },
    { name: CANDY_SORTER_DEMO_TAGS.boxSize, dataType: "DINT", direction: "internal", initial: 5, description: "Target count per packed box." },
    { name: CANDY_SORTER_DEMO_TAGS.kitKatBoxCount, dataType: "DINT", direction: "internal", initial: 0, description: "Current KitKat box count." },
    { name: CANDY_SORTER_DEMO_TAGS.kitKatBoxesPacked, dataType: "DINT", direction: "internal", initial: 0, description: "Completed KitKat 5-count boxes." },
    { name: CANDY_SORTER_DEMO_TAGS.kitKatBoxFull, dataType: "BOOL", direction: "internal", initial: false, description: "KitKat lane has reached 5 bars." },
    { name: CANDY_SORTER_DEMO_TAGS.kitKatSealerCommand, dataType: "BOOL", direction: "output", initial: false, description: "KitKat lane sealer command." },
    { name: CANDY_SORTER_DEMO_TAGS.hersheyBoxCount, dataType: "DINT", direction: "internal", initial: 0, description: "Current Hershey box count." },
    { name: CANDY_SORTER_DEMO_TAGS.hersheyBoxesPacked, dataType: "DINT", direction: "internal", initial: 0, description: "Completed Hershey 5-count boxes." },
    { name: CANDY_SORTER_DEMO_TAGS.hersheyBoxFull, dataType: "BOOL", direction: "internal", initial: false, description: "Hershey lane has reached 5 bars." },
    { name: CANDY_SORTER_DEMO_TAGS.hersheySealerCommand, dataType: "BOOL", direction: "output", initial: false, description: "Hershey lane sealer command." },
  ]);

  project.devices.push(conveyor, kitKatDiverter, hersheyDiverter, packer, classifier, caseSensor, estop, sequencer);

  project.logicBlocks.push(
    createLogicBlock(
      project,
      "permissive-chain",
      {
        permissives: `${CANDY_SORTER_DEMO_TAGS.autoMode},ESTOP_${TAG.ok},CASE101_${TAG.ok},PE101_${TAG.ok}`,
        output: CANDY_SORTER_DEMO_TAGS.autoReady,
      },
      "Candy Sorter Auto Ready",
    ),
    createLogicBlock(
      project,
      "motor-holding-interlocks",
      {
        start: `CV101_${TAG.startPb}`,
        stop: `CV101_${TAG.stopPb}`,
        runCmd: `CV101_${TAG.runCmd}`,
        permissives: CANDY_SORTER_DEMO_TAGS.autoReady,
        trips: `CV101_${TAG.overload},${CANDY_SORTER_DEMO_TAGS.jamActive}`,
      },
      "CV101 Conveyor Holding With Jam Interlock",
    ),
    createLogicBlock(
      project,
      "motor-start-counter",
      { run: `CV101_${TAG.run}`, starts: `CV101_${TAG.starts}` },
      "CV101 Conveyor Start Counter",
    ),
    createLogicBlock(
      project,
      "alarm-trigger",
      {
        source: CANDY_SORTER_DEMO_TAGS.jamActive,
        mode: "digital",
        limit: "1",
        alarm: CANDY_SORTER_DEMO_TAGS.jamAlarm,
      },
      "Candy Sorter Jam Alarm",
    ),
  );

  project.hmiScreens.push({
    id: nextSimId(project, "screen"),
    name: "Candy Sorter Overview",
    widgets: [
      hmiWidget(project, { kind: "indicator", label: "Auto Ready", tag: CANDY_SORTER_DEMO_TAGS.autoReady }),
      hmiWidget(project, { kind: "indicator", label: "Conveyor Running", tag: `CV101_${TAG.run}` }),
      hmiWidget(project, { kind: "value", label: "KitKat Box Count", tag: CANDY_SORTER_DEMO_TAGS.kitKatBoxCount }),
      hmiWidget(project, { kind: "value", label: "Hershey Box Count", tag: CANDY_SORTER_DEMO_TAGS.hersheyBoxCount }),
      hmiWidget(project, { kind: "value", label: "Total Bars", tag: CANDY_SORTER_DEMO_TAGS.totalBars }),
      hmiWidget(project, { kind: "indicator", label: "Jam Alarm", tag: CANDY_SORTER_DEMO_TAGS.jamAlarm }),
      hmiWidget(project, { kind: "button", label: "Start Conveyor", tag: `CV101_${TAG.startPb}`, command: true }),
      hmiWidget(project, { kind: "alarm-banner", label: "Line Alarms" }),
    ],
  });

  project.scenarios.push(...createScenarios(project));
  project.updatedAtLabel = now();
  return project;
}
